package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func runSearch(t *testing.T, workspace *Workspace, request SearchRequest) []SearchPart {
	t.Helper()
	parts, err := collectSearch(t, workspace, request)
	if err != nil {
		t.Fatalf("search(%q): %v", request.Query, err)
	}
	return parts
}

func collectSearch(t *testing.T, workspace *Workspace, request SearchRequest) ([]SearchPart, error) {
	t.Helper()
	if request.Generation == 0 {
		request.Generation = currentGeneration(workspace)
	}
	var parts []SearchPart
	err := workspace.search(context.Background(), request, func(part SearchPart) error {
		parts = append(parts, part)
		return nil
	})
	return parts, err
}

func searchLineParts(parts []SearchPart) []SearchPart {
	var lines []SearchPart
	for _, part := range parts {
		if part.Type == "line" {
			lines = append(lines, part)
		}
	}
	return lines
}

func searchDone(t *testing.T, parts []SearchPart) SearchPart {
	t.Helper()
	for _, part := range parts {
		if part.Type == "done" {
			return part
		}
	}
	t.Fatalf("no done part in %#v", parts)
	return SearchPart{}
}

func mustFingerprint(t *testing.T, text string) string {
	t.Helper()
	fingerprint, err := searchSignature(text, func() bool { return false })
	if err != nil {
		t.Fatalf("searchSignature(%q): %v", text, err)
	}
	return fingerprint
}

func TestSearchFingerprintVectors(t *testing.T) {
	for _, test := range []struct {
		text string
		want string
	}{
		{"", "cbf29ce484222325cbf29ce484222325"},
		{"a", "089be207b544f1e408326707b4eb37da"},
		{"中文😀foo", "5a605c943172cfd3bb1279579d8c64c7"},
		{"foo\nbar", "5b2c62f6f41bccb8e58535308d138ac6"},
	} {
		if got := mustFingerprint(t, test.text); got != test.want {
			t.Errorf("fingerprint(%q) = %q, want %q", test.text, got, test.want)
		}
	}
}

func TestSearchScopesRegularMarkdownFiles(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{
		"a.md",
		"B.MD",
		".draft.md",
		"notes/c.md",
		".hidden/d.md",
		"node_modules/e.md",
		"notes/node_modules/f.md",
		"image.png",
	} {
		mustWriteFile(t, filepath.Join(root, filepath.FromSlash(name)), []byte("needle "+name))
	}
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "outside.md"), []byte("needle outside"))
	linkFile := filepath.Join(root, "link.md")
	if err := os.Symlink(filepath.Join(outside, "outside.md"), linkFile); err == nil {
		linkDir := filepath.Join(root, "linkdir")
		if err := os.Symlink(outside, linkDir); err != nil {
			t.Logf("directory symlink not created: %v", err)
		}
		if err := os.Symlink(filepath.Join(".hidden", "d.md"), filepath.Join(root, "hidden-link.md")); err != nil {
			t.Logf("hidden file symlink not created: %v", err)
		}
	} else {
		t.Logf("file symlink not created: %v", err)
	}

	workspace := openTestWorkspace(t, root)
	parts := runSearch(t, workspace, SearchRequest{Query: "needle"})
	lines := searchLineParts(parts)
	var paths []string
	for _, line := range lines {
		paths = append(paths, line.Path)
	}
	sort.Strings(paths)
	want := []string{".draft.md", "B.MD", "a.md", "notes/c.md"}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("searched paths = %v, want %v", paths, want)
	}
	done := searchDone(t, parts)
	if done.FileCount != 4 || done.MatchCount != 4 || done.Truncated {
		t.Fatalf("done = %#v, want 4 files, 4 matches, not truncated", done)
	}
}

