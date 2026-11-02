package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	tabsFileName = "tabs.json"

	maxStoredTabs       = 200
	maxSelectionBytes   = 1 << 20
	maxTabSnapshotBytes = 8 << 20
	tabKindMarkdown     = "markdown"
	tabKindPreview      = "preview"
)

var (
	errTabsRootNotCurrent  = errors.New("tabs: the root must be the open workspace")
	errInvalidTabsRootPath = errors.New("tabs: workspace root must be absolute")
)

// StoredTab is the display and restore state of one tab. Path is relative to
// the workspace and is only used to reopen the file or placeholder; it never
// authorizes filesystem access. Selection is an opaque CodeMirror JSON value
// validated for size and JSON syntax, not interpreted. Undo history is kept
// only in memory and deliberately not stored across restarts.
type StoredTab struct {
	Kind            string          `json:"kind"`
	Path            string          `json:"path"`
	Size            int64           `json:"size,omitempty"`
	Selection       json.RawMessage `json:"selection,omitempty"`
	ScrollTopLine   int             `json:"scrollTopLine,omitempty"`
	ScrollTopOffset float64         `json:"scrollTopOffset,omitempty"`
}

// StoredTabs is one workspace root's remembered tab layout.
type StoredTabs struct {
	Tabs   []StoredTab `json:"tabs"`
	Active string      `json:"active,omitempty"`
}

// WorkspaceTabs serves the remembered tabs of the open root. It is bound to
// the page; Get and Save only accept the current workspace root so the service
// cannot read or write layout records for other folders.
type WorkspaceTabs struct {
	store       *tabsStore
	currentRoot func() string
}

// NewWorkspaceTabs returns the service backed by store.
func NewWorkspaceTabs(store *tabsStore) *WorkspaceTabs {
	return &WorkspaceTabs{store: store}
}

func (t *WorkspaceTabs) useCurrentRoot(root func() string) {
	t.currentRoot = root
}

// Get returns the remembered tabs for root, or an empty layout.
func (t *WorkspaceTabs) Get(root string) (StoredTabs, error) {
	root, err := t.validRoot(root)
	if err != nil {
		return StoredTabs{}, err
	}
	return t.store.get(root)
}

// Save replaces the remembered layout for root. An empty layout deletes the
// record so old roots do not accumulate.
func (t *WorkspaceTabs) Save(root string, tabs []StoredTab, active string) error {
	root, err := t.validRoot(root)
	if err != nil {
		return err
	}
	return t.store.save(root, sanitizeStoredTabs(tabs, active))
}

func (t *WorkspaceTabs) validRoot(root string) (string, error) {
	root = filepath.Clean(root)
	if root == "." || !filepath.IsAbs(root) {
		return "", fmt.Errorf("%w: %q", errInvalidTabsRootPath, root)
	}
	if t.currentRoot == nil {
		return "", errTabsRootNotCurrent
	}
	current := filepath.Clean(t.currentRoot())
	if current == "" || root != current {
		return "", fmt.Errorf("%w: %q", errTabsRootNotCurrent, root)
	}
	return root, nil
}

// tabsStore owns tabs.json. Reads never create it; writes replace it
// atomically, like settings.json.
type tabsStore struct {
	mu       sync.Mutex
	filePath string
}

func newTabsStore() (*tabsStore, error) {
	dir, err := userDataDir()
	if err != nil {
		return nil, err
	}
	return newTabsStoreIn(filepath.Join(dir, tabsFileName)), nil
}

func startupTabsStore() (*tabsStore, error) {
	if generatingClient() {
		return newTabsStoreIn(filepath.Join(os.TempDir(), "nicole-generate", tabsFileName)), nil
	}
	return newTabsStore()
}

func newTabsStoreIn(filePath string) *tabsStore {
	return &tabsStore{filePath: filePath}
}

type tabsFile struct {
	Roots map[string]StoredTabs `json:"roots"`
}

func (s *tabsStore) get(root string) (StoredTabs, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return StoredTabs{}, err
	}
	state, ok := file.Roots[root]
	if !ok || state.Tabs == nil {
		return StoredTabs{Tabs: []StoredTab{}}, nil
	}
	return state, nil
}

