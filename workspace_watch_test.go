package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestIgnoreWatchEntryKeepsNonMarkdownFiles(t *testing.T) {
	for _, tc := range []struct {
		path  string
		isDir bool
		want  bool
	}{
		{".git", true, true},
		{".obsidian", true, true},
		{"docs/node_modules", true, true},
		{"node_modules/pkg", true, false}, // the parent is skipped first
		{".nicole-0123456789abcdef.tmp", false, true},
		{"docs/.nicole-0123456789abcdef.tmp", false, true},
		{".DS_Store", false, true},
		{"Thumbs.db", false, true},
		{"desktop.ini", false, true},
		{".draft.md", false, false},
		{"notes.md", false, false},
		{"image.png", false, false},
		{"document.pdf", false, false},
		{"node_modules", false, false},
	} {
		if got := ignoreWatchEntry(tc.path, tc.isDir); got != tc.want {
			t.Errorf("ignoreWatchEntry(%q, %v) = %v, want %v", tc.path, tc.isDir, got, tc.want)
		}
	}
}

func TestSelfWritesSuppressOwnContent(t *testing.T) {
	root := t.TempDir()
	writes := newSelfWrites()
	now := time.Now()
	writes.now = func() time.Time { return now }

	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("written"), 0o644); err != nil {
		t.Fatal(err)
	}
	writes.record("note.md", []byte("written"))

	for _, op := range []mygo.FileOp{mygo.FileWrite, mygo.FileCreate} {
		if !writes.suppress(root, mygo.FileEvent{Op: op, Path: "note.md"}) {
			t.Errorf("suppress(%s) = false, want true", op)
		}
	}
	for _, op := range []mygo.FileOp{mygo.FileRemove, mygo.FileRename, mygo.FileHint} {
		if writes.suppress(root, mygo.FileEvent{Op: op, Path: "note.md"}) {
			t.Errorf("suppress(%s) = true, want false", op)
		}
	}
	if writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "note.md", IsDir: true}) {
		t.Error("suppress() suppressed a folder event")
	}
	if writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "other.md"}) {
		t.Error("suppress() suppressed a path that was not written")
	}

	// Another program changing the file makes the event external again.
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("external"), 0o644); err != nil {
		t.Fatal(err)
	}
	if writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "note.md"}) {
		t.Error("suppress() hid an external edit")
	}
}

func TestWriteFileRecordsTheWriteForTheWatch(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("old"))
	workspace := openTestWorkspace(t, root)
	if err := workspace.WriteFile("note.md", "new", currentGeneration(workspace)); err != nil {
		t.Fatal(err)
	}
	if !workspace.writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "note.md"}) {
		t.Error("WriteFile did not record its write; the watch would report it as external")
	}
}

func TestSelfWritesExpire(t *testing.T) {
	root := t.TempDir()
	writes := newSelfWrites()
	now := time.Now()
	writes.now = func() time.Time { return now }
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	writes.record("note.md", []byte("x"))
	now = now.Add(selfWriteWindow + time.Second)
	if writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "note.md"}) {
		t.Error("suppress() hid a write after the record expired")
	}
}

func TestSelfWritesForget(t *testing.T) {
	root := t.TempDir()
	writes := newSelfWrites()
	if err := os.WriteFile(filepath.Join(root, "note.md"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	writes.record("note.md", []byte("x"))
	writes.forget("note.md")
	if writes.suppress(root, mygo.FileEvent{Op: mygo.FileWrite, Path: "note.md"}) {
		t.Error("suppress() still suppressed a forgotten write")
	}
}

func TestSelfWritesRecordPrunesOldEntries(t *testing.T) {
	writes := newSelfWrites()
	now := time.Now()
	writes.now = func() time.Time { return now }
	writes.record("old.md", []byte("old"))
	now = now.Add(selfWriteWindow + time.Second)
	writes.record("new.md", []byte("new"))
	if _, ok := writes.records["old.md"]; ok {
		t.Error("record() kept an expired entry")
	}
	if _, ok := writes.records["new.md"]; !ok {
		t.Error("record() dropped the newest entry")
	}
}

func TestWatchChecksGenerationBeforeStarting(t *testing.T) {
	workspace := openTestWorkspace(t, t.TempDir())
	generation := currentGeneration(workspace)
	var parts *mygo.Channel[FileWatchPart]
	if err := workspace.Watch(context.Background(), generation-1, parts); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("Watch(stale) = %v, want %v", err, errWorkspaceChange)
	}
	if err := workspace.Watch(context.Background(), generation, parts); err == nil {
		t.Error("Watch(nil channel) succeeded, want an error")
	}
	noWorkspace := NewWorkspace()
	if err := noWorkspace.Watch(context.Background(), 1, parts); !errors.Is(err, errNoWorkspace) {
		t.Errorf("Watch(no workspace) = %v, want %v", err, errNoWorkspace)
	}
}
