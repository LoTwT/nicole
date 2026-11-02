package main

import (
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestOpenedFilesNotifyTheMainWindowWithoutFocus(t *testing.T) {
	mainWindow := &mygo.Window{}
	first := filepath.Join(t.TempDir(), "first.md")
	var notified *mygo.Window
	var signals int

	service := newOpenedFiles(
		func() *mygo.Window { return mainWindow },
		func(win *mygo.Window, signal bool) error {
			notified = win
			if signal {
				signals++
			}
			return nil
		},
	)
	service.add(first)

	if notified != mainWindow {
		t.Fatalf("notified window = %p, want the main window %p", notified, mainWindow)
	}
	if signals != 1 {
		t.Errorf("signals = %d, want one", signals)
	}
	if got := service.TakePendingOpenedFiles(); len(got) != 1 || got[0] != first {
		t.Errorf("TakePendingOpenedFiles() = %q, want [%q]", got, first)
	}
	if got := service.TakePendingOpenedFiles(); len(got) != 0 {
		t.Errorf("second TakePendingOpenedFiles() = %q, want empty", got)
	}
}

func TestOpenedFilesDeliverAFileOnce(t *testing.T) {
	mainWindow := &mygo.Window{}
	path := filepath.Join(t.TempDir(), "note.md")
	var signals int
	service := newOpenedFiles(
		func() *mygo.Window { return mainWindow },
		func(*mygo.Window, bool) error {
			signals++
			return nil
		},
	)

	service.add(path)
	service.add(path)

	if signals != 1 {
		t.Errorf("signals = %d, want one for a duplicate pending file", signals)
	}
	got := service.TakePendingOpenedFiles()
	if len(got) != 1 || got[0] != path {
		t.Errorf("TakePendingOpenedFiles() = %q, want [%q]", got, path)
	}
	if got := service.TakePendingOpenedFiles(); len(got) != 0 {
		t.Errorf("second TakePendingOpenedFiles() = %q, want empty", got)
	}
}

func TestOpenedFilesStayPendingWithoutAWindow(t *testing.T) {
	path := filepath.Join(t.TempDir(), "note.md")
	service := newOpenedFiles(
		func() *mygo.Window { return nil },
		func(*mygo.Window, bool) error {
			t.Fatal("emitted without a window")
			return nil
		},
	)
	service.add(path)
	if got := service.TakePendingOpenedFiles(); len(got) != 1 || got[0] != path {
		t.Errorf("TakePendingOpenedFiles() = %q, want [%q]", got, path)
	}
}

func TestOpenFileEventName(t *testing.T) {
	if got := appOpenFile.Name(); got != "app:open-file" {
		t.Errorf("event name = %q, want app:open-file", got)
	}
}
