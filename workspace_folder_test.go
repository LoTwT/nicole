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
	service := NewSingleFileService()
	service.offer(file)
	workspace := NewWorkspace()
	workspace.useOfferedFiles(service.offeredPaths, service.takeOfferedFolder)

	folder, err := workspace.OpenFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	if folder.Root != root {
		t.Errorf("OpenFolder(%q).Root = %q, want %q", root, folder.Root, root)
	}
	if paths := service.offeredPaths(); len(paths) != 0 {
		t.Errorf("offered paths after opening the parent = %q, want none", paths)
	}
}

func TestForbiddenWorkspaceRoot(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skipf("no home folder: %v", err)
	}
	if !forbiddenWorkspaceRoot(string(filepath.Separator)) {
		t.Error("filesystem root is not forbidden")
	}
	if !forbiddenWorkspaceRoot(filepath.Clean(home)) {
		t.Errorf("home folder %q is not forbidden", home)
	}
	if forbiddenWorkspaceRoot(t.TempDir()) {
		t.Error("a temporary folder was treated as forbidden")
	}
}

func TestOpenFolderAllowsPickedAndCurrentHome(t *testing.T) {
	home := resolveTestPath(t, t.TempDir())
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	workspace := NewWorkspace()
	workspace.lastPicked = home

	if _, err := workspace.OpenFolder(home); err != nil {
		t.Fatalf("OpenFolder(picked home) = %v, want success", err)
	}
	if _, err := workspace.OpenFolder(home); err != nil {
		t.Fatalf("OpenFolder(current home) = %v, want success", err)
	}
}

func TestOpenFolderAllowsRecentHome(t *testing.T) {
	home := resolveTestPath(t, t.TempDir())
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	if err := store.update(func(settings *AppSettings) {
		settings.RecentFolders = []string{home}
	}); err != nil {
		t.Fatal(err)
	}
	workspace := NewWorkspace()
	workspace.useSettings(store)

	if _, err := workspace.OpenFolder(home); err != nil {
		t.Fatalf("OpenFolder(recent home) = %v, want success", err)
	}
}

func TestOpenFolderRejectsOfferedParentInHome(t *testing.T) {
	home := resolveTestPath(t, t.TempDir())
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	file := filepath.Join(home, "note.md")
	if err := os.WriteFile(file, []byte("text"), 0o644); err != nil {
		t.Fatal(err)
	}
	service := NewSingleFileService()
	service.offer(file)
	workspace := NewWorkspace()
	workspace.useOfferedFiles(service.offeredPaths, service.takeOfferedFolder)

	if _, err := workspace.OpenFolder(home); !errors.Is(err, errFolderForbidden) {
		t.Fatalf("OpenFolder(offered home) = %v, want %v", err, errFolderForbidden)
	}
	if root, _ := workspace.state.snapshot(); root != "" {
		t.Errorf("offered home was opened as %q, want no workspace", root)
	}
}

func TestOpenFolderRecordsRecentAfterSuccess(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	workspace := NewWorkspace()
	workspace.useSettings(store)
	workspace.lastPicked = root

	if _, err := workspace.OpenFolder(root); err != nil {
		t.Fatal(err)
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.RecentFolders) != 1 || settings.RecentFolders[0] != root {
		t.Errorf("recent folders = %q, want [%q]", settings.RecentFolders, root)
	}
}

func TestSettingsAddRecentFolderCannotAuthorizeAnotherFolder(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	other := resolveTestPath(t, t.TempDir())
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	workspace := NewWorkspace()
	workspace.useSettings(store)
	workspace.lastPicked = root
	if _, err := workspace.OpenFolder(root); err != nil {
		t.Fatal(err)
	}

	settings := NewSettings(store)
	settings.useCurrentRoot(workspace.openRoot)
	if err := settings.AddRecentFolder(other); !errors.Is(err, errRecentFolderNotCurrent) {
		t.Fatalf("AddRecentFolder(other) = %v, want %v", err, errRecentFolderNotCurrent)
	}
	if _, err := workspace.OpenFolder(other); !errors.Is(err, errFolderNotChosen) {
		t.Errorf("OpenFolder(other) = %v, want %v", err, errFolderNotChosen)
	}
	if err := settings.AddRecentFolder(root); err != nil {
		t.Errorf("AddRecentFolder(current root) = %v, want success", err)
	}
}
