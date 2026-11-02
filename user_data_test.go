package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUserDataDirUsesOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "user-data")
	t.Setenv(userDataDirEnv, dir)

	got, err := userDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if got != dir {
		t.Errorf("userDataDir() = %q, want %q", got, dir)
	}
	if info, err := os.Stat(got); err != nil || !info.IsDir() {
		t.Fatalf("userDataDir() did not create the override: %v", err)
	}
}

func TestUserDataDirRejectsRelativeOverride(t *testing.T) {
	t.Setenv(userDataDirEnv, "relative/data")
	if _, err := userDataDir(); err == nil {
		t.Fatal("userDataDir() accepted a relative override")
	}
}

func TestUserDataDirIsIsolatedDuringTests(t *testing.T) {
	dir, err := userDataDir()
	if err != nil {
		t.Fatal(err)
	}
	if dir == "" || !filepath.IsAbs(dir) {
		t.Fatalf("userDataDir() = %q, want an absolute test directory", dir)
	}
	config, err := os.UserConfigDir()
	if err != nil {
		t.Skipf("no user config directory: %v", err)
	}
	real := filepath.Join(config, "Nicole")
	if dir == real || strings.HasPrefix(dir, real+string(filepath.Separator)) {
		t.Fatalf("tests are using the real Nicole data directory: %q", dir)
	}
}

func TestSettingsStoreUsesUserDataOverride(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "user-data")
	t.Setenv(userDataDirEnv, dir)

	captureThemeSource(t)
	store, err := newSettingsStore()
	if err != nil {
		t.Fatal(err)
	}
	settings := NewSettings(store)
	if err := settings.SetTheme(themeDark); err != nil {
		t.Fatal(err)
	}
	got, err := settings.Get()
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != themeDark {
		t.Errorf("theme = %q, want %q", got.Theme, themeDark)
	}
	if _, err := os.Stat(filepath.Join(dir, settingsFileName)); err != nil {
		t.Fatalf("settings file was not written under the override: %v", err)
	}
}

func TestStartupStoresAvoidUserDataWhileGenerating(t *testing.T) {
	t.Setenv("MYGO_GENERATE", filepath.Join(t.TempDir(), "bindings.ts"))
	config, err := os.UserConfigDir()
	if err != nil {
		t.Skipf("no user config directory: %v", err)
	}
	real := filepath.Join(config, "Nicole")

	store, err := startupSettingsStore()
	if err != nil {
		t.Fatal(err)
	}
	if store.filePath == "" || filepath.Dir(store.filePath) != filepath.Join(os.TempDir(), "nicole-generate") {
		t.Errorf("generate settings path = %q", store.filePath)
	}
	if _, err := os.Stat(store.filePath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("generate settings path was created: %v", err)
	}
	if strings.HasPrefix(store.filePath, real+string(filepath.Separator)) {
		t.Errorf("generate settings path points at real user data: %q", store.filePath)
	}
	if settings, err := store.get(); err != nil || settings.Theme != themeSystem {
		t.Errorf("generate settings = %+v, %v", settings, err)
	}

	state, err := startupWindowStateStore()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(state.filePath) != filepath.Join(os.TempDir(), "nicole-generate") {
		t.Errorf("generate window state path = %q", state.filePath)
	}
	if _, err := os.Stat(state.filePath); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("generate window state path was created: %v", err)
	}
}

func TestStartupStoresUseOverrideOutsideGenerating(t *testing.T) {
	t.Setenv("MYGO_GENERATE", "")
	dir := filepath.Join(t.TempDir(), "user-data")
	t.Setenv(userDataDirEnv, dir)
	captureThemeSource(t)
	store, err := startupSettingsStore()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(store.filePath) != dir {
		t.Errorf("settings path = %q, want under %q", store.filePath, dir)
	}
	state, err := startupWindowStateStore()
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(state.filePath) != dir {
		t.Errorf("window state path = %q, want under %q", state.filePath, dir)
	}
}
