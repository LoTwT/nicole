package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"io/fs"
	"os"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

const (
	// searchMatchLimit bounds the matches a single request returns. The scan
	// continues only until it knows whether one more match exists, so the page
	// can tell an exact limit from a truncated result.
	searchMatchLimit = 1000
	// searchSnippetLimit bounds the line text sent for one result line, in
	// UTF-16 code units. Longer lines keep a window around their first match.
	searchSnippetLimit = 400
	searchSnippetLead  = 100
	// searchCheckInterval bounds how many UTF-16 units the coordinate and
	// fingerprint loops process between cancellation checks.
	searchCheckInterval = 4096
)

// SearchRequest describes one workspace search. It names no path: Go always
// scans the open workspace and checks Generation against it.
type SearchRequest struct {
	Generation    int    `json:"generation"`
	Query         string `json:"query"`
	CaseSensitive bool   `json:"caseSensitive"`
	Regex         bool   `json:"regex"`
}

// SearchMatch is one occurrence on a result line. Column is the match start
// within the line in UTF-16 code units, independent of where earlier lines
// end. Length is the full match length in UTF-16 code units, including text
// after the displayed line. Fingerprint identifies the full match text so the
// page can prove the selected range is unchanged; it is a pair of FNV-64
// values over the normalized UTF-16 code units. EndLine and its fingerprint
// cover the line containing the end of a cross-line match, and the four
// boundary flags preserve RE2's document/line anchor semantics after a move.
// HighlightStart and HighlightEnd are offsets in the sent line text; -1 means
// the match lies outside the bounded snippet.
type SearchMatch struct {
	Column                int    `json:"column"`
	Length                int    `json:"length"`
	Fingerprint           string `json:"fingerprint"`
	EndLine               int    `json:"endLine"`
	EndLineFingerprint    string `json:"endLineFingerprint"`
	StartsAtDocumentStart bool   `json:"startsAtDocumentStart"`
	StartsAtLineStart     bool   `json:"startsAtLineStart"`
	EndsAtDocumentEnd     bool   `json:"endsAtDocumentEnd"`
	EndsAtLineEnd         bool   `json:"endsAtLineEnd"`
	HighlightStart        int    `json:"highlightStart"`
	HighlightEnd          int    `json:"highlightEnd"`
}

// SearchPart is one streamed value of Workspace.Search: a matching line, then
// a final summary. Type is "line" or "done". One line part carries every match
// that starts on that line. LineFingerprint covers the full line text, not the
// bounded snippet.
type SearchPart struct {
	Type            string        `json:"type"`
	Path            string        `json:"path,omitempty"`
	Line            int           `json:"line,omitempty"`
	Text            string        `json:"text,omitempty"`
	LineFingerprint string        `json:"lineFingerprint,omitempty"`
	PrefixTruncated bool          `json:"prefixTruncated,omitempty"`
	SuffixTruncated bool          `json:"suffixTruncated,omitempty"`
	Matches         []SearchMatch `json:"matches,omitempty"`
	FileCount       int           `json:"fileCount,omitempty"`
	MatchCount      int           `json:"matchCount,omitempty"`
	Truncated       bool          `json:"truncated,omitempty"`
}

// errSearchStopped ends a scan whose page went away or whose workspace changed.
// It is not a search failure: nothing is sent after it.
var errSearchStopped = errors.New("workspace: search stopped")

// errSearchSkip means a walked entry is no longer an allowed target when it is
// opened: it became a symlink, a non-regular file, or its directory chain
// changed. The entry is skipped like a file removed during the scan.
var errSearchSkip = errors.New("workspace: search skipped an ineligible path")

// errFileReadLimit means a bounded reader stopped before the whole file was
// read. The caller decides whether to skip the file or report it.
var errFileReadLimit = errors.New("workspace: file exceeds the read limit")

// Search scans the Markdown files of the open workspace and streams matching
// lines on parts. It reads the disk, not unsaved editor text. Hidden folders,
// node_modules, symlinks and files that are not regular Markdown files are
// skipped with the same facts ListFiles uses. The page may close the channel
// to cancel; Go also stops when the workspace generation changes.
//
// Results are newline-normalized and use UTF-16 offsets for the page's
// CodeMirror document. At most searchMatchLimit matches are sent; the final
// part distinguishes an exact limit from a truncated result.
func (w *Workspace) Search(ctx context.Context, request SearchRequest, parts *mygo.Channel[SearchPart]) error {
	if parts == nil {
		return errors.New("workspace: search needs a channel")
	}
	err := w.search(ctx, request, parts.Send)
	if err != nil && (errors.Is(err, mygo.ErrChannelClosed) || ctx.Err() != nil) {
		return nil
	}
	return err
}

