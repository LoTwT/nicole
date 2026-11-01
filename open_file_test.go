package main

import (
	"path/filepath"
	"testing"
)

func TestOpenedFilesKeepPendingFiles(t *testing.T) {
	service := NewOpenedFiles()
	first := filepath.Join(t.TempDir(), "first.md")
	second := filepath.Join(t.TempDir(), "second.md")

	service.add(first)
	service.add(first)
	service.add(second)
	got := service.TakePendingOpenedFiles()
	if len(got) != 2 || got[0] != first || got[1] != second {
		t.Errorf("TakePendingOpenedFiles() = %q, want [%q %q]", got, first, second)
	}
	again := service.TakePendingOpenedFiles()
	if again == nil || len(again) != 0 {
		t.Errorf("second TakePendingOpenedFiles() = %#v, want an empty slice", again)
	}
}

func TestOpenFileEventName(t *testing.T) {
	if got := appOpenFile.Name(); got != "app:open-file" {
		t.Errorf("event name = %q, want app:open-file", got)
	}
}
