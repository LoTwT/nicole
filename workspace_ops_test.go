package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/egoist/mygo"
)

type systemActionLog struct {
	trashed  []string
	revealed []string
	opened   []string
}

type openConfirmationLog struct {
	calls      int
	name       string
	executable bool
	allow      bool
	err        error
	during     func()
}

func stubOpenConfirmation(t *testing.T, log *openConfirmationLog) {
	t.Helper()
	original := confirmRiskyOpen
	confirmRiskyOpen = func(_ *mygo.Window, name string, executable bool) (bool, error) {
		log.calls++
		log.name = name
		log.executable = executable
		if log.during != nil {
			log.during()
		}
		return log.allow, log.err
	}
	t.Cleanup(func() { confirmRiskyOpen = original })
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
	// The slash-only check must run before the filesystem: with an existing
	// folder named a, the old implementation would have renamed the file to
	// a/b instead of rejecting the name.
	if err := os.Mkdir(filepath.Join(root, "a"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.RenameEntry("renamed.md", "a/b", generation); !errors.Is(err, errInvalidName) {
		t.Errorf("RenameEntry(a/b with folder a) = %v, want %v", err, errInvalidName)
	}
	if _, err := os.Stat(filepath.Join(root, "a", "b")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("RenameEntry created a/b: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "renamed.md")); err != nil {
		t.Errorf("source disappeared after rejected rename: %v", err)
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

	if err := workspace.OpenWithDefaultApp(context.Background(), "image.png", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.OpenWithDefaultApp(context.Background(), "folder", generation); !errors.Is(err, errNotRegular) {
		t.Errorf("OpenWithDefaultApp(folder) = %v, want %v", err, errNotRegular)
	}
	if err := workspace.OpenWithDefaultApp(context.Background(), "../escape", generation); err == nil {
		t.Error("OpenWithDefaultApp(escape) succeeded")
	}
	if err := workspace.OpenWithDefaultApp(context.Background(), "image.png", generation-1); !errors.Is(err, errWorkspaceChange) {
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

func TestOpenWithDefaultAppAllowsKnownDocumentAndImageTypes(t *testing.T) {
	log := stubSystemActions(t)
	confirmation := &openConfirmationLog{}
	stubOpenConfirmation(t, confirmation)
	root := t.TempDir()
	for _, name := range []string{"photo.png", "paper.pdf", "notes.txt", "report.docx"} {
		mustWriteFile(t, filepath.Join(root, name), []byte("x"))
	}
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	for _, name := range []string{"photo.png", "paper.pdf", "notes.txt", "report.docx"} {
		if err := workspace.OpenWithDefaultApp(context.Background(), name, generation); err != nil {
			t.Errorf("OpenWithDefaultApp(%q) = %v, want nil", name, err)
		}
	}
	if len(log.opened) != 4 {
		t.Errorf("opened = %q, want four files", log.opened)
	}
	if confirmation.calls != 0 {
		t.Errorf("confirmation calls = %d, want none for the direct list", confirmation.calls)
	}
}

func TestOpenWithDefaultAppRejectsLaunchers(t *testing.T) {
	for _, name := range []string{
		"run.bat", "run.exe", "run.ps1", "run.command", "run.desktop", "run.jar", "run.lnk",
		"run.application", "run.appref-ms", "run.settingcontent-ms", "run.msp", "run.chm", "run.jnlp", "run.ws",
	} {
		t.Run(name, func(t *testing.T) {
			log := stubSystemActions(t)
			confirmation := &openConfirmationLog{allow: true}
			stubOpenConfirmation(t, confirmation)
			root := t.TempDir()
			mustWriteFile(t, filepath.Join(root, name), []byte("x"))
			workspace := openTestWorkspace(t, root)

			err := workspace.OpenWithDefaultApp(context.Background(), name, currentGeneration(workspace))
			if !errors.Is(err, errLauncherType) {
				t.Fatalf("OpenWithDefaultApp(%q) = %v, want %v", name, err, errLauncherType)
			}
			if len(log.opened) != 0 {
				t.Errorf("launcher %q reached the desktop: %q", name, log.opened)
			}
			if confirmation.calls != 0 {
				t.Errorf("launcher %q asked for confirmation %d times", name, confirmation.calls)
			}
		})
	}
}

func TestLauncherExtensionsCoverTheRequiredTypes(t *testing.T) {
	root := t.TempDir()
	sample := filepath.Join(root, "sample")
	mustWriteFile(t, sample, []byte("x"))
	info, err := os.Stat(sample)
	if err != nil {
		t.Fatal(err)
	}
	for _, extension := range []string{
		".com", ".exe", ".bat", ".cmd", ".vbs", ".vbe", ".js", ".jse",
		".wsf", ".wsh", ".msc", ".cpl", ".scr", ".msi", ".ps1", ".lnk",
		".url", ".hta", ".scf", ".reg",
		".command", ".tool", ".terminal", ".fileloc", ".inetloc", ".webloc",
		".jar", ".pkg", ".scpt",
		".desktop",
		".application", ".appref-ms", ".settingcontent-ms", ".msp", ".chm", ".jnlp", ".ws",
	} {
		if got := classifyOpenAction("file"+extension, info); got != openRejected {
			t.Errorf("classifyOpenAction(%q) = %v, want openRejected", extension, got)
		}
	}
}

func TestOpenWithDefaultAppRechecksAfterConfirmation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	log := stubSystemActions(t)
	root := t.TempDir()
	outside := t.TempDir()
	path := filepath.Join(root, "archive.xyz")
	outsideFile := filepath.Join(outside, "outside.txt")
	mustWriteFile(t, path, []byte("x"))
	mustWriteFile(t, outsideFile, []byte("outside"))
	workspace := openTestWorkspace(t, root)
	confirmation := &openConfirmationLog{
		allow: true,
		during: func() {
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outsideFile, path); err != nil {
				t.Fatal(err)
			}
		},
	}
	stubOpenConfirmation(t, confirmation)

	err := workspace.OpenWithDefaultApp(context.Background(), "archive.xyz", currentGeneration(workspace))
	if !errors.Is(err, errOpenChanged) {
		t.Fatalf("OpenWithDefaultApp(replaced during confirmation) = %v, want %v", err, errOpenChanged)
	}
	if confirmation.calls != 1 {
		t.Errorf("confirmation calls = %d, want 1", confirmation.calls)
	}
	if len(log.opened) != 0 {
		t.Errorf("replaced target reached the desktop: %q", log.opened)
	}
}

func TestOpenWithDefaultAppConfirmsUnknownTypes(t *testing.T) {
	log := stubSystemActions(t)
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "archive.xyz"), []byte("x"))
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	confirmation := &openConfirmationLog{allow: false}
	stubOpenConfirmation(t, confirmation)
	if err := workspace.OpenWithDefaultApp(context.Background(), "archive.xyz", generation); err != nil {
		t.Fatalf("cancelled confirmation = %v, want nil", err)
	}
	if confirmation.calls != 1 || confirmation.name != "archive.xyz" || confirmation.executable {
		t.Errorf("confirmation = %+v, want one call for archive.xyz without an executable bit", confirmation)
	}
	if len(log.opened) != 0 {
		t.Errorf("cancelled confirmation opened %q", log.opened)
	}

	confirmation = &openConfirmationLog{allow: true}
	stubOpenConfirmation(t, confirmation)
	if err := workspace.OpenWithDefaultApp(context.Background(), "archive.xyz", generation); err != nil {
		t.Fatalf("accepted confirmation = %v, want nil", err)
	}
	resolvedRoot, _ := workspace.state.snapshot()
	if len(log.opened) != 1 || log.opened[0] != filepath.Join(resolvedRoot, "archive.xyz") {
		t.Errorf("accepted confirmation opened %q", log.opened)
	}

	confirmation = &openConfirmationLog{allow: true, err: errors.New("dialog failed")}
	stubOpenConfirmation(t, confirmation)
	if err := workspace.OpenWithDefaultApp(context.Background(), "archive.xyz", generation); err == nil {
		t.Error("dialog failure was ignored")
	}
}

func TestOpenWithDefaultAppConfirmsExecutableBit(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not represent executable permission in the file mode")
	}
	log := stubSystemActions(t)
	root := t.TempDir()
	name := filepath.Join(root, "readme.txt")
	mustWriteFile(t, name, []byte("x"))
	if err := os.Chmod(name, 0o755); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	confirmation := &openConfirmationLog{allow: false}
	stubOpenConfirmation(t, confirmation)

	if err := workspace.OpenWithDefaultApp(context.Background(), "readme.txt", currentGeneration(workspace)); err != nil {
		t.Fatal(err)
	}
	if confirmation.calls != 1 || !confirmation.executable {
		t.Errorf("confirmation = %+v, want the executable bit reported", confirmation)
	}
	if len(log.opened) != 0 {
		t.Errorf("an executable file opened without confirmation: %q", log.opened)
	}
}

func TestRenamedMarkdownCannotBeOpenedAsAScript(t *testing.T) {
	log := stubSystemActions(t)
	confirmation := &openConfirmationLog{allow: true}
	stubOpenConfirmation(t, confirmation)
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	if _, err := workspace.CreateFile(".", "note", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.WriteFile("note.md", "echo hi", generation); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.RenameEntry("note.md", "note.bat", generation); err != nil {
		t.Fatal(err)
	}
	if err := workspace.OpenWithDefaultApp(context.Background(), "note.bat", generation); !errors.Is(err, errLauncherType) {
		t.Fatalf("OpenWithDefaultApp(renamed .bat) = %v, want %v", err, errLauncherType)
	}
	if len(log.opened) != 0 {
		t.Errorf("renamed script reached the desktop: %q", log.opened)
	}
	if confirmation.calls != 0 {
		t.Errorf("renamed script asked for confirmation %d times", confirmation.calls)
	}
	if err := workspace.RevealEntry("note.bat", generation); err != nil {
		t.Fatal(err)
	}
	if len(log.revealed) != 1 {
		t.Errorf("RevealEntry(script) = %q, want it unaffected", log.revealed)
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
