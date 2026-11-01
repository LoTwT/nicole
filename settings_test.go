package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func newTestSettings(t *testing.T) (*settingsStore, string) {
	t.Helper()
	dir := t.TempDir()
	return newSettingsStoreIn(filepath.Join(dir, settingsFileName)), dir
}

func captureThemeSource(t *testing.T) *[]string {
	t.Helper()
	var applied []string
	original := applyThemeSource
	applyThemeSource = func(theme string) { applied = append(applied, theme) }
	t.Cleanup(func() { applyThemeSource = original })
	return &applied
}

func TestSettingsDefaults(t *testing.T) {
	store, dir := newTestSettings(t)
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeSystem {
		t.Errorf("Theme = %q, want %q", settings.Theme, themeSystem)
	}
	if settings.SidebarWidth != defaultSidebarWidth {
		t.Errorf("SidebarWidth = %d, want %d", settings.SidebarWidth, defaultSidebarWidth)
	}
	if settings.RecentFolders == nil || len(settings.RecentFolders) != 0 {
		t.Errorf("RecentFolders = %#v, want an empty slice", settings.RecentFolders)
	}
	if settings.ExpandedFolders == nil || len(settings.ExpandedFolders) != 0 {
		t.Errorf("ExpandedFolders = %#v, want an empty map", settings.ExpandedFolders)
	}
	if _, err := os.Stat(filepath.Join(dir, settingsFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("Get() created a settings file: %v", err)
	}
}

func TestSettingsSetThemePersistsAndApplies(t *testing.T) {
	store, dir := newTestSettings(t)
	applied := captureThemeSource(t)

	if err := store.setTheme(themeDark); err != nil {
		t.Fatal(err)
	}
	if want := []string{themeDark}; !reflect.DeepEqual(*applied, want) {
		t.Errorf("applied themes = %q, want %q", *applied, want)
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeDark {
		t.Errorf("Theme = %q, want %q", settings.Theme, themeDark)
	}

	data, err := os.ReadFile(filepath.Join(dir, settingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Errorf("settings file does not end with a newline: %q", data)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("settings file is not valid JSON: %v", err)
	}
	if stored["theme"] != themeDark {
		t.Errorf("stored theme = %v, want %q", stored["theme"], themeDark)
	}
	if err := store.setTheme("sepia"); !errors.Is(err, errInvalidTheme) {
		t.Errorf("setTheme(sepia) = %v, want %v", err, errInvalidTheme)
	}
	if got := *applied; len(got) != 1 {
		t.Errorf("invalid theme changed the native appearance: %q", got)
	}
}

func TestSettingsMigrateLegacyTheme(t *testing.T) {
	store, dir := newTestSettings(t)
	applied := captureThemeSource(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte(`{"sidebarWidth":300}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	settings, err := store.migrateLegacyTheme("dark")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeDark || settings.SidebarWidth != 300 {
		t.Fatalf("migrated settings = %+v, want dark with width 300", settings)
	}
	if want := []string{themeDark}; !reflect.DeepEqual(*applied, want) {
		t.Errorf("applied themes = %q, want %q", *applied, want)
	}

	// A theme already in the file wins over the legacy value.
	settings, err = store.migrateLegacyTheme("light")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeDark {
		t.Errorf("second migration changed the theme to %q", settings.Theme)
	}
	if got := *applied; len(got) != 1 {
		t.Errorf("second migration changed the native appearance: %q", got)
	}
}

func TestSettingsLegacyThemeIgnoresInvalidValue(t *testing.T) {
	store, _ := newTestSettings(t)
	captureThemeSource(t)
	settings, err := store.migrateLegacyTheme("sepia")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeSystem {
		t.Errorf("Theme = %q, want %q", settings.Theme, themeSystem)
	}
}

func TestSettingsExplicitSystemThemeIsNotMigrated(t *testing.T) {
	store, dir := newTestSettings(t)
	captureThemeSource(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte(`{"theme":"system"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	settings, err := store.migrateLegacyTheme("dark")
	if err != nil {
		t.Fatal(err)
	}
	if settings.Theme != themeSystem {
		t.Errorf("Theme = %q, want the stored %q", settings.Theme, themeSystem)
	}
}

func TestSettingsClampsSidebarWidth(t *testing.T) {
	store, _ := newTestSettings(t)
	cases := []struct {
		width int
		want  int
	}{
		{100, minSidebarWidth},
		{240, 240},
		{1000, maxSidebarWidth},
	}
	for _, tc := range cases {
		if err := store.update(func(settings *AppSettings) { settings.SidebarWidth = tc.width }); err != nil {
			t.Fatal(err)
		}
		settings, err := store.get()
		if err != nil {
			t.Fatal(err)
		}
		if settings.SidebarWidth != tc.want {
			t.Errorf("SidebarWidth for %d = %d, want %d", tc.width, settings.SidebarWidth, tc.want)
		}
	}
}

func TestSettingsRecentFolders(t *testing.T) {
	store, _ := newTestSettings(t)
	base := t.TempDir()
	for i := 0; i < maxRecentFolders+2; i++ {
		folder := filepath.Join(base, "folder", string(rune('a'+i)))
		if err := store.update(func(settings *AppSettings) {
			settings.RecentFolders = prependRecentFolder(settings.RecentFolders, folder)
		}); err != nil {
			t.Fatal(err)
		}
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.RecentFolders) != maxRecentFolders {
		t.Fatalf("recent folders = %d, want %d", len(settings.RecentFolders), maxRecentFolders)
	}
	newest := filepath.Join(base, "folder", string(rune('a'+maxRecentFolders+1)))
	if settings.RecentFolders[0] != newest {
		t.Errorf("newest folder = %q, want %q", settings.RecentFolders[0], newest)
	}
	if err := store.update(func(settings *AppSettings) {
		settings.RecentFolders = prependRecentFolder(settings.RecentFolders, newest)
	}); err != nil {
		t.Fatal(err)
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(settings.RecentFolders) != maxRecentFolders || settings.RecentFolders[0] != newest {
		t.Errorf("duplicate folder was not moved to the front: %q", settings.RecentFolders)
	}

	if err := store.update(func(settings *AppSettings) {
		kept := settings.RecentFolders[:0]
		for _, folder := range settings.RecentFolders {
			if folder != newest {
				kept = append(kept, folder)
			}
		}
		settings.RecentFolders = append([]string(nil), kept...)
	}); err != nil {
		t.Fatal(err)
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	for _, folder := range settings.RecentFolders {
		if folder == newest {
			t.Errorf("removed folder is still in the list: %q", settings.RecentFolders)
		}
	}
}

func TestSettingsExpandedFolders(t *testing.T) {
	store, _ := newTestSettings(t)
	root := t.TempDir()
	if err := store.update(func(settings *AppSettings) {
		settings.ExpandedFolders[root] = []string{"b", "a", "a", "../escape", "/absolute", "", "notes/b"}
	}); err != nil {
		t.Fatal(err)
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"a", "b", "notes/b"}
	if got := settings.ExpandedFolders[root]; !reflect.DeepEqual(got, want) {
		t.Errorf("expanded folders = %q, want %q", got, want)
	}

	if err := store.update(func(settings *AppSettings) {
		settings.ExpandedFolders[root] = []string{"../escape"}
	}); err != nil {
		t.Fatal(err)
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := settings.ExpandedFolders[root]; ok {
		t.Errorf("empty expanded folders left an entry: %#v", settings.ExpandedFolders)
	}
}

func TestSettingsExpandedFoldersRequiresAbsoluteRoot(t *testing.T) {
	store, _ := newTestSettings(t)
	settings := NewSettings(store)
	if err := settings.SetExpandedFolders("relative", []string{"notes"}); err == nil {
		t.Fatal("SetExpandedFolders accepted a relative root")
	}
}

func TestSettingsAtomicConcurrentWrites(t *testing.T) {
	store, dir := newTestSettings(t)
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func(width int) {
			defer wg.Done()
			if err := store.update(func(settings *AppSettings) { settings.SidebarWidth = width }); err != nil {
				t.Errorf("update() = %v", err)
			}
		}(minSidebarWidth + i)
	}
	wg.Wait()

	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.SidebarWidth < minSidebarWidth || settings.SidebarWidth > maxSidebarWidth {
		t.Errorf("SidebarWidth = %d, want [%d, %d]", settings.SidebarWidth, minSidebarWidth, maxSidebarWidth)
	}
	tempFiles, err := filepath.Glob(filepath.Join(dir, tempFilePrefix+"*"+tempFileSuffix))
	if err != nil {
		t.Fatal(err)
	}
	if len(tempFiles) != 0 {
		t.Errorf("temporary files left behind: %q", tempFiles)
	}
}

func TestSettingsCorruptFile(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := store.get(); err == nil {
		t.Fatal("get() accepted corrupt settings")
	}
	if err := store.setTheme(themeDark); err == nil {
		t.Fatal("setTheme() overwrote corrupt settings")
	}
}