func (s *tabsStore) save(root string, state StoredTabs) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file, err := s.readLocked()
	if err != nil {
		return err
	}
	if len(state.Tabs) == 0 {
		delete(file.Roots, root)
	} else {
		file.Roots[root] = state
	}
	return s.writeLocked(file)
}

func (s *tabsStore) readLocked() (tabsFile, error) {
	data, err := os.ReadFile(s.filePath)
	if errors.Is(err, fs.ErrNotExist) {
		return tabsFile{Roots: map[string]StoredTabs{}}, nil
	}
	if err != nil {
		return tabsFile{Roots: map[string]StoredTabs{}}, err
	}
	var file tabsFile
	if err := json.Unmarshal(data, &file); err != nil {
		if backupErr := s.backupCorruptLocked(); backupErr != nil {
			return tabsFile{Roots: map[string]StoredTabs{}}, fmt.Errorf("tabs: cannot read %s: %w (backup failed: %v)", s.filePath, err, backupErr)
		}
		return tabsFile{Roots: map[string]StoredTabs{}}, nil
	}
	if file.Roots == nil {
		file.Roots = map[string]StoredTabs{}
	}
	return file, nil
}

func (s *tabsStore) backupCorruptLocked() error {
	backup := s.filePath + ".corrupt-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	if err := os.Rename(s.filePath, backup); err != nil {
		return fmt.Errorf("rename to %s: %w", backup, err)
	}
	return nil
}

func (s *tabsStore) writeLocked(file tabsFile) error {
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o755); err != nil {
		return err
	}
	return writeFileAtomicAbs(s.filePath, append(data, '\n'))
}

// sanitizeStoredTabs keeps the layout usable while refusing paths that could
// look like an authorization claim. Invalid entries are dropped rather than
// failing the whole save, so one malformed selection cannot lose every tab.
func sanitizeStoredTabs(tabs []StoredTab, active string) StoredTabs {
	kept := make([]StoredTab, 0, min(len(tabs), maxStoredTabs))
	seen := make(map[string]bool, len(tabs))
	snapshotBudget := maxTabSnapshotBytes

	for _, tab := range tabs {
		if len(kept) == maxStoredTabs {
			break
		}
		if tab.Kind != tabKindMarkdown && tab.Kind != tabKindPreview {
			continue
		}
		if !validStoredTabPath(tab.Path) {
			continue
		}
		key := tab.Kind + "\x00" + tab.Path
		if seen[key] {
			continue
		}
		seen[key] = true

		clean := StoredTab{
			Kind:          tab.Kind,
			Path:          path.Clean(tab.Path),
			ScrollTopLine: max(0, tab.ScrollTopLine),
		}
		if tab.Kind == tabKindPreview {
			clean.Size = max(0, tab.Size)
		}
		if tab.ScrollTopOffset != 0 {
			clean.ScrollTopOffset = tab.ScrollTopOffset
		}
		if tab.Kind == tabKindMarkdown {
			clean.Selection, snapshotBudget = keepSnapshot(tab.Selection, maxSelectionBytes, snapshotBudget)
		}
		kept = append(kept, clean)
	}

	nextActive := ""
	for _, tab := range kept {
		if tab.Path == active {
			nextActive = tab.Path
			break
		}
	}
	return StoredTabs{Tabs: kept, Active: nextActive}
}

func validStoredTabPath(value string) bool {
	if value == "" || value == "." || len(value) > 4096 {
		return false
	}
	if strings.ContainsAny(value, "\\:") || strings.HasPrefix(value, "/") {
		return false
	}
	if !fs.ValidPath(value) || !filepath.IsLocal(filepath.FromSlash(value)) {
		return false
	}
	return path.Clean(value) == value
}

func keepSnapshot(raw json.RawMessage, limit, budget int) (json.RawMessage, int) {
	if len(raw) == 0 || len(raw) > limit || len(raw) > budget || !json.Valid(raw) {
		return nil, budget
	}
	copied := make(json.RawMessage, len(raw))
	copy(copied, raw)
	return copied, budget - len(raw)
}
