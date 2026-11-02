package main

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestListDirectoryShowsFilesFoldersAndHiddenEntries(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{
		"README.md",
		"book.MD",
		"image.png",
		".draft.md",
		".nicole/state.json",
		"notes/daily.md",
		"node_modules/pkg/index.js",
		".git/config",
		".DS_Store",
		"Thumbs.db",
		"desktop.ini",
		".nicole-0123456789abcdef.tmp",
	} {
		mustWriteFile(t, filepath.Join(root, filepath.FromSlash(name)), []byte("x"))
	}
	if err := os.MkdirAll(filepath.Join(root, "empty"), 0o755); err != nil {
		t.Fatal(err)
	}

	workspace := openTestWorkspace(t, root)
	listing, err := workspace.ListDirectory(".")
	if err != nil {
		t.Fatal(err)
	}
	if listing.Path != "." {
		t.Errorf("Path = %q, want %q", listing.Path, ".")
	}
	names := make([]string, 0, len(listing.Entries))
	for _, entry := range listing.Entries {
		names = append(names, entry.Name)
	}
	expected := []string{
		".draft.md",
		".nicole",
		"README.md",
		"book.MD",
		"empty",
		"image.png",
		"node_modules",
		"notes",
	}
	if !reflect.DeepEqual(names, expected) {
		t.Errorf("entries = %q, want %q", names, expected)
	}

	byName := map[string]FileEntry{}
	for _, entry := range listing.Entries {
		byName[entry.Name] = entry
	}
	if !byName["README.md"].IsMarkdown || byName["README.md"].IsDir {
		t.Errorf("README.md = %+v, want a Markdown file", byName["README.md"])
	}
	if !byName["book.MD"].IsMarkdown {
		t.Errorf("book.MD = %+v, want Markdown", byName["book.MD"])
	}
	if byName["image.png"].IsMarkdown || byName["image.png"].Size != 1 {
		t.Errorf("image.png = %+v, want a non-Markdown file of size 1", byName["image.png"])
	}
	if !byName["empty"].IsDir || byName["empty"].IsMarkdown {
		t.Errorf("empty = %+v, want an empty folder", byName["empty"])
	}
	if !byName[".nicole"].IsDir {
		t.Errorf(".nicole = %+v, want a folder", byName[".nicole"])
	}
	if !byName["node_modules"].IsDir {
		t.Errorf("node_modules = %+v, want a folder", byName["node_modules"])
	}

	empty, err := workspace.ListDirectory("empty")
	if err != nil {
		t.Fatal(err)
	}
	if empty.Entries == nil || len(empty.Entries) != 0 {
		t.Errorf("empty folder entries = %#v, want an empty slice", empty.Entries)
	}
	nested, err := workspace.ListDirectory("node_modules")
	if err != nil {
		t.Fatal(err)
	}
	if len(nested.Entries) != 1 || nested.Entries[0].Path != "node_modules/pkg" {
		t.Errorf("node_modules entries = %+v", nested.Entries)
	}
}

func TestListDirectoryRejectsEscapes(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	for _, rel := range []string{"..", "../outside", "/absolute", "C:/absolute", `..\outside`, ".git", ".git/config"} {
		if _, err := workspace.ListDirectory(rel); err == nil {
			t.Errorf("ListDirectory(%q) succeeded, want an error", rel)
		}
	}
	if _, err := workspace.ListDirectory("missing"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("ListDirectory(missing) = %v, want a not-exist error", err)
	}
}

func TestResolveTreeEntryRejectsResolvedPathOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.txt"), []byte("note"))
	mustWriteFile(t, filepath.Join(outside, "secret.txt"), []byte("secret"))
	workspace := openTestWorkspace(t, root)
	resolvedRoot, _ := workspace.state.snapshot()

	original := evalTreeSymlinks
	evalTreeSymlinks = func(string) (string, error) {
		return filepath.Join(outside, "secret.txt"), nil
	}
	t.Cleanup(func() { evalTreeSymlinks = original })

	if _, _, err := resolveTreeEntry(resolvedRoot, "note.txt"); !errors.Is(err, errPathOutside) {
		t.Errorf("resolveTreeEntry() = %v, want %v", err, errPathOutside)
	}
}

func TestListDirectorySkipsSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "secret.md"), []byte("secret"))
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "secret.md")); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	listing, err := workspace.ListDirectory(".")
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Entries) != 0 {
		t.Errorf("listing includes symlinks: %+v", listing.Entries)
	}
	if _, err := workspace.ListDirectory("link"); !errors.Is(err, errSymlinkEntry) {
		t.Errorf("ListDirectory(link) = %v, want %v", err, errSymlinkEntry)
	}
}
