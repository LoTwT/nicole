//go:build !windows && !plan9 && !js && !wasip1

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestWriteFileNewFileHonorsUmask(t *testing.T) {
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)

	previous := syscall.Umask(0o077)
	defer syscall.Umask(previous)

	if err := workspace.WriteFile("new.md", "new", currentGeneration(workspace)); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(root, "new.md"))
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("new file mode = %o, want 600 with umask 077", got)
	}
}