func TestSearchLiteralCaseAndRegex(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("Alpha alpha .* a.b\n"))
	workspace := openTestWorkspace(t, root)

	literal := runSearch(t, workspace, SearchRequest{Query: "alpha"})
	line := searchLineParts(literal)[0]
	if len(line.Matches) != 2 ||
		line.Matches[0].Column != 0 || line.Matches[1].Column != 6 {
		t.Fatalf("case-insensitive literal matches = %#v", line.Matches)
	}

	sensitive := runSearch(t, workspace, SearchRequest{Query: "alpha", CaseSensitive: true})
	line = searchLineParts(sensitive)[0]
	if len(line.Matches) != 1 || line.Matches[0].Column != 6 {
		t.Fatalf("case-sensitive literal matches = %#v", line.Matches)
	}

	dots := runSearch(t, workspace, SearchRequest{Query: "."})
	line = searchLineParts(dots)[0]
	if len(line.Matches) != 2 || line.Matches[0].Column != 12 || line.Matches[1].Column != 16 {
		t.Fatalf("literal dot matches = %#v, want columns 12 and 16", line.Matches)
	}

	regex := runSearch(t, workspace, SearchRequest{Query: `a\.b`, Regex: true})
	line = searchLineParts(regex)[0]
	if len(line.Matches) != 1 || line.Matches[0].Column != 15 {
		t.Fatalf("regex matches = %#v", line.Matches)
	}
	if line.Matches[0].Fingerprint != mustFingerprint(t, "a.b") {
		t.Fatalf("regex match fingerprint = %q", line.Matches[0].Fingerprint)
	}
}

func TestSearchRejectsInvalidRegex(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("text"))
	workspace := openTestWorkspace(t, root)
	_, err := collectSearch(t, workspace, SearchRequest{Query: "(?=lookahead)", Regex: true})
	if err == nil || !strings.Contains(err.Error(), "invalid search pattern") {
		t.Fatalf("search error = %v, want invalid search pattern", err)
	}
}

func TestSearchUsesUTF16OffsetsAndNormalizedNewlines(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("中文😀foo\r\n第二行 foo😀\r\n"))
	workspace := openTestWorkspace(t, root)
	parts := runSearch(t, workspace, SearchRequest{Query: "foo"})
	lines := searchLineParts(parts)
	if len(lines) != 2 {
		t.Fatalf("lines = %#v, want 2", lines)
	}
	first := lines[0]
	if first.Line != 1 || first.Text != "中文😀foo" {
		t.Fatalf("first line = %#v", first)
	}
	if first.LineFingerprint != mustFingerprint(t, "中文😀foo") {
		t.Fatalf("first line fingerprint = %q", first.LineFingerprint)
	}
	firstMatch := first.Matches[0]
	if firstMatch.Column != 4 || firstMatch.Length != 3 {
		t.Fatalf("first match position = %#v, want UTF-16 column 4 length 3", firstMatch)
	}
	if firstMatch.Fingerprint != mustFingerprint(t, "foo") {
		t.Fatalf("first match fingerprint = %q", firstMatch.Fingerprint)
	}
	if firstMatch.HighlightStart != 4 || firstMatch.HighlightEnd != 7 {
		t.Fatalf("first highlight = %#v", firstMatch)
	}
	second := lines[1]
	if second.Line != 2 || second.Text != "第二行 foo😀" {
		t.Fatalf("second line = %#v", second)
	}
	secondMatch := second.Matches[0]
	if secondMatch.Column != 4 || secondMatch.Length != 3 {
		t.Fatalf("second match position = %#v, want line column 4 length 3", secondMatch)
	}
	if secondMatch.HighlightStart != 4 || secondMatch.HighlightEnd != 7 {
		t.Fatalf("second highlight = %#v", secondMatch)
	}

	crRoot := t.TempDir()
	mustWriteFile(t, filepath.Join(crRoot, "note.md"), []byte("a\rb\r"))
	crWorkspace := openTestWorkspace(t, crRoot)
	crParts := runSearch(t, crWorkspace, SearchRequest{Query: "b"})
	crLines := searchLineParts(crParts)
	if len(crLines) != 1 || crLines[0].Line != 2 || crLines[0].Matches[0].Column != 0 {
		t.Fatalf("bare CR result = %#v", crLines)
	}
}

