package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func resolveTestPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return resolved
}

func TestOpenFolderAcceptsOnlyKnownFolders(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	other := resolveTestPath(t, t.TempDir())
	workspace := NewWorkspace()

	if _, err := workspace.OpenFolder(other); !errors.Is(err, errFolderNotChosen) {
		t.Fatalf("OpenFolder(arbitrary) error = %v, want errFolderNotChosen", err)
	}

	settings := newSettingsStoreIn(filepath.Join(t.TempDir(), "settings.json"))
	if err := settings.update(func(settings *AppSettings) {
		settings.RecentFolders = []string{root}
	}); err != nil {
		t.Fatal(err)
	}
	workspace.useSettings(settings)

	folder, err := workspace.OpenFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if folder.Root != root {
		t.Errorf("OpenFolder(%q).Root = %q, want %q", root, folder.Root, root)
	}

	if _, err := workspace.OpenFolder(other); !errors.Is(err, errFolderNotChosen) {
		t.Fatalf("OpenFolder(other) error = %v, want errFolderNotChosen", err)
	}
}

func TestOpenFolderAcceptsTheLastPickOnce(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	workspace := NewWorkspace()
	workspace.lastPicked = root

	if _, err := workspace.OpenFolder(root); err != nil {
		t.Fatal(err)
	}
	if workspace.lastPicked != "" {
		t.Errorf("lastPicked = %q, want empty after use", workspace.lastPicked)
	}
}

func TestOpenFolderAcceptsTheParentOfAnOfferedFile(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	file := filepath.Join(root, "note.md")
	if err := os.WriteFile(file, []byte("text"), 0o644); err != nil {
		t.Fatal(err)
	}
	workspace := NewWorkspace()
	workspace.useOfferedFiles(func() []string { return []string{file} })

	folder, err := workspace.OpenFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if folder.Root != root {
		t.Errorf("OpenFolder(%q).Root = %q, want %q", root, folder.Root, root)
	}
}