// search is Search with a plain callback, so tests can observe each streamed
// part without a MyGo channel.
func (w *Workspace) search(ctx context.Context, request SearchRequest, emit func(SearchPart) error) error {
	root, err := w.currentRoot(request.Generation)
	if err != nil {
		return err
	}
	if request.Query == "" {
		return errors.New("workspace: search needs a query")
	}
	pattern, err := compileSearchPattern(request)
	if err != nil {
		return err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return err
	}
	defer rootFS.Close()

	stale := func() bool {
		currentRoot, generation := w.state.snapshot()
		return currentRoot != root || generation != request.Generation
	}
	return searchRoot(rootFS, pattern, emit, func() bool {
		return ctx.Err() != nil || stale()
	})
}

func compileSearchPattern(request SearchRequest) (*regexp.Regexp, error) {
	pattern := request.Query
	if !request.Regex {
		pattern = regexp.QuoteMeta(pattern)
	}
	if !request.CaseSensitive {
		pattern = "(?i)" + pattern
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("workspace: invalid search pattern: %w", err)
	}
	return re, nil
}

// searchRoot walks the workspace in the same lexical order and with the same
// exclusions as ListFiles. It streams one line part per matching line and ends
// with a done part unless the caller canceled or the workspace changed.
func searchRoot(
	root *os.Root,
	pattern *regexp.Regexp,
	emit func(SearchPart) error,
	stop func() bool,
) error {
	total := 0
	files := 0
	truncated := false
	stopped := false

	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if stop() {
			stopped = true
			return fs.SkipAll
		}
		if walkErr != nil {
			return walkErr
		}
		if name == "." {
			return nil
		}
		if entry.IsDir() {
			if ignoredFolder(entry.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		// WalkDir does not follow symlinks; leaving them out keeps a link from
		// standing in for a file the workspace does not contain.
		if !entry.Type().IsRegular() || !isMarkdownName(entry.Name()) {
			return nil
		}
		data, err := readSearchFile(root, name, stop)
		if err != nil {
			if errors.Is(err, errSearchSkip) || errors.Is(err, fs.ErrNotExist) {
				// The entry stopped being a regular Markdown file after the
				// walk saw it. This is not a failed search, and no link target
				// may stand in for it.
				return nil
			}
			if errors.Is(err, errSearchStopped) {
				stopped = true
				return fs.SkipAll
			}
			return err
		}
		found, fileTruncated, err := searchFile(
			name,
			normalizeSearchNewlines(string(data)),
			pattern,
			searchMatchLimit-total,
			emit,
			stop,
		)
		if err != nil {
			if errors.Is(err, errSearchStopped) {
				stopped = true
				return fs.SkipAll
			}
			return err
		}
		if found > 0 {
			files++
		}
		total += found
		if fileTruncated {
			truncated = true
			stopped = true
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return err
	}
	if stopped && !truncated {
		return nil
	}
	if stop() {
		return nil
	}
	return emit(SearchPart{
		Type:       "done",
		FileCount:  files,
		MatchCount: total,
		Truncated:  truncated,
	})
}

// openSearchFile opens a rooted entry without waiting for a writer when the
// path changed into a FIFO after the Lstat check. The returned descriptor is
// still inspected before any bytes are read.
func openSearchFile(root *os.Root, name string) (*os.File, error) {
	return root.OpenFile(name, os.O_RDONLY|searchOpenNonblock, 0)
}

// readSearchFile opens and reads one walked entry without following a link
// that replaced the file or any directory after the walk. Each directory is
// opened and its identity checked before use; the final file is opened without
// blocking on special files, then checked against both the entry before
// opening and the current path before any bytes are read. A path that stopped
// being a regular Markdown file in a visible directory is skipped, not read
// through a link.
func readSearchFile(root *os.Root, rel string, stop func() bool) ([]byte, error) {
	return readRegularFile(root, rel, 0, stop)
}

// readRegularFile is the bounded form used by workspace search (maxBytes 0,
// unlimited) and user templates (a fixed byte limit). It keeps every identity
// check of the search reader; maxBytes is enforced before the buffer grows, so
// a huge or growing file is not read in full.
func readRegularFile(root *os.Root, rel string, maxBytes int64, stop func() bool) ([]byte, error) {
	if stop() {
		return nil, errSearchStopped
	}
	if err := validateWorkspaceFile(rel); err != nil {
		return nil, errSearchSkip
	}
	parts := strings.Split(rel, "/")
	if len(parts) == 0 || parts[len(parts)-1] == "" {
		return nil, errSearchSkip
	}
	current := root
	var owned []*os.Root
	defer func() {
		for _, opened := range owned {
			_ = opened.Close()
		}
	}()

	for _, part := range parts[:len(parts)-1] {
		if stop() {
			return nil, errSearchStopped
		}
		if ignoredFolder(part) {
			return nil, errSearchSkip
		}
		before, err := current.Lstat(part)
		if err != nil {
			return nil, err
		}
		if before.Mode()&fs.ModeSymlink != 0 || !before.IsDir() {
			return nil, errSearchSkip
		}
		next, err := current.OpenRoot(part)
		if err != nil {
			return nil, err
		}
		opened, statErr := next.Stat(".")
		after, afterErr := current.Lstat(part)
		if statErr != nil || afterErr != nil ||
			after.Mode()&fs.ModeSymlink != 0 || !after.IsDir() ||
			!os.SameFile(before, opened) || !os.SameFile(opened, after) {
			_ = next.Close()
			if statErr != nil {
				return nil, statErr
			}
			if afterErr != nil {
				return nil, afterErr
			}
			return nil, errSearchSkip
		}
		owned = append(owned, next)
		current = next
	}

	name := parts[len(parts)-1]
	if stop() {
		return nil, errSearchStopped
	}
	before, err := current.Lstat(name)
	if err != nil {
		return nil, err
	}
	if before.Mode()&fs.ModeSymlink != 0 || !before.Mode().IsRegular() {
		return nil, errSearchSkip
	}
	file, err := openSearchFile(current, name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, err
	}
	after, err := current.Lstat(name)
	if err != nil {
		return nil, err
	}
	if !opened.Mode().IsRegular() || after.Mode()&fs.ModeSymlink != 0 ||
		!after.Mode().IsRegular() || !os.SameFile(before, opened) ||
		!os.SameFile(opened, after) {
		return nil, errSearchSkip
	}

	var data bytes.Buffer
	chunk := make([]byte, 64*1024)
	for {
		if stop() {
			return nil, errSearchStopped
		}
		n, readErr := file.Read(chunk)
		if n > 0 {
			if maxBytes > 0 && int64(data.Len())+int64(n) > maxBytes {
				return nil, errFileReadLimit
			}
			_, _ = data.Write(chunk[:n])
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
	}
	if stop() {
		return nil, errSearchStopped
	}
	return data.Bytes(), nil
}

// searchFile streams the matching lines of one file. It stops after remaining
// matches and reports whether one more exists, without sending it.
func searchFile(
	path string,
	text string,
	pattern *regexp.Regexp,
	remaining int,
	emit func(SearchPart) error,
	stop func() bool,
) (int, bool, error) {
	if remaining <= 0 {
		if stop() {
			return 0, false, errSearchStopped
		}
		if pattern.FindStringIndex(text) != nil {
			return 0, true, nil
		}
		return 0, false, nil
	}

	var (
		lineStartBytes   []int
		lineStartUnits   []int
		lineFingerprints = map[int]string{}
		pending          *SearchPart
		pendingMatches   []SearchMatch
		pendingStart     int
		pendingLength    int
		currentLine      = -1
	)
	lineFingerprint := func(index int) (string, error) {
		if fingerprint, ok := lineFingerprints[index]; ok {
			return fingerprint, nil
		}
		lineText := text[lineStartBytes[index]:lineEndByte(lineStartBytes, index, len(text))]
		fingerprint, err := searchSignature(lineText, stop)
		if err != nil {
			return "", err
		}
		lineFingerprints[index] = fingerprint
		return fingerprint, nil
	}
	flush := func() error {
		if pending == nil {
			return nil
		}
		if stop() {
			return errSearchStopped
		}
		part := *pending
		part.Matches = pendingMatches
		pending = nil
		pendingMatches = nil
		return emit(part)
	}

	found := 0
	byteCursor := 0
	unitCursor := 0
	unitsAt := func(offset int) (int, error) {
		if offset > byteCursor {
			length, err := utf16LengthChecked(text[byteCursor:offset], stop)
			if err != nil {
				return 0, err
			}
			unitCursor += length
			byteCursor = offset
		}
		return unitCursor, nil
	}

	if stop() {
		return 0, false, errSearchStopped
	}
	// The standard regexp API has no context parameter, so this one native
	// call cannot be interrupted in the middle. The scan stops immediately
	// before and after it; all surrounding read, coordinate, fingerprint and
	// send loops check cancellation more frequently.
	locations := pattern.FindAllStringIndex(text, remaining+1)
	if stop() {
		return 0, false, errSearchStopped
	}
	truncated := len(locations) > remaining
	if truncated {
		locations = locations[:remaining]
	}

	for _, location := range locations {
		if stop() {
			return found, false, errSearchStopped
		}
		start := location[0]
		end := location[1]
		if lineStartBytes == nil {
			var err error
			lineStartBytes, lineStartUnits, err = lineOffsets(text, stop)
			if err != nil {
				return found, false, err
			}
		}
		line := lineIndexAt(lineStartBytes, start)
		startUnit, err := unitsAt(start)
		if err != nil {
			return found, false, err
		}
		endUnit, err := unitsAt(end)
		if err != nil {
			return found, false, err
		}
		if line != currentLine {
			if err := flush(); err != nil {
				return found, false, err
			}
			currentLine = line
			lineText := text[lineStartBytes[line]:lineEndByte(lineStartBytes, line, len(text))]
			firstInLine := startUnit - lineStartUnits[line]
			snippet, snippetStart, snippetEnd, prefix, suffix, err := snippetWindow(lineText, firstInLine, stop)
			if err != nil {
				return found, false, err
			}
			fingerprint, err := lineFingerprint(line)
			if err != nil {
				return found, false, err
			}
			pending = &SearchPart{
				Type:            "line",
				Path:            path,
				Line:            line + 1,
				Text:            snippet,
				LineFingerprint: fingerprint,
				PrefixTruncated: prefix,
				SuffixTruncated: suffix,
			}
			pendingStart = snippetStart
			pendingLength = snippetEnd - snippetStart
		}
		lineStartUnit := lineStartUnits[line]
		highlightStart := startUnit - lineStartUnit - pendingStart
		highlightEnd := endUnit - lineStartUnit - pendingStart
		if highlightStart < 0 || highlightStart > pendingLength {
			highlightStart = -1
			highlightEnd = -1
		} else {
			highlightEnd = clampInt(highlightEnd, highlightStart, pendingLength)
		}
		fingerprint, err := searchSignature(text[start:end], stop)
		if err != nil {
			return found, false, err
		}
		endLine := lineIndexAt(lineStartBytes, end)
		endLineFingerprint, err := lineFingerprint(endLine)
		if err != nil {
			return found, false, err
		}
		endLineEnd := lineEndByte(lineStartBytes, endLine, len(text))
		pendingMatches = append(pendingMatches, SearchMatch{
			Column:                startUnit - lineStartUnit,
			Length:                endUnit - startUnit,
			Fingerprint:           fingerprint,
			EndLine:               endLine + 1,
			EndLineFingerprint:    endLineFingerprint,
			StartsAtDocumentStart: start == 0,
			StartsAtLineStart:     start == lineStartBytes[line],
			EndsAtDocumentEnd:     end == len(text),
			EndsAtLineEnd:         end == endLineEnd,
			HighlightStart:        highlightStart,
			HighlightEnd:          highlightEnd,
		})
		found++
	}
	if err := flush(); err != nil {
		return found, false, err
	}
	return found, truncated, nil
}

// normalizeSearchNewlines makes CRLF and bare CR match the "\n" document the
// editor and UTF-16 offsets use. Conversion happens before matching, so a
// regex never sees a carriage return from the disk.
func normalizeSearchNewlines(text string) string {
	if !strings.ContainsRune(text, '\r') {
		return text
	}
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}

// lineOffsets returns the byte and UTF-16 offset of the start of every line in
// text. The text is expected to use "\n" only.
func lineOffsets(text string, stop func() bool) ([]int, []int, error) {
	bytes := []int{0}
	units := []int{0}
	unit := 0
	seen := 0
	for index, r := range text {
		if seen%searchCheckInterval == 0 && stop() {
			return nil, nil, errSearchStopped
		}
		seen++
		if r == '\n' {
			bytes = append(bytes, index+1)
			units = append(units, unit+1)
		}
		unit += runeUTF16Length(r)
	}
	if stop() {
		return nil, nil, errSearchStopped
	}
	return bytes, units, nil
}

func lineEndByte(starts []int, index, textLength int) int {
	if index+1 < len(starts) {
		return starts[index+1] - 1
	}
	return textLength
}

func lineIndexAt(starts []int, offset int) int {
	return sort.Search(len(starts), func(index int) bool {
		return starts[index] > offset
	}) - 1
}

// snippetWindow keeps a bounded UTF-16 window of one line around its first
// match. Offsets are snapped to rune boundaries so an emoji is never split.
func snippetWindow(line string, firstStart int, stop func() bool) (string, int, int, bool, bool, error) {
	lineLength, err := utf16LengthChecked(line, stop)
	if err != nil {
		return "", 0, 0, false, false, err
	}
	startUnit := firstStart - searchSnippetLead
	if startUnit < 0 {
		startUnit = 0
	}
	endUnit := startUnit + searchSnippetLimit
	if endUnit > lineLength {
		endUnit = lineLength
	}
	startByte, err := byteOffsetAtUTF16(line, startUnit, stop)
	if err != nil {
		return "", 0, 0, false, false, err
	}
	endByte, err := byteOffsetAfterUTF16(line, endUnit, stop)
	if err != nil {
		return "", 0, 0, false, false, err
	}
	text := line[startByte:endByte]
	actualStart, err := utf16LengthChecked(line[:startByte], stop)
	if err != nil {
		return "", 0, 0, false, false, err
	}
	textLength, err := utf16LengthChecked(text, stop)
	if err != nil {
		return "", 0, 0, false, false, err
	}
	return text, actualStart, actualStart + textLength, startByte > 0, endByte < len(line), nil
}

func byteOffsetAtUTF16(text string, offset int, stop func() bool) (int, error) {
	unit := 0
	seen := 0
	for index := 0; index < len(text); {
		if seen%searchCheckInterval == 0 && stop() {
			return 0, errSearchStopped
		}
		seen++
		if unit >= offset {
			return index, nil
		}
		r, size := utf8.DecodeRuneInString(text[index:])
		unit += runeUTF16Length(r)
		if unit > offset {
			return index, nil
		}
		index += size
	}
	return len(text), nil
}

func byteOffsetAfterUTF16(text string, offset int, stop func() bool) (int, error) {
	if offset <= 0 {
		return 0, nil
	}
	unit := 0
	seen := 0
	for index := 0; index < len(text); {
		if seen%searchCheckInterval == 0 && stop() {
			return 0, errSearchStopped
		}
		seen++
		r, size := utf8.DecodeRuneInString(text[index:])
		unit += runeUTF16Length(r)
		index += size
		if unit >= offset {
			return index, nil
		}
	}
	return len(text), nil
}

func utf16Length(text string) int {
	units := 0
	for _, r := range text {
		units += runeUTF16Length(r)
	}
	return units
}

func utf16LengthChecked(text string, stop func() bool) (int, error) {
	units := 0
	seen := 0
	for _, r := range text {
		if seen%searchCheckInterval == 0 && stop() {
			return 0, errSearchStopped
		}
		seen++
		units += runeUTF16Length(r)
	}
	return units, nil
}

func runeUTF16Length(r rune) int {
	if r > 0xFFFF {
		return 2
	}
	return 1
}

// searchSignature is a 128-bit fingerprint of the normalized UTF-16 code
// units: the concatenation of FNV-1a/64 and FNV-1/64 over the same
// little-endian UTF-16 bytes. It is a content identity for stale-result
// checks, not a password hash. Both halves are checked, so the JS side never
// accepts a match by length or a bounded prefix alone.
func searchSignature(text string, stop func() bool) (string, error) {
	first := fnv.New64a()
	second := fnv.New64()
	var unit [2]byte
	seen := 0
	writeUnit := func(value uint16) {
		unit[0] = byte(value)
		unit[1] = byte(value >> 8)
		_, _ = first.Write(unit[:])
		_, _ = second.Write(unit[:])
	}
	for _, r := range text {
		if seen%searchCheckInterval == 0 && stop() {
			return "", errSearchStopped
		}
		seen++
		if r > 0xFFFF {
			r -= 0x10000
			writeUnit(uint16(0xD800 + (r >> 10)))
			writeUnit(uint16(0xDC00 + (r & 0x3FF)))
		} else {
			writeUnit(uint16(r))
		}
	}
	return fmt.Sprintf("%016x%016x", first.Sum64(), second.Sum64()), nil
}

func clampInt(value, minimum, maximum int) int {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
