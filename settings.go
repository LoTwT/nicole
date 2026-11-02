package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

const (
	settingsFileName = "settings.json"

	defaultSidebarWidth = 252
	minSidebarWidth     = 200
	maxSidebarWidth     = 400
	maxRecentFolders    = 10

	themeSystem = "system"
	themeLight  = "light"
	themeDark   = "dark"
)

var errInvalidTheme = errors.New("settings: theme must be system, light or dark")

// AppSettings is the user's global settings. It is stored in
// PathUserData/settings.json and is independent of any workspace.
type AppSettings struct {
	// Theme is "system", "light" or "dark". System follows the desktop.
	Theme string `json:"theme"`
	// SidebarWidth is the sidebar width in CSS pixels, within
	// [200, 400].
	SidebarWidth int `json:"sidebarWidth"`
	// RecentFolders lists the folders opened most recently, newest first.
	RecentFolders []string `json:"recentFolders"`
	// ExpandedFolders keeps the expanded folders of a workspace root, by
	// the root's absolute path and with slash-separated relative paths.
	ExpandedFolders map[string][]string `json:"expandedFolders"`
}

// Settings serves the global settings to the page. `mygo generate` turns its
// methods into functions in src/services/mygo.ts.
type Settings struct {
	store *settingsStore
}

// NewSettings returns the settings service backed by store.
func NewSettings(store *settingsStore) *Settings {
	return &Settings{store: store}
}

// Get returns the saved settings, or the defaults when nothing was saved.
func (s *Settings) Get() (AppSettings, error) {
	return s.store.get()
}

// MigrateLegacyTheme moves a theme saved in the page's localStorage before
// the settings file existed into the settings. It does nothing when the
// settings already contain a theme; an invalid legacy value is ignored.
// Callers remove the legacy value after this returns without an error.
func (s *Settings) MigrateLegacyTheme(legacy string) (AppSettings, error) {
	return s.store.migrateLegacyTheme(legacy)
}

// SetTheme saves the theme and makes the native appearance follow it.
func (s *Settings) SetTheme(theme string) error {
	return s.store.setTheme(theme)
}

// SetSidebarWidth saves the sidebar width, clamped to the range the interface
// supports.
func (s *Settings) SetSidebarWidth(width int) error {
	return s.store.update(func(settings *AppSettings) {
		settings.SidebarWidth = width
	})
}

// SetExpandedFolders saves the expanded folders of root. The frontend owns
// which paths are expanded; the backend only stores them.
func (s *Settings) SetExpandedFolders(root string, folders []string) error {
	root = filepath.Clean(root)
	if root == "." || !filepath.IsAbs(root) {
		return fmt.Errorf("settings: workspace root must be absolute: %q", root)
	}
	return s.store.update(func(settings *AppSettings) {
		if folders = sanitizeRelativeFolders(folders); len(folders) == 0 {
			delete(settings.ExpandedFolders, root)
			return
		}
		settings.ExpandedFolders[root] = folders
	})
}

// AddRecentFolder puts folder first in the recent folders, dropping the
// oldest entries past the list's limit.
func (s *Settings) AddRecentFolder(folder string) error {
	folder = filepath.Clean(folder)
	if !filepath.IsAbs(folder) {
		return fmt.Errorf("settings: recent folder must be absolute: %q", folder)
	}
	return s.store.update(func(settings *AppSettings) {
		settings.RecentFolders = prependRecentFolder(settings.RecentFolders, folder)
	})
}

// RemoveRecentFolder drops folder from the recent folders.
func (s *Settings) RemoveRecentFolder(folder string) error {
	folder = filepath.Clean(folder)
	return s.store.update(func(settings *AppSettings) {
		kept := settings.RecentFolders[:0]
		for _, item := range settings.RecentFolders {
			if item != folder {
				kept = append(kept, item)
			}
		}
		settings.RecentFolders = append([]string(nil), kept...)
	})
}

// settingsStore owns settings.json. It serializes changes and replaces the
// file atomically, so a crash leaves the previous settings intact.
type settingsStore struct {
	mu       sync.Mutex
	filePath string
}

