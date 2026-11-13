package main

import (
	"bytes"
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
	if settings.EditorMode != editorModeLive {
		t.Errorf("EditorMode = %q, want %q", settings.EditorMode, editorModeLive)
	}
	if settings.OutlineVisible {
		t.Error("OutlineVisible = true, want the default false")
	}
	if settings.FormatToolbarVisible {
		t.Error("FormatToolbarVisible = true, want the default false")
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

func TestSettingsEditorModeDefaultsToLive(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)

	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.EditorMode != editorModeLive {
		t.Errorf("missing settings file: EditorMode = %q, want %q", settings.EditorMode, editorModeLive)
	}

	legacy := []byte(`{"theme":"dark","sidebarWidth":300,"recentFolders":["/notes"],"expandedFolders":{"/notes":["a"]},"workspaceClosed":true}` + "\n")
	if err := os.WriteFile(filePath, legacy, 0o644); err != nil {
		t.Fatal(err)
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.EditorMode != editorModeLive {
		t.Errorf("missing editorMode: EditorMode = %q, want %q", settings.EditorMode, editorModeLive)
	}
	if !settings.WorkspaceClosed || settings.Theme != themeDark || settings.SidebarWidth != 300 {
		t.Errorf("existing fields changed while defaulting the mode: %+v", settings)
	}

	if err := os.WriteFile(filePath, []byte(`{"editorMode":"sepia","workspaceClosed":true}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.EditorMode != editorModeLive {
		t.Errorf("invalid editorMode: EditorMode = %q, want %q", settings.EditorMode, editorModeLive)
	}
	if !settings.WorkspaceClosed {
		t.Error("invalid editorMode cleared workspaceClosed")
	}
}

func TestSettingsEditorModeToleratesWrongJSONTypes(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	if !filepath.IsAbs(root) {
		t.Fatalf("test folder %q is not absolute", root)
	}
	cases := []struct {
		name  string
		value string
	}{
		{"number", "1"},
		{"bool", "true"},
		{"object", `{"mode":"source"}`},
		{"array", `["source"]`},
		{"null", "null"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := struct {
				Theme           string              `json:"theme"`
				EditorMode      json.RawMessage     `json:"editorMode"`
				SidebarWidth    int                 `json:"sidebarWidth"`
				RecentFolders   []string            `json:"recentFolders"`
				ExpandedFolders map[string][]string `json:"expandedFolders"`
				WorkspaceClosed bool                `json:"workspaceClosed"`
			}{
				Theme:           themeDark,
				EditorMode:      json.RawMessage(tc.value),
				SidebarWidth:    300,
				RecentFolders:   []string{root},
				ExpandedFolders: map[string][]string{root: {"a"}},
				WorkspaceClosed: true,
			}
			content, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			content = append(content, '\n')
			if err := os.WriteFile(filePath, content, 0o644); err != nil {
				t.Fatal(err)
			}

			settings, err := store.get()
			if err != nil {
				t.Fatalf("get() = %v, want a usable settings value", err)
			}
			if settings.EditorMode != editorModeLive {
				t.Errorf("EditorMode = %q, want %q", settings.EditorMode, editorModeLive)
			}
			if settings.Theme != themeDark || settings.SidebarWidth != 300 || !settings.WorkspaceClosed {
				t.Errorf("valid fields were reset: %+v", settings)
			}
			if len(settings.RecentFolders) != 1 || settings.RecentFolders[0] != root {
				t.Errorf("RecentFolders = %q, want [%q]", settings.RecentFolders, root)
			}
			if got := settings.ExpandedFolders[root]; len(got) != 1 || got[0] != "a" {
				t.Errorf("ExpandedFolders = %#v, want %q: [a]", settings.ExpandedFolders, root)
			}

			after, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatalf("settings file was moved or removed: %v", err)
			}
			if !bytes.Equal(after, content) {
				t.Errorf("reading a wrong editorMode type rewrote the file: %q", after)
			}
			backups, err := filepath.Glob(filePath + ".corrupt-*")
			if err != nil {
				t.Fatal(err)
			}
			if len(backups) != 0 {
				t.Errorf("wrong editorMode type created a corrupt backup: %q", backups)
			}
		})
	}
}

func TestSettingsSetEditorMode(t *testing.T) {
	store, dir := newTestSettings(t)
	settings := NewSettings(store)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	legacy, err := json.Marshal(map[string]any{
		"theme":           themeDark,
		"sidebarWidth":    300,
		"recentFolders":   []string{root},
		"expandedFolders": map[string][]string{root: {"a"}},
		"workspaceClosed": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	legacy = append(legacy, '\n')
	if err := os.WriteFile(filePath, legacy, 0o644); err != nil {
		t.Fatal(err)
	}

	for _, mode := range []string{editorModeImmersive, editorModeSource, editorModeLive} {
		if err := settings.SetEditorMode(mode); err != nil {
			t.Fatalf("SetEditorMode(%q) = %v", mode, err)
		}
		loaded, err := store.get()
		if err != nil {
			t.Fatal(err)
		}
		if loaded.EditorMode != mode {
			t.Errorf("EditorMode after SetEditorMode(%q) = %q", mode, loaded.EditorMode)
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("settings file is not valid JSON: %v", err)
	}
	if stored["theme"] != themeDark || stored["sidebarWidth"] != float64(300) {
		t.Errorf("existing display fields changed: %#v", stored)
	}
	if stored["workspaceClosed"] != true {
		t.Errorf("workspaceClosed = %v, want true", stored["workspaceClosed"])
	}
	if recent, ok := stored["recentFolders"].([]any); !ok || len(recent) != 1 || recent[0] != root {
		t.Errorf("recentFolders changed: %#v, want [%q]", stored["recentFolders"], root)
	}
	if expanded, ok := stored["expandedFolders"].(map[string]any); !ok || len(expanded) != 1 {
		t.Errorf("expandedFolders changed: %#v", stored["expandedFolders"])
	} else if folders, ok := expanded[root].([]any); !ok || len(folders) != 1 || folders[0] != "a" {
		t.Errorf("expandedFolders[%q] = %#v, want [a]", root, expanded[root])
	}

	before := data
	if err := settings.SetEditorMode("sepia"); !errors.Is(err, errInvalidEditorMode) {
		t.Errorf("SetEditorMode(sepia) = %v, want %v", err, errInvalidEditorMode)
	}
	after, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Errorf("invalid mode changed the settings file: %q -> %q", before, after)
	}
}

func TestSettingsSetOutlineVisible(t *testing.T) {
	store, dir := newTestSettings(t)
	settings := NewSettings(store)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	fixture, err := json.Marshal(map[string]any{
		"theme":           themeDark,
		"editorMode":      editorModeSource,
		"sidebarWidth":    300,
		"recentFolders":   []string{root},
		"expandedFolders": map[string][]string{root: {"a"}},
		"workspaceClosed": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	if err := os.WriteFile(filePath, fixture, 0o644); err != nil {
		t.Fatal(err)
	}

	for _, visible := range []bool{true, false, true} {
		if err := settings.SetOutlineVisible(visible); err != nil {
			t.Fatalf("SetOutlineVisible(%v) = %v", visible, err)
		}
		loaded, err := store.get()
		if err != nil {
			t.Fatal(err)
		}
		if loaded.OutlineVisible != visible {
			t.Errorf("OutlineVisible = %v, want %v", loaded.OutlineVisible, visible)
		}
		if loaded.Theme != themeDark || loaded.EditorMode != editorModeSource ||
			loaded.SidebarWidth != 300 || !loaded.WorkspaceClosed {
			t.Errorf("other settings changed after SetOutlineVisible(%v): %+v", visible, loaded)
		}
		if len(loaded.RecentFolders) != 1 || loaded.RecentFolders[0] != root {
			t.Errorf("RecentFolders = %q, want [%q]", loaded.RecentFolders, root)
		}
		if got := loaded.ExpandedFolders[root]; len(got) != 1 || got[0] != "a" {
			t.Errorf("ExpandedFolders[%q] = %q, want [a]", root, got)
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("settings file is not valid JSON: %v", err)
	}
	if stored["outlineVisible"] != true {
		t.Errorf("outlineVisible = %v, want true", stored["outlineVisible"])
	}
}

func TestSettingsOutlineVisibleToleratesWrongJSONTypes(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	cases := []struct {
		name  string
		value string
	}{
		{"string", `"yes"`},
		{"number", "1"},
		{"object", `{"visible":true}`},
		{"array", "[true]"},
		{"null", "null"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := struct {
				Theme           string              `json:"theme"`
				EditorMode      string              `json:"editorMode"`
				OutlineVisible  json.RawMessage     `json:"outlineVisible"`
				SidebarWidth    int                 `json:"sidebarWidth"`
				RecentFolders   []string            `json:"recentFolders"`
				ExpandedFolders map[string][]string `json:"expandedFolders"`
				WorkspaceClosed bool                `json:"workspaceClosed"`
			}{
				Theme:           themeDark,
				EditorMode:      editorModeSource,
				OutlineVisible:  json.RawMessage(tc.value),
				SidebarWidth:    300,
				RecentFolders:   []string{root},
				ExpandedFolders: map[string][]string{root: {"a"}},
				WorkspaceClosed: true,
			}
			content, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			content = append(content, '\n')
			if err := os.WriteFile(filePath, content, 0o644); err != nil {
				t.Fatal(err)
			}

			settings, err := store.get()
			if err != nil {
				t.Fatalf("get() = %v, want a usable settings value", err)
			}
			if settings.OutlineVisible {
				t.Error("OutlineVisible = true, want the default false")
			}
			if settings.Theme != themeDark || settings.EditorMode != editorModeSource ||
				settings.SidebarWidth != 300 || !settings.WorkspaceClosed {
				t.Errorf("valid fields were reset: %+v", settings)
			}
			if len(settings.RecentFolders) != 1 || settings.RecentFolders[0] != root {
				t.Errorf("RecentFolders = %q, want [%q]", settings.RecentFolders, root)
			}
			if got := settings.ExpandedFolders[root]; len(got) != 1 || got[0] != "a" {
				t.Errorf("ExpandedFolders[%q] = %#v, want [a]", root, got)
			}

			after, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatalf("settings file was moved or removed: %v", err)
			}
			if !bytes.Equal(after, content) {
				t.Errorf("reading a wrong outlineVisible type rewrote the file: %q", after)
			}
			backups, err := filepath.Glob(filePath + ".corrupt-*")
			if err != nil {
				t.Fatal(err)
			}
			if len(backups) != 0 {
				t.Errorf("wrong outlineVisible type created a corrupt backup: %q", backups)
			}
		})
	}
}

func TestSettingsSetFormatToolbarVisible(t *testing.T) {
	store, dir := newTestSettings(t)
	settings := NewSettings(store)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	fixture, err := json.Marshal(map[string]any{
		"theme":           themeDark,
		"editorMode":      editorModeSource,
		"outlineVisible":  true,
		"sidebarWidth":    300,
		"recentFolders":   []string{root},
		"expandedFolders": map[string][]string{root: {"a"}},
		"workspaceClosed": true,
	})
	if err != nil {
		t.Fatal(err)
	}
	fixture = append(fixture, '\n')
	if err := os.WriteFile(filePath, fixture, 0o644); err != nil {
		t.Fatal(err)
	}

	for _, visible := range []bool{true, false, true, false} {
		if err := settings.SetFormatToolbarVisible(visible); err != nil {
			t.Fatalf("SetFormatToolbarVisible(%v) = %v", visible, err)
		}
		loaded, err := store.get()
		if err != nil {
			t.Fatal(err)
		}
		if loaded.FormatToolbarVisible != visible {
			t.Errorf("FormatToolbarVisible = %v, want %v", loaded.FormatToolbarVisible, visible)
		}
		if loaded.Theme != themeDark || loaded.EditorMode != editorModeSource ||
			!loaded.OutlineVisible || loaded.SidebarWidth != 300 ||
			!loaded.WorkspaceClosed {
			t.Errorf("other settings changed after SetFormatToolbarVisible(%v): %+v", visible, loaded)
		}
		if len(loaded.RecentFolders) != 1 || loaded.RecentFolders[0] != root {
			t.Errorf("RecentFolders = %q, want [%q]", loaded.RecentFolders, root)
		}
		if got := loaded.ExpandedFolders[root]; len(got) != 1 || got[0] != "a" {
			t.Errorf("ExpandedFolders[%q] = %q, want [a]", root, got)
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("settings file is not valid JSON: %v", err)
	}
	if stored["formatToolbarVisible"] != false {
		t.Errorf("formatToolbarVisible = %v, want an explicit false", stored["formatToolbarVisible"])
	}
}

func TestSettingsFormatToolbarVisibleToleratesWrongJSONTypes(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	root := filepath.Join(dir, "notes")
	cases := []struct {
		name   string
		value  string
		hidden bool
	}{
		{name: "missing", value: "", hidden: true},
		{name: "string", value: `"yes"`, hidden: true},
		{name: "number", value: "1", hidden: true},
		{name: "object", value: `{"visible":true}`, hidden: true},
		{name: "array", value: "[true]", hidden: true},
		{name: "null", value: "null", hidden: true},
		{name: "explicit false", value: "false", hidden: true},
		{name: "explicit true", value: "true", hidden: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw json.RawMessage
			if tc.value != "" {
				raw = json.RawMessage(tc.value)
			}
			fixture := struct {
				Theme                string              `json:"theme"`
				EditorMode           string              `json:"editorMode"`
				OutlineVisible       bool                `json:"outlineVisible"`
				FormatToolbarVisible json.RawMessage     `json:"formatToolbarVisible,omitempty"`
				SidebarWidth         int                 `json:"sidebarWidth"`
				RecentFolders        []string            `json:"recentFolders"`
				ExpandedFolders      map[string][]string `json:"expandedFolders"`
				WorkspaceClosed      bool                `json:"workspaceClosed"`
			}{
				Theme:                themeDark,
				EditorMode:           editorModeSource,
				OutlineVisible:       true,
				FormatToolbarVisible: raw,
				SidebarWidth:         300,
				RecentFolders:        []string{root},
				ExpandedFolders:      map[string][]string{root: {"a"}},
				WorkspaceClosed:      true,
			}
			content, err := json.Marshal(fixture)
			if err != nil {
				t.Fatal(err)
			}
			content = append(content, '\n')
			if err := os.WriteFile(filePath, content, 0o644); err != nil {
				t.Fatal(err)
			}

			settings, err := store.get()
			if err != nil {
				t.Fatalf("get() = %v, want a usable settings value", err)
			}
			if settings.FormatToolbarVisible != !tc.hidden {
				t.Errorf("FormatToolbarVisible = %v, want %v", settings.FormatToolbarVisible, !tc.hidden)
			}
			if settings.Theme != themeDark || settings.EditorMode != editorModeSource ||
				!settings.OutlineVisible || settings.SidebarWidth != 300 ||
				!settings.WorkspaceClosed {
				t.Errorf("valid fields were reset: %+v", settings)
			}
			if len(settings.RecentFolders) != 1 || settings.RecentFolders[0] != root {
				t.Errorf("RecentFolders = %q, want [%q]", settings.RecentFolders, root)
			}
			if got := settings.ExpandedFolders[root]; len(got) != 1 || got[0] != "a" {
				t.Errorf("ExpandedFolders[%q] = %#v, want [a]", root, got)
			}

			after, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatalf("settings file was moved or removed: %v", err)
			}
			if !bytes.Equal(after, content) {
				t.Errorf("reading formatToolbarVisible=%q rewrote the file: %q", tc.value, after)
			}
			backups, err := filepath.Glob(filePath + ".corrupt-*")
			if err != nil {
				t.Fatal(err)
			}
			if len(backups) != 0 {
				t.Errorf("formatToolbarVisible=%q created a corrupt backup: %q", tc.value, backups)
			}
		})
	}
}

func TestSettingsFormatToolbarConcurrentWriteKeepsOtherFields(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte(`{"theme":"dark","sidebarWidth":300}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	var group sync.WaitGroup
	group.Add(2)
	go func() {
		defer group.Done()
		if err := store.setFormatToolbarVisible(true); err != nil {
			t.Errorf("setFormatToolbarVisible: %v", err)
		}
	}()
	go func() {
		defer group.Done()
		if err := store.update(func(settings *AppSettings) {
			settings.OutlineVisible = true
		}); err != nil {
			t.Errorf("update outlineVisible: %v", err)
		}
	}()
	group.Wait()

	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if !settings.FormatToolbarVisible || !settings.OutlineVisible {
		t.Errorf("concurrent updates lost a field: %+v", settings)
	}
	if settings.Theme != themeDark || settings.SidebarWidth != 300 {
		t.Errorf("concurrent updates lost existing settings: %+v", settings)
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

func TestSettingsCorruptFileIsBackedUpAndRecovered(t *testing.T) {
	store, dir := newTestSettings(t)
	captureThemeSource(t)
	filePath := filepath.Join(dir, settingsFileName)
	corrupt := []byte("{not json")
	if err := os.WriteFile(filePath, corrupt, 0o644); err != nil {
		t.Fatal(err)
	}

	settings, err := store.get()
	if err != nil {
		t.Fatalf("get() = %v, want defaults after backing up the file", err)
	}
	if settings.Theme != themeSystem || settings.SidebarWidth != defaultSidebarWidth {
		t.Errorf("defaults after corrupt settings = %+v", settings)
	}
	if _, err := os.Stat(filePath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("corrupt settings still at the original path: %v", err)
	}
	backups, err := filepath.Glob(filePath + ".corrupt-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(backups) != 1 {
		t.Fatalf("backup files = %q, want one", backups)
	}
	if data, err := os.ReadFile(backups[0]); err != nil || string(data) != string(corrupt) {
		t.Errorf("backup content = %q, %v; want the original bytes", data, err)
	}

	if err := store.setTheme(themeDark); err != nil {
		t.Fatalf("setTheme() after corrupt settings = %v", err)
	}
	settings, err = store.get()
	if err != nil || settings.Theme != themeDark {
		t.Errorf("settings after recovery = %+v, %v; want dark", settings, err)
	}
}

func TestSettingsPresentationDefaults(t *testing.T) {
	store, dir := newTestSettings(t)
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if !settings.ShowAllFiles {
		t.Error("ShowAllFiles = false, want the default true")
	}
	if settings.HideMarkdownExtension {
		t.Error("HideMarkdownExtension = true, want the default false")
	}
	if settings.UIFont != "" || settings.ReadingFont != "" || settings.CodeFont != "" {
		t.Errorf("font defaults = %+v, want empty strings", settings)
	}
	if !settings.SlashEnabled.Live || !settings.SlashEnabled.Immersive || !settings.SlashEnabled.Source {
		t.Errorf("SlashEnabled = %+v, want all three enabled", settings.SlashEnabled)
	}
	if _, err := os.Stat(filepath.Join(dir, settingsFileName)); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("Get() created a settings file: %v", err)
	}
}

func TestSettingsSetPresentationFields(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte(`{"theme":"dark","outlineVisible":true,"sidebarWidth":300,"recentFolders":["/notes"]}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	settings := NewSettings(store)
	if err := settings.SetFonts("  Hannotate SC  ", "Songti SC", " SF Mono "); err != nil {
		t.Fatal(err)
	}
	if err := settings.SetShowAllFiles(false); err != nil {
		t.Fatal(err)
	}
	if err := settings.SetHideMarkdownExtension(true); err != nil {
		t.Fatal(err)
	}
	if err := settings.SetSlashEnabled(editorModeImmersive, false); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.UIFont != "Hannotate SC" || loaded.ReadingFont != "Songti SC" || loaded.CodeFont != "SF Mono" {
		t.Errorf("fonts = %q, %q, %q", loaded.UIFont, loaded.ReadingFont, loaded.CodeFont)
	}
	if loaded.ShowAllFiles || !loaded.HideMarkdownExtension {
		t.Errorf("file tree preferences = show %v, hide %v", loaded.ShowAllFiles, loaded.HideMarkdownExtension)
	}
	if loaded.SlashEnabled.Live != true || loaded.SlashEnabled.Immersive != false || loaded.SlashEnabled.Source != true {
		t.Errorf("SlashEnabled = %+v, want true/false/true", loaded.SlashEnabled)
	}
	if loaded.Theme != themeDark || !loaded.OutlineVisible || loaded.SidebarWidth != 300 {
		t.Errorf("existing settings changed: %+v", loaded)
	}
	if err := settings.SetSlashEnabled("sepia", false); !errors.Is(err, errInvalidEditorMode) {
		t.Errorf("SetSlashEnabled(sepia) = %v, want %v", err, errInvalidEditorMode)
	}
}

func TestSettingsPresentationFieldsTolerateMissingAndBadTypes(t *testing.T) {
	cases := []struct {
		name  string
		value string
	}{
		{"missing", `"theme":"dark","outlineVisible":true,"sidebarWidth":300,"recentFolders":["/notes"],"editorMode":"source","formatToolbarVisible":true`},
		{"wrong types", `"theme":"dark","outlineVisible":true,"sidebarWidth":300,"recentFolders":["/notes"],"editorMode":"source","formatToolbarVisible":true,"showAllFiles":"yes","hideMarkdownExtension":1,"uiFont":true,"readingFont":{"name":"Songti"},"codeFont":["SF Mono"],"slashEnabled":"all"`},
		{"null", `"theme":"dark","outlineVisible":true,"sidebarWidth":300,"recentFolders":["/notes"],"editorMode":"source","formatToolbarVisible":true,"showAllFiles":null,"hideMarkdownExtension":null,"uiFont":null,"readingFont":null,"codeFont":null,"slashEnabled":null`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store, dir := newTestSettings(t)
			filePath := filepath.Join(dir, settingsFileName)
			fixture := `{` + tc.value + `}`
			if err := os.WriteFile(filePath, []byte(fixture+"\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			settings, err := store.get()
			if err != nil {
				t.Fatalf("get() = %v", err)
			}
			if !settings.ShowAllFiles || settings.HideMarkdownExtension {
				t.Errorf("file tree defaults = show %v, hide %v", settings.ShowAllFiles, settings.HideMarkdownExtension)
			}
			if settings.UIFont != "" || settings.ReadingFont != "" || settings.CodeFont != "" {
				t.Errorf("font fields = %q, %q, %q", settings.UIFont, settings.ReadingFont, settings.CodeFont)
			}
			if !settings.SlashEnabled.Live || !settings.SlashEnabled.Immersive || !settings.SlashEnabled.Source {
				t.Errorf("SlashEnabled = %+v, want all enabled", settings.SlashEnabled)
			}
			if settings.Theme != themeDark || !settings.OutlineVisible || settings.SidebarWidth != 300 || settings.EditorMode != editorModeSource || !settings.FormatToolbarVisible {
				t.Errorf("existing fields were reset: %+v", settings)
			}
			after, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatal(err)
			}
			if string(after) != fixture+"\n" {
				t.Errorf("reading settings rewrote the file: %q", after)
			}
		})
	}
}

func TestSettingsSlashEnabledKeepsValidFalseBesideBadSibling(t *testing.T) {
	store, dir := newTestSettings(t)
	filePath := filepath.Join(dir, settingsFileName)
	if err := os.WriteFile(filePath, []byte(`{"slashEnabled":{"live":false,"immersive":"sometimes","source":false},"showAllFiles":false}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.SlashEnabled.Live || !settings.SlashEnabled.Immersive || settings.SlashEnabled.Source {
		t.Errorf("SlashEnabled = %+v, want false/true/false", settings.SlashEnabled)
	}
	if settings.ShowAllFiles {
		t.Error("a bad slash subfield reset showAllFiles")
	}
}

func TestSettingsPresentationUpdatesDoNotClobberOtherFields(t *testing.T) {
	store, dir := newTestSettings(t)
	var wg sync.WaitGroup
	updates := []func(*settingsStore) error{
		func(s *settingsStore) error { return s.update(func(v *AppSettings) { v.UIFont = "Interface" }) },
		func(s *settingsStore) error { return s.update(func(v *AppSettings) { v.ReadingFont = "Reading" }) },
		func(s *settingsStore) error { return s.update(func(v *AppSettings) { v.CodeFont = "Code" }) },
		func(s *settingsStore) error { return s.update(func(v *AppSettings) { v.ShowAllFiles = false }) },
		func(s *settingsStore) error { return s.update(func(v *AppSettings) { v.HideMarkdownExtension = true }) },
		func(s *settingsStore) error {
			return s.update(func(v *AppSettings) { v.SlashEnabled.Source = false })
		},
	}
	for _, update := range updates {
		wg.Add(1)
		go func(update func(*settingsStore) error) {
			defer wg.Done()
			if err := update(store); err != nil {
				t.Errorf("update() = %v", err)
			}
		}(update)
	}
	wg.Wait()
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.UIFont != "Interface" || settings.ReadingFont != "Reading" || settings.CodeFont != "Code" {
		t.Errorf("fonts lost across concurrent writes: %+v", settings)
	}
	if settings.ShowAllFiles || !settings.HideMarkdownExtension || settings.SlashEnabled.Source {
		t.Errorf("presentation fields lost across concurrent writes: %+v", settings)
	}
	if !settings.SlashEnabled.Live || !settings.SlashEnabled.Immersive {
		t.Errorf("slash siblings changed: %+v", settings.SlashEnabled)
	}
	tempFiles, err := filepath.Glob(filepath.Join(dir, tempFilePrefix+"*"+tempFileSuffix))
	if err != nil {
		t.Fatal(err)
	}
	if len(tempFiles) != 0 {
		t.Errorf("temporary files left behind: %q", tempFiles)
	}
}
