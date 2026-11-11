package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
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
	// searchMatchTextLimit bounds the match text sent for validation. Length
	// still reports the full match in UTF-16 code units.
	searchMatchTextLimit = 200
)

// SearchRequest describes one workspace search. It names no path: Go always
// scans the open workspace and checks Generation against it.
type SearchRequest struct {
	Generation    int    `json:"generation"`
	Query         string `json:"query"`
	CaseSensitive bool   `json:"caseSensitive"`
	Regex         bool   `json:"regex"`
}

// SearchMatch is one occurrence on a result line. Start and End are UTF-16
// offsets in the newline-normalized document, which is the text CodeMirror
// holds. They span the whole match even when it continues past the displayed
// line. Text is a bounded prefix used to verify the match before selecting it,
// while Length is the full length in UTF-16 code units. HighlightStart and
// HighlightEnd are offsets in the sent line text; -1 means the match lies
// outside the bounded snippet.
type SearchMatch struct {
	Start          int    `json:"start"`
	End            int    `json:"end"`
	Text           string `json:"text"`
	Length         int    `json:"length"`
	HighlightStart int    `json:"highlightStart"`
	HighlightEnd   int    `json:"highlightEnd"`
}

// SearchPart is one streamed value of Workspace.Search: a matching line, then
// a final summary. Type is "line" or "done". One line part carries every match
// that starts on that line.
type SearchPart struct {
	Type            string        `json:"type"`
	Path            string        `json:"path,omitempty"`
	Line            int           `json:"line,omitempty"`
	Text            string        `json:"text,omitempty"`
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
		if stop() {
			stopped = true
			return fs.SkipAll
		}
		data, err := root.ReadFile(filepath.FromSlash(name))
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				// The file disappeared after WalkDir saw it; there is nothing
				// left to search and this is not a failed search.
				return nil
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
		if pattern.FindStringIndex(text) != nil {
			return 0, true, nil
		}
		return 0, false, nil
	}

	var (
		lineStartBytes []int
		lineStartUnits []int
		pending        *SearchPart
		pendingMatches []SearchMatch
		pendingStart   int
		pendingLength  int
		currentLine    = -1
	)
	flush := func() error {
		if pending == nil {
			return nil
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
	unitsAt := func(offset int) int {
		if offset > byteCursor {
			unitCursor += utf16Length(text[byteCursor:offset])
			byteCursor = offset
		}
		return unitCursor
	}

	locations := pattern.FindAllStringIndex(text, remaining+1)
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
			lineStartBytes, lineStartUnits = lineOffsets(text)
		}
		line := lineIndexAt(lineStartBytes, start)
		startUnit := unitsAt(start)
		endUnit := unitsAt(end)
		if line != currentLine {
			if err := flush(); err != nil {
				return found, false, err
			}
			currentLine = line
			lineText := text[lineStartBytes[line]:lineEndByte(lineStartBytes, line, len(text))]
			firstInLine := startUnit - lineStartUnits[line]
			snippet, snippetStart, snippetEnd, prefix, suffix := snippetWindow(lineText, firstInLine)
			pending = &SearchPart{
				Type:            "line",
				Path:            path,
				Line:            line + 1,
				Text:            snippet,
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
		pendingMatches = append(pendingMatches, SearchMatch{
			Start:          startUnit,
			End:            endUnit,
			Text:           clipUTF16(text[start:end], searchMatchTextLimit),
			Length:         endUnit - startUnit,
			HighlightStart: highlightStart,
			HighlightEnd:   highlightEnd,
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
func lineOffsets(text string) ([]int, []int) {
	bytes := []int{0}
	units := []int{0}
	unit := 0
	for index, r := range text {
		if r == '\n' {
			bytes = append(bytes, index+1)
			units = append(units, unit+1)
		}
		unit += runeUTF16Length(r)
	}
	return bytes, units
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
func snippetWindow(line string, firstStart int) (string, int, int, bool, bool) {
	lineLength := utf16Length(line)
	startUnit := firstStart - searchSnippetLead
	if startUnit < 0 {
		startUnit = 0
	}
	endUnit := startUnit + searchSnippetLimit
	if endUnit > lineLength {
		endUnit = lineLength
	}
	startByte := byteOffsetAtUTF16(line, startUnit)
	endByte := byteOffsetAfterUTF16(line, endUnit)
	text := line[startByte:endByte]
	actualStart := utf16Length(line[:startByte])
	actualEnd := actualStart + utf16Length(text)
	return text, actualStart, actualEnd, startByte > 0, endByte < len(line)
}

func byteOffsetAtUTF16(text string, offset int) int {
	unit := 0
	for index := 0; index < len(text); {
		if unit >= offset {
			return index
		}
		r, size := utf8.DecodeRuneInString(text[index:])
		unit += runeUTF16Length(r)
		if unit > offset {
			return index
		}
		index += size
	}
	return len(text)
}

func byteOffsetAfterUTF16(text string, offset int) int {
	if offset <= 0 {
		return 0
	}
	unit := 0
	for index := 0; index < len(text); {
		r, size := utf8.DecodeRuneInString(text[index:])
		unit += runeUTF16Length(r)
		index += size
		if unit >= offset {
			return index
		}
	}
	return len(text)
}

func utf16Length(text string) int {
	units := 0
	for _, r := range text {
		units += runeUTF16Length(r)
	}
	return units
}

func runeUTF16Length(r rune) int {
	if r > 0xFFFF {
		return 2
	}
	return 1
}

func clipUTF16(text string, limit int) string {
	units := 0
	for index, r := range text {
		width := runeUTF16Length(r)
		if units+width > limit {
			return text[:index]
		}
		units += width
	}
	return text
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
