package main

import (
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestInstanceNameForDataDirIsStableAndDistinct(t *testing.T) {
	firstDir := filepath.Join(t.TempDir(), "first")
	secondDir := filepath.Join(t.TempDir(), "second")

	first := instanceNameForDataDir("Nicole", firstDir)
	if again := instanceNameForDataDir("Nicole", firstDir); again != first {
		t.Errorf("same data directory produced %q then %q", first, again)
	}
	second := instanceNameForDataDir("Nicole", secondDir)
	if first == second {
		t.Errorf("different data directories share the lock name %q", first)
	}
	if first == "Nicole" {
		t.Error("data-directory instance name lost its namespace")
	}
}

func TestAcquireSingleInstanceLockScopesAndRestoresTheName(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(userDataDirEnv, dir)
	t.Setenv("MYGO_GENERATE", "")
	originalName, originalSetName, originalRequest := appName, setAppName, requestSingleInstance
	t.Cleanup(func() {
		appName, setAppName, requestSingleInstance = originalName, originalSetName, originalRequest
	})

	var names []string
	var requests int
	appName = func() string { return "Nicole" }
	setAppName = func(name string) { names = append(names, name) }
	requestSingleInstance = func() bool {
		requests++
		return true
	}

	if !acquireSingleInstanceLock() {
		t.Fatal("acquireSingleInstanceLock() = false, want true")
	}
	if requests != 1 {
		t.Errorf("RequestSingleInstanceLock calls = %d, want 1", requests)
	}
	want := instanceNameForDataDir("Nicole", instanceDataDir())
	if len(names) != 2 || names[0] != want || names[1] != "Nicole" {
		t.Errorf("app names = %q, want [%q %q]", names, want, "Nicole")
	}
}

func TestAcquireSingleInstanceLockRestoresTheNameWhenItFails(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(userDataDirEnv, dir)
	t.Setenv("MYGO_GENERATE", "")
	originalName, originalSetName, originalRequest := appName, setAppName, requestSingleInstance
	t.Cleanup(func() {
		appName, setAppName, requestSingleInstance = originalName, originalSetName, originalRequest
	})

	var names []string
	appName = func() string { return "Nicole" }
	setAppName = func(name string) { names = append(names, name) }
	requestSingleInstance = func() bool { return false }

	if acquireSingleInstanceLock() {
		t.Fatal("acquireSingleInstanceLock() = true, want false")
	}
	if len(names) != 2 || names[1] != "Nicole" {
		t.Errorf("app names after a failed lock = %q, want the display name restored", names)
	}
}

func TestAcquireSingleInstanceLockUsesThePlainNameWithoutAnOverride(t *testing.T) {
	t.Setenv(userDataDirEnv, "")
	t.Setenv("MYGO_GENERATE", "")
	originalName, originalSetName, originalRequest := appName, setAppName, requestSingleInstance
	t.Cleanup(func() {
		appName, setAppName, requestSingleInstance = originalName, originalSetName, originalRequest
	})

	var names []string
	var requests int
	appName = func() string { return "Nicole" }
	setAppName = func(name string) { names = append(names, name) }
	requestSingleInstance = func() bool {
		requests++
		return true
	}

	if !acquireSingleInstanceLock() {
		t.Fatal("acquireSingleInstanceLock() = false, want true")
	}
	if requests != 1 || len(names) != 0 {
		t.Errorf("requests = %d, names = %q; want one request and no temporary name", requests, names)
	}
}

func TestFocusMainWindowWithChoosesTheFirstWindow(t *testing.T) {
	first := &mygo.Window{}
	second := &mygo.Window{}
	var focused *mygo.Window
	focusMainWindowWith(
		func() []*mygo.Window { return []*mygo.Window{first, second} },
		func(win *mygo.Window) { focused = win },
	)
	if focused != first {
		t.Errorf("focused %p, want the first window %p", focused, first)
	}
}