func TestSearchHandlesCrossLineAndEmptyMatches(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("foo\nbar"))
	workspace := openTestWorkspace(t, root)

	cross := runSearch(t, workspace, SearchRequest{Query: `foo\nbar`, Regex: true})
	lines := searchLineParts(cross)
	if len(lines) != 1 || lines[0].Line != 1 || lines[0].Text != "foo" {
		t.Fatalf("cross-line lines = %#v", lines)
	}
	match := lines[0].Matches[0]
	if match.Column != 0 || match.Length != 7 {
		t.Fatalf("cross-line match = %#v", match)
	}
	if match.Fingerprint != mustFingerprint(t, "foo\nbar") {
		t.Fatalf("cross-line fingerprint = %q", match.Fingerprint)
	}
	if match.EndLine != 2 || match.EndLineFingerprint != mustFingerprint(t, "bar") {
		t.Fatalf("cross-line end line = %#v", match)
	}
	if !match.StartsAtDocumentStart || !match.StartsAtLineStart ||
		!match.EndsAtDocumentEnd || !match.EndsAtLineEnd {
		t.Fatalf("cross-line boundary flags = %#v", match)
	}
	if match.HighlightStart != 0 || match.HighlightEnd != 3 {
		t.Fatalf("cross-line highlight = %#v", match)
	}
	if lines[0].LineFingerprint != mustFingerprint(t, "foo") {
		t.Fatalf("cross-line line fingerprint = %q", lines[0].LineFingerprint)
	}
	done := searchDone(t, cross)
	if done.MatchCount != 1 || done.FileCount != 1 {
		t.Fatalf("cross-line done = %#v", done)
	}

	zeroRoot := t.TempDir()
	mustWriteFile(t, filepath.Join(zeroRoot, "note.md"), []byte("a\nb"))
	zeroWorkspace := openTestWorkspace(t, zeroRoot)
	zero := runSearch(t, zeroWorkspace, SearchRequest{Query: "(?m)^", Regex: true})
	zeroLines := searchLineParts(zero)
	if len(zeroLines) != 2 {
		t.Fatalf("zero-width lines = %#v, want 2", zeroLines)
	}
	if zeroLines[0].Matches[0].Column != 0 || zeroLines[1].Matches[0].Column != 0 {
		t.Fatalf("zero-width columns = %#v", zeroLines)
	}
	if zeroLines[0].Matches[0].Length != 0 ||
		zeroLines[0].Matches[0].Fingerprint != mustFingerprint(t, "") {
		t.Fatalf("zero-width match = %#v", zeroLines[0].Matches[0])
	}
	if done := searchDone(t, zero); done.MatchCount != 2 {
		t.Fatalf("zero-width done = %#v", done)
	}

	// A pattern that can always match the empty string must still advance.
	repeatRoot := t.TempDir()
	mustWriteFile(t, filepath.Join(repeatRoot, "note.md"), []byte("bbb"))
	repeatWorkspace := openTestWorkspace(t, repeatRoot)
	repeat := runSearch(t, repeatWorkspace, SearchRequest{Query: "a*", Regex: true})
	if done := searchDone(t, repeat); done.MatchCount != 4 {
		t.Fatalf("a* done = %#v, want 4 empty matches", done)
	}
}

func TestSearchMatchLimitDistinguishesExactFromTruncated(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte(strings.Repeat("x ", 1000)))
	workspace := openTestWorkspace(t, root)

	exact := runSearch(t, workspace, SearchRequest{Query: "x"})
	exactDone := searchDone(t, exact)
	if exactDone.MatchCount != 1000 || exactDone.Truncated {
		t.Fatalf("exact limit done = %#v, want 1000 and not truncated", exactDone)
	}
	if matches := len(searchLineParts(exact)[0].Matches); matches != 1000 {
		t.Fatalf("exact limit sent %d matches, want 1000", matches)
	}

	mustWriteFile(t, filepath.Join(root, "note.md"), []byte(strings.Repeat("x ", 1000)+"x"))
	over := runSearch(t, workspace, SearchRequest{Query: "x"})
	overDone := searchDone(t, over)
	if overDone.MatchCount != 1000 || !overDone.Truncated {
		t.Fatalf("over limit done = %#v, want 1000 and truncated", overDone)
	}
	if matches := len(searchLineParts(over)[0].Matches); matches != 1000 {
		t.Fatalf("over limit sent %d matches, want 1000", matches)
	}
}

func TestSearchStreamsLinesBeforeDone(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("needle a"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("needle b"))
	workspace := openTestWorkspace(t, root)
	parts := runSearch(t, workspace, SearchRequest{Query: "needle"})
	if len(parts) != 3 {
		t.Fatalf("parts = %#v, want two lines then done", parts)
	}
	if parts[0].Type != "line" || parts[0].Path != "a.md" {
		t.Fatalf("first part = %#v", parts[0])
	}
	if parts[1].Type != "line" || parts[1].Path != "b.md" {
		t.Fatalf("second part = %#v", parts[1])
	}
	if parts[2].Type != "done" {
		t.Fatalf("last part = %#v, want done", parts[2])
	}
}

