package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func mustWriteFile(t *testing.T, name string, content []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(name, content, 0o644); err != nil {
		t.Fatal(err)
	}
}

func openTestWorkspace(t *testing.T, root string) *Workspace {
	t.Helper()
	workspace := NewWorkspace()
	if _, err := workspace.open(root); err != nil {
		t.Fatalf("open(%q): %v", root, err)
	}
	return workspace
}

func TestListFiles(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{
		"README.md",
		"notes/daily.MD",
		"notes/deep/ideas.md",
		".draft.md",
		".obsidian/hidden.md",
		"node_modules/package/readme.md",
		"notes/plain.txt",
		"notes/archive.markdown",
	} {
		mustWriteFile(t, filepath.Join(root, filepath.FromSlash(name)), []byte("# "+name))
	}

	files, err := openTestWorkspace(t, root).ListFiles()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{".draft.md", "README.md", "notes/daily.MD", "notes/deep/ideas.md"}
	if !reflect.DeepEqual(files, want) {
		t.Errorf("ListFiles() = %q, want %q", files, want)
	}
}

func TestListFilesSkipsSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "outside.md"), []byte("outside"))
	mustWriteFile(t, filepath.Join(root, "real.md"), []byte("real"))

	if err := os.Symlink(filepath.Join(outside, "outside.md"), filepath.Join(root, "linked.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "linked-dir")); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}

	files, err := openTestWorkspace(t, root).ListFiles()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"real.md"}; !reflect.DeepEqual(files, want) {
		t.Errorf("ListFiles() = %q, want %q", files, want)
	}
}

func TestReadWritePreservesBytes(t *testing.T) {
	contents := []string{
		"plain",
		"no trailing newline",
		"crlf\r\nsecond line\r\n",
		"\ufeff# bom heading\n",
		"",
		"中文\r\n结束",
	}

	root := t.TempDir()
	workspace := openTestWorkspace(t, root)

	for _, content := range contents {
		t.Run(contentName(content), func(t *testing.T) {
			name := filepath.Join(root, "doc.md")
			if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
				t.Fatal(err)
			}

			got, err := workspace.ReadFile("doc.md")
			if err != nil {
				t.Fatal(err)
			}
			if got != content {
				t.Errorf("ReadFile() = %q, want %q", got, content)
			}

			if err := workspace.WriteFile("doc.md", content); err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(name)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != content {
				t.Errorf("file on disk = %q, want %q", data, content)
			}
		})
	}
}

func contentName(content string) string {
	if content == "" {
		return "empty"
	}
	name := ""
	for _, r := range content {
		if r == '\r' {
			name += "CR"
		} else if r == '\n' {
			name += "LF"
		}
	}
	if name == "" {
		name = "text"
	}
	return name
}

func TestWriteFailureLeavesOriginal(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "doc.md")
	mustWriteFile(t, target, []byte("original"))

	renameFailed := errors.New("rename failed")
	err := writeFileAtomicWith(target, []byte("replacement"), func(string, string) error {
		return renameFailed
	})
	if !errors.Is(err, renameFailed) {
		t.Fatalf("writeFileAtomicWith() = %v, want %v", err, renameFailed)
	}

	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "original" {
		t.Errorf("original file = %q, want %q", data, "original")
	}

	temps, err := filepath.Glob(filepath.Join(root, ".nicole-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(temps) != 0 {
		t.Errorf("temporary files left behind: %q", temps)
	}
}

func TestReadFileRejectsPathsOutsideWorkspace(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "ok.md"), []byte("ok"))
	outsideFile := filepath.Join(outside, "secret.md")
	mustWriteFile(t, outsideFile, []byte("secret"))

	workspace := openTestWorkspace(t, root)
	for _, rel := range []string{
		"../secret.md",
		`..\secret.md`,
		"/etc/passwd",
		"C:/Windows/win.ini",
		`C:\Windows\win.ini`,
		"notes/../../secret.md",
		"",
		".",
		"notes/",
		`notes\file.md`,
		outsideFile,
		filepath.ToSlash(outsideFile),
	} {
		if _, err := workspace.ReadFile(rel); err == nil {
			t.Errorf("ReadFile(%q) succeeded, want an error", rel)
		}
		if err := workspace.WriteFile(rel, "changed"); err == nil {
			t.Errorf("WriteFile(%q) succeeded, want an error", rel)
		}
	}

	data, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "secret" {
		t.Errorf("outside file = %q, want %q", data, "secret")
	}
}

func TestSymlinkEscapesAreRejected(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "secret.md")
	mustWriteFile(t, outsideFile, []byte("secret"))

	if err := os.Symlink(outsideFile, filepath.Join(root, "escape.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape-dir")); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}

	workspace := openTestWorkspace(t, root)
	for _, rel := range []string{"escape.md", "escape-dir/secret.md"} {
		if _, err := workspace.ReadFile(rel); !errors.Is(err, errPathOutside) {
			t.Errorf("ReadFile(%q) = %v, want %v", rel, err, errPathOutside)
		}
	}
	for _, rel := range []string{"escape.md", "escape-dir/new.md"} {
		if err := workspace.WriteFile(rel, "changed"); !errors.Is(err, errPathOutside) {
			t.Errorf("WriteFile(%q) = %v, want %v", rel, err, errPathOutside)
		}
	}

	data, err := os.ReadFile(outsideFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "secret" {
		t.Errorf("outside file = %q, want %q", data, "secret")
	}
	if _, err := os.Stat(filepath.Join(outside, "new.md")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("outside file was created: %v", err)
	}
}

