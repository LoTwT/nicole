//go:build unix

package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestOpenSearchFileDoesNotBlockOnFIFO(t *testing.T) {
	dir := t.TempDir()
	fifo := filepath.Join(dir, "pipe")
	if err := syscall.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()

	type result struct {
		regular bool
		err     error
	}
	done := make(chan result, 1)
	go func() {
		file, err := openSearchFile(root, "pipe")
		if err != nil {
			done <- result{err: err}
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			done <- result{err: err}
			return
		}
		done <- result{regular: info.Mode().IsRegular()}
	}()

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("openSearchFile(pipe): %v", got.err)
		}
		if got.regular {
			t.Fatal("openSearchFile reported a FIFO as a regular file")
		}
	case <-time.After(2 * time.Second):
		// A blocking read-only open is waiting for a writer. Unblock it so the
		// failing test does not leave the helper goroutine behind.
		if writer, err := os.OpenFile(fifo, os.O_WRONLY|syscall.O_NONBLOCK, 0); err == nil {
			_ = writer.Close()
		}
		t.Fatal("openSearchFile blocked on a FIFO")
	}
}
