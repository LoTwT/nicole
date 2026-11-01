package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type systemActionLog struct {
	trashed  []string
	revealed []string
	opened   []string
}

func stubSystemActions(t *testing.T) *systemActionLog {
	t.Helper()
	log := &systemActionLog{}
	originalTrash := trashWorkspaceItem
	originalReveal := revealWorkspaceItem
	originalOpen := openWorkspaceItem
	trashWorkspaceItem = func(path string) error {
		log.trashed = append(log.trashed, path)
		return nil
	}
	revealWorkspaceItem = func(path string) {
		log.revealed = append(log.revealed, path)
	}
	openWorkspaceItem = func(path string) error {
		log.opened = append(log.opened, path)
		return nil
	}
	t.Cleanup(func() {
		trashWorkspaceItem = originalTrash
		revealWorkspaceItem = originalReveal
		openWorkspaceItem = originalOpen
	})
	return log
}

func TestCreateFileAddsMarkdownExtension(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	path, err := workspace.CreateFile(".", "first", generation)
	if err != nil {
		t.Fatal(err)
	}
	if path != "first.md" {
		t.Errorf("CreateFile() = %q, want first.md", path)
	}
	data, err := os.ReadFile(filepath.Join(root, "first.md"))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 0 {
		t.Errorf("new file content = %q, want empty", data)
	}

	path, err = workspace.CreateFile("notes", "draft.md", generation)
	if err != nil {
		t.Fatal(err)
	}
	if path != "notes/draft.md" {
		t.Errorf("CreateFile(notes) = %q, want notes/draft.md", path)
	}

	if _, err := workspace.CreateFile(".", "first", generation); !errors.Is(err, errTargetExists) {
		t.Errorf("CreateFile(existing) = %v, want %v", err, errTargetExists)
	}
	if _, err := workspace.CreateFile(".", "image.png", generation); !errors.Is(err, errNotMarkdown) {
		t.Errorf("CreateFile(image.png) = %v, want %v", err, errNotMarkdown)
	}
	for _, name := range []string{"", ".", "..", "../escape.md", `/absolute.md`, `..\escape.md`, "a:b.md", ".DS_Store"} {
		if _, err := workspace.CreateFile(".", name, generation); err == nil {
			t.Errorf("CreateFile(%q) succeeded, want an error", name)
		}
	}
	if _, err := workspace.CreateFile("missing", "note", generation); err == nil {
		t.Error("CreateFile in a missing folder succeeded")
	}
	if _, err := workspace.CreateFile(".", "note", generation-1); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("CreateFile(stale) = %v, want %v", err, errWorkspaceChange)
	}
}

func TestCreateFolder(t *testing.T) {
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	path, err := workspace.CreateFolder(".", "empty", generation)
	if err != nil {
		t.Fatal(err)
	}
	if path != "empty" {
		t.Errorf("CreateFolder() = %q, want empty", path)
	}
	info, err := os.Stat(filepath.Join(root, "empty"))
	if err != nil || !info.IsDir() {
		t.Fatalf("folder not created: %v", err)
	}
	if _, err := workspace.CreateFolder(".", "empty", generation); !errors.Is(err, errTargetExists) {
		t.Errorf("CreateFolder(existing) = %v, want %v", err, errTargetExists)
	}
	if _, err := workspace.CreateFolder(".", "a/b", generation); err == nil {
		t.Error("CreateFolder accepted a path instead of a name")
	}
	if _, err := workspace.CreateFolder(".", "note", generation-1); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("CreateFolder(stale) = %v, want %v", err, errWorkspaceChange)
	}
}

func TestRenameEntry(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("content"))
	mustWriteFile(t, filepath.Join(root, "other.md"), []byte("other"))
	if err := os.MkdirAll(filepath.Join(root, "folder", "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	path, err := workspace.RenameEntry("note.md", "renamed.md", generation)
	if err != nil {
		t.Fatal(err)
	}
	if path != "renamed.md" {
		t.Errorf("RenameEntry() = %q, want renamed.md", path)
	}
	data, err := os.ReadFile(filepath.Join(root, "renamed.md"))
	if err != nil || string(data) != "content" {
		t.Fatalf("renamed content = %q, %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(root, "note.md")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("old name still exists: %v", err)
	}

	if _, err := workspace.RenameEntry("renamed.md", "other.md", generation); !errors.Is(err, errTargetExists) {
		t.Errorf("RenameEntry(existing) = %v, want %v", err, errTargetExists)
	}
	if _, err := workspace.RenameEntry("renamed.md", "renamed.md", generation); err != nil {
		t.Errorf("RenameEntry(same name) = %v, want nil", err)
	}
	if _, err := workspace.RenameEntry("folder", "renamed-folder", generation); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(root, "renamed-folder", "child")); err != nil || !info.IsDir() {
		t.Fatalf("renamed folder lost its child: %v", err)
	}
	for _, name := range []string{"", ".", "..", "a/b", `a\b`, "a:b", ".DS_Store"} {
		if _, err := workspace.RenameEntry("renamed.md", name, generation); err == nil {
			t.Errorf("RenameEntry(name %q) succeeded, want an error", name)
		}
	}
	if _, err := workspace.RenameEntry("missing.md", "new.md", generation); err == nil {
		t.Error("RenameEntry(missing) succeeded")
	}
	if _, err := workspace.RenameEntry("renamed.md", "new.md", generation-1); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("RenameEntry(stale) = %v, want %v", err, errWorkspaceChange)
	}
}

