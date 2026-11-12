//go:build unix

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestListSnippetsSkipsFIFOWithoutBlocking(t *testing.T) {
	root := t.TempDir()
	fifo := filepath.Join(root, ".nicole", "snippets", "pipe.md")
	if err := os.MkdirAll(filepath.Dir(fifo), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(root, ".nicole", "snippets", "normal.md"), []byte("ok"))

	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	type outcome struct {
		result WorkspaceSnippets
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := workspace.ListSnippets(generation)
		done <- outcome{result: result, err: err}
	}()

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("ListSnippets: %v", got.err)
		}
		if len(got.result.Snippets) != 1 || got.result.Snippets[0].Label != "normal" {
			t.Fatalf("snippets = %#v", got.result.Snippets)
		}
		if len(got.result.Warnings) != 1 || !strings.Contains(got.result.Warnings[0], "pipe.md") {
			t.Fatalf("warnings = %#v", got.result.Warnings)
		}
	case <-time.After(2 * time.Second):
		// Open a writer only after the failure so a blocking read can finish
		// and the helper goroutine does not outlive the test.
		if writer, err := os.OpenFile(fifo, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
			_ = writer.Close()
		}
		t.Fatal("ListSnippets blocked on a FIFO")
	}
}
