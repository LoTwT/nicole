package main

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// selfWriteWindow is how long a completed write may still explain a watch
// event. The watch reports changes after a short debounce; a few seconds leave
// room for busy machines without hiding a real external edit for long.
const selfWriteWindow = 5 * time.Second

// WorkspaceFileEvent is a change in the workspace that the page did not make
// itself. It names paths relative to the workspace, separated by slashes.
type WorkspaceFileEvent struct {
	// Op is "create", "write", "remove", "rename" or "hint".
	Op string `json:"op"`
	// Path is what changed, "." for the watched root itself.
	Path string `json:"path"`
	// OldPath is where a rename moved from.
	OldPath string `json:"oldPath,omitempty"`
	IsDir   bool   `json:"isDir"`
}

// FileWatchPart is what Workspace.Watch streams: "ready" once, then batches of
// events. The page may ask for a new watch after opening another folder.
type FileWatchPart struct {
	Type   string               `json:"type"`
	Events []WorkspaceFileEvent `json:"events,omitempty"`
}

// Watch streams changes in the open workspace to parts until the page closes
// the channel, cancels its call, opens another folder, or the watch stops.
// Every file in the watched range is reported, Markdown or not, because the
// file tree shows both. Hidden folders and node_modules are not watched; the
// file tree reads them again when they are expanded.
//
// Changes caused by this app's own writes are left out. Unlike MyGo's watch
// plugin, which hands the web view's events straight through, this wrapper
// compares a write's content with the file the watch reports, so an external
// edit of the same path still reaches the page.
func (w *Workspace) Watch(ctx context.Context, generation int, parts *mygo.Channel[FileWatchPart]) error {
	root, err := w.currentRoot(generation)
	if err != nil {
		return err
	}
	if parts == nil {
		return errors.New("workspace: watch needs a channel")
	}
	watcher, err := mygo.WatchFiles(ctx, root, mygo.FileWatchOptions{
		Recursive: true,
		Ignore:    ignoreWatchEntry,
	})
	if err != nil {
		return err
	}
	defer watcher.Close()

	if err := parts.Send(FileWatchPart{Type: "ready"}); err != nil {
		return nil
	}
	for {
		events, err := watcher.Next(ctx)
		if err != nil {
			if errors.Is(err, io.EOF) || ctx.Err() != nil {
				return nil
			}
			return err
		}
		currentRoot, currentGeneration := w.state.snapshot()
		if currentRoot != root || currentGeneration != generation {
			return nil
		}
		changed := make([]WorkspaceFileEvent, 0, len(events))
		for _, event := range events {
			if event.Path != "." && ignoreWatchEntry(event.Path, event.IsDir) {
				continue
			}
			if w.writes.suppress(root, event) {
				continue
			}
			changed = append(changed, WorkspaceFileEvent{
				Op:      string(event.Op),
				Path:    event.Path,
				OldPath: event.OldPath,
				IsDir:   event.IsDir,
			})
		}
		if len(changed) == 0 {
			continue
		}
		if err := parts.Send(FileWatchPart{Type: "events", Events: changed}); err != nil {
			return nil
		}
	}
}

// ignoreWatchEntry leaves out the folders whose contents the file tree reads
// only when they are expanded, and the files the tree never shows. Other
// hidden entries are still watched: a file such as .draft.md is visible.
func ignoreWatchEntry(rel string, isDir bool) bool {
	base := path.Base(rel)
	if isDir {
		return ignoredFolder(base)
	}
	return isWorkspaceTempName(base) || excludedTreeEntry(base)
}

type selfWriteRecord struct {
	digest [sha256.Size]byte
	at     time.Time
}

// selfWrites remembers this app's latest write to each path. A watch event is
// this app's own write when the path was written within selfWriteWindow and
// the file still has exactly the bytes that were written. A different digest
// means another program changed the file, so that event is delivered.
type selfWrites struct {
	mu      sync.Mutex
	records map[string]selfWriteRecord
	now     func() time.Time
}

func newSelfWrites() *selfWrites {
	return &selfWrites{records: map[string]selfWriteRecord{}, now: time.Now}
}

func (s *selfWrites) record(rel string, data []byte) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.records == nil {
		s.records = map[string]selfWriteRecord{}
	}
	now := s.now()
	for name, record := range s.records {
		if now.Sub(record.at) > selfWriteWindow {
			delete(s.records, name)
		}
	}
	s.records[rel] = selfWriteRecord{digest: sha256.Sum256(data), at: now}
}

func (s *selfWrites) forget(rel string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	delete(s.records, rel)
	s.mu.Unlock()
}

// suppress reports whether event describes the write recorded for path.
func (s *selfWrites) suppress(root string, event mygo.FileEvent) bool {
	if s == nil || event.IsDir {
		return false
	}
	if event.Op != mygo.FileWrite && event.Op != mygo.FileCreate {
		return false
	}
	s.mu.Lock()
	record, ok := s.records[event.Path]
	now := s.now()
	s.mu.Unlock()
	if !ok || now.Sub(record.at) > selfWriteWindow {
		return false
	}
	data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(event.Path)))
	if err != nil {
		return false
	}
	return sha256.Sum256(data) == record.digest
}