func TestSearchStopsWhenCanceled(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("needle a"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("needle b"))
	workspace := openTestWorkspace(t, root)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var parts []SearchPart
	err := workspace.search(ctx, SearchRequest{
		Generation: currentGeneration(workspace),
		Query:      "needle",
	}, func(part SearchPart) error {
		parts = append(parts, part)
		cancel()
		return nil
	})
	if err != nil {
		t.Fatalf("search after cancel: %v", err)
	}
	if len(parts) != 1 || parts[0].Type != "line" {
		t.Fatalf("parts after cancel = %#v, want one line and no done", parts)
	}
}

func TestSearchStopsWhenWorkspaceChanges(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("needle a"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("needle b"))
	workspace := openTestWorkspace(t, root)
	var parts []SearchPart
	err := workspace.search(context.Background(), SearchRequest{
		Generation: currentGeneration(workspace),
		Query:      "needle",
	}, func(part SearchPart) error {
		parts = append(parts, part)
		workspace.state.replace(root)
		return nil
	})
	if err != nil {
		t.Fatalf("search after workspace change: %v", err)
	}
	if len(parts) != 1 || parts[0].Type != "line" {
		t.Fatalf("parts after workspace change = %#v, want one line and no done", parts)
	}
}

func TestSearchReturnsEmitError(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("needle"))
	workspace := openTestWorkspace(t, root)
	sentinel := errors.New("page went away")
	err := workspace.search(context.Background(), SearchRequest{
		Generation: currentGeneration(workspace),
		Query:      "needle",
	}, func(SearchPart) error {
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("search error = %v, want emit error", err)
	}
}

func TestSearchNeedsWorkspaceAndCurrentGeneration(t *testing.T) {
	empty := NewWorkspace()
	if _, err := collectSearch(t, empty, SearchRequest{Query: "x", Generation: 1}); !errors.Is(err, errNoWorkspace) {
		t.Fatalf("search without workspace error = %v, want no workspace", err)
	}

	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("x"))
	workspace := openTestWorkspace(t, root)
	_, err := collectSearch(t, workspace, SearchRequest{Query: "x", Generation: currentGeneration(workspace) + 1})
	if !errors.Is(err, errWorkspaceChange) {
		t.Fatalf("stale generation error = %v, want workspace change", err)
	}
}

func TestSearchBoundsLongSnippets(t *testing.T) {
	root := t.TempDir()
	line := strings.Repeat("a", 1500) + "needle" + strings.Repeat("b", 1500)
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte(line))
	workspace := openTestWorkspace(t, root)
	parts := runSearch(t, workspace, SearchRequest{Query: "needle"})
	lines := searchLineParts(parts)
	if len(lines) != 1 {
		t.Fatalf("long line parts = %#v", lines)
	}
	result := lines[0]
	if !result.PrefixTruncated || !result.SuffixTruncated {
		t.Fatalf("long line truncation flags = %#v", result)
	}
	if utf16Length(result.Text) > searchSnippetLimit+2 {
		t.Fatalf("snippet has %d UTF-16 units, want at most %d", utf16Length(result.Text), searchSnippetLimit+2)
	}
	match := result.Matches[0]
	if match.Column != 1500 || match.Length != 6 {
		t.Fatalf("long line match position = %#v", match)
	}
	if match.Fingerprint != mustFingerprint(t, "needle") {
		t.Fatalf("long line match fingerprint = %q", match.Fingerprint)
	}
	if result.LineFingerprint != mustFingerprint(t, line) {
		t.Fatalf("long line fingerprint does not cover the full line")
	}
	if match.HighlightStart < 0 || match.HighlightEnd-match.HighlightStart != 6 {
		t.Fatalf("long line highlight = %#v", match)
	}
}

func TestSearchReportsReadErrors(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("file permissions do not block reads on this platform or user")
	}
	root := t.TempDir()
	name := filepath.Join(root, "note.md")
	mustWriteFile(t, name, []byte("needle"))
	if err := os.Chmod(name, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(name, 0o644) })
	workspace := openTestWorkspace(t, root)
	_, err := collectSearch(t, workspace, SearchRequest{Query: "needle"})
	if !errors.Is(err, os.ErrPermission) {
		t.Fatalf("search error = %v, want permission error", err)
	}
}

func TestReadSearchFileRejectsReplacementLinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation needs Developer Mode on Windows")
	}
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, ".hidden", "secret.md"), []byte("secret"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("public"))
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer rootFS.Close()

	data, err := readSearchFile(rootFS, "b.md", func() bool { return false })
	if err != nil || string(data) != "public" {
		t.Fatalf("read regular file = %q, %v", data, err)
	}

	if err := os.Remove(filepath.Join(root, "b.md")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(".hidden", "secret.md"), filepath.Join(root, "b.md")); err != nil {
		t.Skipf("cannot create a file symlink: %v", err)
	}
	if data, err := readSearchFile(rootFS, "b.md", func() bool { return false }); !errors.Is(err, errSearchSkip) || data != nil {
		t.Fatalf("replaced file link = %q, %v; want skipped", data, err)
	}

	mustWriteFile(t, filepath.Join(root, "notes", "c.md"), []byte("visible"))
	mustWriteFile(t, filepath.Join(root, ".hidden", "d.md"), []byte("hidden"))
	if err := os.RemoveAll(filepath.Join(root, "notes")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(".hidden", filepath.Join(root, "notes")); err != nil {
		t.Skipf("cannot create a directory symlink: %v", err)
	}
	if data, err := readSearchFile(rootFS, "notes/c.md", func() bool { return false }); !errors.Is(err, errSearchSkip) || data != nil {
		t.Fatalf("replaced directory link = %q, %v; want skipped", data, err)
	}

	if err := os.Mkdir(filepath.Join(root, "folder.md"), 0o755); err != nil {
		t.Fatal(err)
	}
	if data, err := readSearchFile(rootFS, "folder.md", func() bool { return false }); !errors.Is(err, errSearchSkip) || data != nil {
		t.Fatalf("non-regular target = %q, %v; want skipped", data, err)
	}
}

func TestSearchChecksCancellationDuringNonMarkdownWalk(t *testing.T) {
	root := t.TempDir()
	for index := 0; index < 200; index++ {
		mustWriteFile(t, filepath.Join(root, "plain", fmt.Sprintf("%d.txt", index)), []byte("x"))
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer rootFS.Close()
	calls := 0
	const cancelAfter = 10
	var parts []SearchPart
	err = searchRoot(
		rootFS,
		regexp.MustCompile("x"),
		func(part SearchPart) error {
			parts = append(parts, part)
			return nil
		},
		func() bool {
			calls++
			return calls >= cancelAfter
		},
	)
	if err != nil {
		t.Fatalf("searchRoot after cancellation: %v", err)
	}
	if calls != cancelAfter {
		t.Fatalf("cancellation checks = %d, want %d while walking non-Markdown entries", calls, cancelAfter)
	}
	if len(parts) != 0 {
		t.Fatalf("parts after walk cancellation = %#v", parts)
	}
}

func TestSearchDoesNotFlushPendingLineAfterGenerationChange(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("needle\nneedle\n"))
	workspace := openTestWorkspace(t, root)
	var parts []SearchPart
	err := workspace.search(context.Background(), SearchRequest{
		Generation: currentGeneration(workspace),
		Query:      "needle",
	}, func(part SearchPart) error {
		parts = append(parts, part)
		workspace.state.replace(root)
		return nil
	})
	if err != nil {
		t.Fatalf("search after same-file generation change: %v", err)
	}
	if len(parts) != 1 || parts[0].Type != "line" || parts[0].Line != 1 {
		t.Fatalf("parts after same-file generation change = %#v, want only line 1", parts)
	}
}

func TestSearchRecordsAnchorBoundaries(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("foo"))
	workspace := openTestWorkspace(t, root)
	parts := runSearch(t, workspace, SearchRequest{Query: `foo$`, Regex: true})
	line := searchLineParts(parts)[0]
	match := line.Matches[0]
	if !match.StartsAtDocumentStart || !match.StartsAtLineStart ||
		!match.EndsAtDocumentEnd || !match.EndsAtLineEnd {
		t.Fatalf("document-end match boundaries = %#v", match)
	}
	if match.EndLine != 1 || match.EndLineFingerprint != mustFingerprint(t, "foo") {
		t.Fatalf("document-end match end line = %#v", match)
	}
}