func TestSymlinkInsideWorkspaceIsFollowed(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "real.md"), []byte("real"))
	alias := filepath.Join(root, "alias.md")
	if err := os.Symlink(filepath.Join(root, "real.md"), alias); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	workspace := openTestWorkspace(t, root)
	if got, err := workspace.ReadFile("alias.md"); err != nil || got != "real" {
		t.Fatalf("ReadFile(alias.md) = %q, %v; want %q, nil", got, err, "real")
	}
	if err := workspace.WriteFile("alias.md", "updated"); err != nil {
		t.Fatal(err)
	}
	if got, err := workspace.ReadFile("real.md"); err != nil || got != "updated" {
		t.Errorf("ReadFile(real.md) = %q, %v; want %q, nil", got, err, "updated")
	}
	info, err := os.Lstat(alias)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Error("saving through a symlink replaced the link itself")
	}
}

func TestWithinRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Notes")
	if !withinRoot(root, root) {
		t.Error("withinRoot(root, root) = false, want true")
	}
	if !withinRoot(root, filepath.Join(root, "notes", "a.md")) {
		t.Error("withinRoot() rejected a child")
	}
	if withinRoot(root, filepath.Join(filepath.Dir(root), "notes-backup", "a.md")) {
		t.Error("withinRoot() accepted a sibling whose name starts like the root")
	}
	if withinRoot(root, filepath.Dir(root)) {
		t.Error("withinRoot() accepted the parent")
	}
}

func TestOpenRejectsInvalidFolder(t *testing.T) {
	workspace := NewWorkspace()
	if _, err := workspace.open("relative/path"); err == nil {
		t.Error("open() accepted a relative path")
	}

	file := filepath.Join(t.TempDir(), "file.md")
	mustWriteFile(t, file, []byte("x"))
	if _, err := workspace.open(file); err == nil {
		t.Error("open() accepted a file")
	}
	if _, err := workspace.ListFiles(); !errors.Is(err, errNoWorkspace) {
		t.Errorf("ListFiles() without a folder = %v, want %v", err, errNoWorkspace)
	}
}

func TestFailedOpenKeepsCurrentWorkspace(t *testing.T) {
	first := t.TempDir()
	mustWriteFile(t, filepath.Join(first, "first.md"), []byte("first"))
	workspace := openTestWorkspace(t, first)

	if _, err := workspace.open(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("open() accepted a missing folder")
	}
	files, err := workspace.ListFiles()
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"first.md"}; !reflect.DeepEqual(files, want) {
		t.Errorf("ListFiles() = %q, want %q", files, want)
	}
}

func TestWatchRootFollowsWorkspace(t *testing.T) {
	ctx := context.Background()
	workspace := NewWorkspace()

	if _, ok := workspace.watchRoot(ctx, workspaceWatchRoot); ok {
		t.Error("watchRoot() granted a root before a folder was open")
	}
	if _, ok := workspace.watchRoot(ctx, "other"); ok {
		t.Error("watchRoot() granted an unknown name")
	}

	first := t.TempDir()
	mustWriteFile(t, filepath.Join(first, "first.md"), []byte("first"))
	if _, err := workspace.open(first); err != nil {
		t.Fatal(err)
	}
	root, ok := workspace.watchRoot(ctx, workspaceWatchRoot)
	if !ok {
		t.Fatal("watchRoot() refused the workspace")
	}
	resolvedFirst, err := filepath.EvalSymlinks(first)
	if err != nil {
		t.Fatal(err)
	}
	if root.Path != filepath.Clean(resolvedFirst) {
		t.Errorf("watchRoot().Path = %q, want %q", root.Path, resolvedFirst)
	}
	if !root.Recursive {
		t.Error("watchRoot().Recursive = false, want true")
	}
	if root.Ignore == nil {
		t.Fatal("watchRoot().Ignore is nil")
	}
	for _, name := range []string{"node_modules", ".git", "docs/node_modules"} {
		if !root.Ignore(name, true) {
			t.Errorf("Ignore(%q, dir) = false, want true", name)
		}
	}
	if root.Ignore("notes.md", false) || root.Ignore("node_modules", false) {
		t.Error("Ignore() ignored a file")
	}

	second := t.TempDir()
	if _, err := workspace.open(second); err != nil {
		t.Fatal(err)
	}
	root, ok = workspace.watchRoot(ctx, workspaceWatchRoot)
	if !ok {
		t.Fatal("watchRoot() refused the new workspace")
	}
	resolvedSecond, err := filepath.EvalSymlinks(second)
	if err != nil {
		t.Fatal(err)
	}
	if root.Path != filepath.Clean(resolvedSecond) {
		t.Errorf("watchRoot().Path after switching = %q, want %q", root.Path, resolvedSecond)
	}
}
