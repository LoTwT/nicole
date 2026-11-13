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

// PendingOpenedFile is one system-provided path and the specific offer that
// delivered it. A later offer for the same path gets a new OfferID, so the
// page can dismiss the occurrence it handled without consuming the new one.
type PendingOpenedFile struct {
	Path    string `json:"path"`
	OfferID string `json:"offerId"`
}

// OpenedFiles remembers files passed by the system until the page has taken
// them. A file opened while the app is starting may arrive before the page
// subscribes to the event, so the page also asks for what is pending.
type OpenedFiles struct {
	mu      sync.Mutex
	pending []PendingOpenedFile
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

// add records a file without an offer identity. It remains for callers that
// only need the legacy path queue; the system file-association path uses
// addWithOffer so cleanup can identify the exact occurrence.
func (s *OpenedFiles) add(path string) {
	s.addWithOffer(path, "")
}

// addWithOffer records a file the system opened and notifies the main window.
// A repeated path updates the pending entry to the newest offer instead of
// queueing the same path twice.
func (s *OpenedFiles) addWithOffer(path, offerID string) {
	if absolute, err := filepath.Abs(path); err == nil {
		path = absolute
	}
	path = filepath.Clean(path)

	s.mu.Lock()
	for index, pending := range s.pending {
		if pending.Path == path {
			s.pending[index].OfferID = offerID
			s.mu.Unlock()
			return
		}
	}
	s.pending = append(s.pending, PendingOpenedFile{Path: path, OfferID: offerID})
	s.mu.Unlock()

	if win := s.window(); win != nil {
		_ = s.emit(win, true)
	}
}

// TakePendingOpenedFiles returns the files that arrived since the last call
// and forgets them. The returned paths are absolute.
func (s *OpenedFiles) TakePendingOpenedFiles() []string {
	entries := s.TakePendingOpenedFilesWithOffers()
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		paths = append(paths, entry.Path)
	}
	return paths
}

// TakePendingOpenedFilesWithOffers returns each path with the offer that
// delivered it and clears the queue.
func (s *OpenedFiles) TakePendingOpenedFilesWithOffers() []PendingOpenedFile {
	s.mu.Lock()
	defer s.mu.Unlock()
	pending := s.pending
	s.pending = nil
	if pending == nil {
		return []PendingOpenedFile{}
	}
	return append([]PendingOpenedFile(nil), pending...)
}