func TestTrashEntryUsesTheGuard(t *testing.T) {
	log := stubSystemActions(t)
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "note.md"), []byte("x"))
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	resolvedRoot, _ := workspace.state.snapshot()

	if err := workspace.TrashEntry("note.md", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.TrashEntry("folder", generation); err != nil {
		t.Fatal(err)
	}
	if len(log.trashed) != 2 {
		t.Fatalf("trashed = %q, want two items", log.trashed)
	}
	if log.trashed[0] != filepath.Join(resolvedRoot, "note.md") || log.trashed[1] != filepath.Join(resolvedRoot, "folder") {
		t.Errorf("trashed = %q", log.trashed)
	}
	for _, rel := range []string{".", "..", "../escape", "/absolute", ".git"} {
		if err := workspace.TrashEntry(rel, generation); err == nil {
			t.Errorf("TrashEntry(%q) succeeded, want an error", rel)
		}
	}
	if err := workspace.TrashEntry("note.md", generation-1); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("TrashEntry(stale) = %v, want %v", err, errWorkspaceChange)
	}
	if len(log.trashed) != 2 {
		t.Errorf("refused operations reached the trash: %q", log.trashed)
	}
}

func TestTrashEntryRejectsSymlinkEscapes(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	stubSystemActions(t)
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "secret.md"), []byte("secret"))
	if err := os.Symlink(filepath.Join(outside, "secret.md"), filepath.Join(root, "secret.md")); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	if err := workspace.TrashEntry("secret.md", currentGeneration(workspace)); !errors.Is(err, errSymlinkEntry) {
		t.Errorf("TrashEntry(symlink) = %v, want %v", err, errSymlinkEntry)
	}
}

func TestOpenAndRevealUseTheGuard(t *testing.T) {
	log := stubSystemActions(t)
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "image.png"), []byte("png"))
	if err := os.MkdirAll(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	resolvedRoot, _ := workspace.state.snapshot()

	if err := workspace.OpenWithDefaultApp("image.png", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.OpenWithDefaultApp("folder", generation); !errors.Is(err, errNotRegular) {
		t.Errorf("OpenWithDefaultApp(folder) = %v, want %v", err, errNotRegular)
	}
	if err := workspace.OpenWithDefaultApp("../escape", generation); err == nil {
		t.Error("OpenWithDefaultApp(escape) succeeded")
	}
	if err := workspace.OpenWithDefaultApp("image.png", generation-1); !errors.Is(err, errWorkspaceChange) {
		t.Errorf("OpenWithDefaultApp(stale) = %v, want %v", err, errWorkspaceChange)
	}

	if err := workspace.RevealEntry(".", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.RevealEntry("image.png", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.RevealEntry("folder", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.RevealEntry("../escape", generation); err == nil {
		t.Error("RevealEntry(escape) succeeded")
	}
	if len(log.opened) != 1 || log.opened[0] != filepath.Join(resolvedRoot, "image.png") {
		t.Errorf("opened = %q", log.opened)
	}
	if len(log.revealed) != 3 || log.revealed[0] != resolvedRoot || log.revealed[1] != filepath.Join(resolvedRoot, "image.png") {
		t.Errorf("revealed = %q", log.revealed)
	}
}

func TestFileOperationsRequireWorkspace(t *testing.T) {
	workspace := NewWorkspace()
	if _, err := workspace.CreateFile(".", "note", 1); !errors.Is(err, errNoWorkspace) {
		t.Errorf("CreateFile() = %v, want %v", err, errNoWorkspace)
	}
	if _, err := workspace.ListDirectory("."); !errors.Is(err, errNoWorkspace) {
		t.Errorf("ListDirectory() = %v, want %v", err, errNoWorkspace)
	}
	if err := workspace.TrashEntry("note.md", 1); !errors.Is(err, errNoWorkspace) {
		t.Errorf("TrashEntry() = %v, want %v", err, errNoWorkspace)
	}
}

func TestFileOperationsRejectSymlinkedFolders(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	if _, err := workspace.CreateFile("link", "note", generation); err == nil {
		t.Error("CreateFile through a symlinked folder succeeded")
	}
	if _, err := workspace.CreateFolder("link", "folder", generation); err == nil {
		t.Error("CreateFolder through a symlinked folder succeeded")
	}
	if _, err := workspace.ListDirectory("link"); !errors.Is(err, errSymlinkEntry) {
		t.Errorf("ListDirectory(link) = %v, want %v", err, errSymlinkEntry)
	}
	if _, err := os.Stat(filepath.Join(outside, "note.md")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("CreateFile wrote outside the workspace: %v", err)
	}
}