// newSettingsStore returns the store in the app's user data directory.
func newSettingsStore() (*settingsStore, error) {
	dir, err := userDataDir()
	if err != nil {
		return nil, err
	}
	return newSettingsStoreIn(filepath.Join(dir, settingsFileName)), nil
}

// startupSettingsStore returns the store main uses. In MyGo's client-generation
// run it is a path that is never read or created: the generator only needs the
// service's method signatures.
func startupSettingsStore() (*settingsStore, error) {
	if generatingClient() {
		return newSettingsStoreIn(filepath.Join(os.TempDir(), "nicole-generate", settingsFileName)), nil
	}
	return newSettingsStore()
}

// newSettingsStoreIn returns the store at filePath; tests use a temporary
// file.
func newSettingsStoreIn(filePath string) *settingsStore {
	return &settingsStore{filePath: filePath}
}

// settingsFile mirrors AppSettings but distinguishes a missing theme from an
// explicit one, which legacy migration needs.
type settingsFile struct {
	Theme           *string             `json:"theme"`
	SidebarWidth    int                 `json:"sidebarWidth"`
	RecentFolders   []string            `json:"recentFolders"`
	ExpandedFolders map[string][]string `json:"expandedFolders"`
}

func defaultSettings() AppSettings {
	return AppSettings{
		Theme:           themeSystem,
		SidebarWidth:    defaultSidebarWidth,
		RecentFolders:   []string{},
		ExpandedFolders: map[string][]string{},
	}
}

func (s *settingsStore) get() (AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings, _, err := s.readLocked()
	return settings, err
}

func (s *settingsStore) setTheme(theme string) error {
	theme = strings.TrimSpace(strings.ToLower(theme))
	if !validTheme(theme) {
		return errInvalidTheme
	}
	s.mu.Lock()
	settings, _, err := s.readLocked()
	if err == nil {
		settings.Theme = theme
		settings = normalizeSettings(settings)
		err = s.writeLocked(settings)
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	applyThemeSource(theme)
	return nil
}

func (s *settingsStore) migrateLegacyTheme(legacy string) (AppSettings, error) {
	legacy = strings.TrimSpace(strings.ToLower(legacy))
	s.mu.Lock()
	defer s.mu.Unlock()

	settings, themePresent, err := s.readLocked()
	if err != nil {
		return settings, err
	}
	if themePresent || !validTheme(legacy) {
		return settings, nil
	}
	settings.Theme = legacy
	settings = normalizeSettings(settings)
	if err := s.writeLocked(settings); err != nil {
		return settings, err
	}
	applyThemeSource(settings.Theme)
	return settings, nil
}

// update reads, changes and writes the settings in one critical section.
func (s *settingsStore) update(change func(*AppSettings)) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	settings, _, err := s.readLocked()
	if err != nil {
		return err
	}
	change(&settings)
	settings = normalizeSettings(settings)
	return s.writeLocked(settings)
}

// readLocked reads the settings and reports whether a theme was stored.
func (s *settingsStore) readLocked() (AppSettings, bool, error) {
	data, err := os.ReadFile(s.filePath)
	if errors.Is(err, fs.ErrNotExist) {
		return defaultSettings(), false, nil
	}
	if err != nil {
		return defaultSettings(), false, err
	}
	var file settingsFile
	if err := json.Unmarshal(data, &file); err != nil {
		if backupErr := s.backupCorruptLocked(); backupErr != nil {
			return defaultSettings(), false, fmt.Errorf("settings: cannot read %s: %w (backup failed: %v)", s.filePath, err, backupErr)
		}
		return defaultSettings(), false, nil
	}
	themePresent := file.Theme != nil
	settings := AppSettings{
		Theme:           themeSystem,
		SidebarWidth:    file.SidebarWidth,
		RecentFolders:   file.RecentFolders,
		ExpandedFolders: file.ExpandedFolders,
	}
	if file.Theme != nil {
		settings.Theme = *file.Theme
	}
	return normalizeSettings(settings), themePresent, nil
}

