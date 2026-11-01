package main

import (
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

// appOpenFile tells the page that the system asked Nicole to open a file, for
// example from the file manager. The page decides whether the file belongs to
// the open folder or may be opened as a single-file tab.
var appOpenFile = mygo.NewEvent[string]("app:open-file")

// OpenedFiles remembers files passed by the system until the page has taken
// them. A file opened while the app is starting may arrive before the page
// subscribes to the event, so the page also asks for what is pending.
type OpenedFiles struct {
	mu      sync.Mutex
	pending []string
}

// NewOpenedFiles returns the service with nothing pending.
func NewOpenedFiles() *OpenedFiles {
	return &OpenedFiles{}
}

// add records a file the system opened and notifies the focused window. It is
// called by the app, not by the page.
func (s *OpenedFiles) add(path string) {
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	path = filepath.Clean(path)

	s.mu.Lock()
	for _, pending := range s.pending {
		if pending == path {
			s.mu.Unlock()
			return
		}
	}
	s.pending = append(s.pending, path)
	s.mu.Unlock()

	if win := mygo.FocusedWindow(); win != nil {
		_ = appOpenFile.Emit(win, path)
	}
}

// TakePendingOpenedFiles returns the files that arrived since the last call
// and forgets them. The returned paths are absolute.
func (s *OpenedFiles) TakePendingOpenedFiles() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	pending := s.pending
	s.pending = nil
	if pending == nil {
		return []string{}
	}
	return append([]string(nil), pending...)
}
