package main

import (
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

// appOpenFile tells the page that the system asked Nicole to open at least one
// file, for example from the file manager. It carries no path: the page calls
// TakePendingOpenedFiles once per signal, so a file is delivered exactly once
// even when the event and the pending queue overlap.
var appOpenFile = mygo.NewEvent[bool]("app:open-file")

// OpenedFiles remembers files passed by the system until the page has taken
// them. A file opened while the app is starting may arrive before the page
// subscribes to the event, so the page also asks for what is pending.
type OpenedFiles struct {
	mu      sync.Mutex
	pending []string
	window  func() *mygo.Window
	emit    func(*mygo.Window, bool) error
}

// NewOpenedFiles returns the service with nothing pending. Notifications go
// to the first app window, not the focused one: an unfocused Nicole must not
// lose a file opened from the file manager.
func NewOpenedFiles() *OpenedFiles {
	return newOpenedFiles(firstAppWindow, func(win *mygo.Window, signal bool) error {
		return appOpenFile.Emit(win, signal)
	})
}

func newOpenedFiles(window func() *mygo.Window, emit func(*mygo.Window, bool) error) *OpenedFiles {
	return &OpenedFiles{window: window, emit: emit}
}

// firstAppWindow returns the main window. The main window is created before
// any optional updater window, so it is the first entry in mygo.Windows().
func firstAppWindow() *mygo.Window {
	windows := mygo.Windows()
	if len(windows) == 0 {
		return nil
	}
	return windows[0]
}

// add records a file the system opened and notifies the main window. It is
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

	if win := s.window(); win != nil {
		_ = s.emit(win, true)
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