// backupCorruptLocked moves a damaged settings file aside so the next write
// can start from defaults without destroying the evidence. The caller holds
// the store lock. A failed backup is returned instead of overwriting the file.
func (s *settingsStore) backupCorruptLocked() error {
	backup := s.filePath + ".corrupt-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	if err := os.Rename(s.filePath, backup); err != nil {
		return fmt.Errorf("rename to %s: %w", backup, err)
	}
	return nil
}

func (s *settingsStore) writeLocked(settings AppSettings) error {
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o755); err != nil {
		return err
	}
	return writeFileAtomicAbs(s.filePath, append(data, '\n'))
}

// normalizeSettings returns a copy with every field in the shape the interface
// expects: a known theme, a width in range, non-nil collections and no
// duplicate recent folders.
func normalizeSettings(settings AppSettings) AppSettings {
	settings.Theme = strings.TrimSpace(strings.ToLower(settings.Theme))
	if !validTheme(settings.Theme) {
		settings.Theme = themeSystem
	}
	if settings.SidebarWidth <= 0 {
		settings.SidebarWidth = defaultSidebarWidth
	}
	settings.SidebarWidth = min(max(settings.SidebarWidth, minSidebarWidth), maxSidebarWidth)

	recent := make([]string, 0, len(settings.RecentFolders))
	for _, folder := range settings.RecentFolders {
		folder = filepath.Clean(strings.TrimSpace(folder))
		if folder == "." || !filepath.IsAbs(folder) || containsString(recent, folder) {
			continue
		}
		recent = append(recent, folder)
		if len(recent) == maxRecentFolders {
			break
		}
	}
	settings.RecentFolders = recent

	expanded := make(map[string][]string, len(settings.ExpandedFolders))
	for root, folders := range settings.ExpandedFolders {
		root = filepath.Clean(root)
		if root == "." || !filepath.IsAbs(root) {
			continue
		}
		if folders = sanitizeRelativeFolders(folders); len(folders) > 0 {
			expanded[root] = folders
		}
	}
	settings.ExpandedFolders = expanded
	return settings
}

func validTheme(theme string) bool {
	return theme == themeSystem || theme == themeLight || theme == themeDark
}

func themeSource(theme string) mygo.ThemeSource {
	switch theme {
	case themeLight:
		return mygo.ThemeLight
	case themeDark:
		return mygo.ThemeDark
	default:
		return mygo.ThemeSystem
	}
}

// applyThemeSource is a variable so tests can observe the theme without a
// running app.
var applyThemeSource = func(theme string) {
	mygo.Theme.SetSource(themeSource(theme))
}

// applySavedTheme makes the native appearance follow the saved theme before
// the window appears. A missing or unreadable settings file keeps the system
// appearance.
func applySavedTheme(store *settingsStore) {
	settings, err := store.get()
	if err != nil {
		return
	}
	applyThemeSource(settings.Theme)
}

func prependRecentFolder(folders []string, folder string) []string {
	next := []string{folder}
	for _, item := range folders {
		if item != folder {
			next = append(next, item)
		}
		if len(next) == maxRecentFolders {
			break
		}
	}
	return next
}

func containsString(items []string, item string) bool {
	for _, candidate := range items {
		if candidate == item {
			return true
		}
	}
	return false
}

// sanitizeRelativeFolders keeps slash-separated relative directory paths,
// sorted and without duplicates. They are display state only: nothing here is
// opened or trusted as a filesystem path.
func sanitizeRelativeFolders(folders []string) []string {
	seen := make(map[string]bool, len(folders))
	kept := make([]string, 0, len(folders))
	for _, folder := range folders {
		folder = strings.TrimSpace(folder)
		if folder == "" || folder == "." || strings.Contains(folder, `\`) || strings.Contains(folder, ":") {
			continue
		}
		if !fs.ValidPath(folder) || !filepath.IsLocal(filepath.FromSlash(folder)) {
			continue
		}
		folder = path.Clean(folder)
		if seen[folder] {
			continue
		}
		seen[folder] = true
		kept = append(kept, folder)
	}
	sort.Strings(kept)
	return kept
}
