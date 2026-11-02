package main

import (
	"fmt"
	"os"
	"runtime"
	"testing"

	"github.com/egoist/mygo"
)

// TestMain gives every test its own user data directory. Some tests exercise
// stores that resolve the user data directory, and MyGo's Path(PathUserData)
// creates the directory under the real Application Support on first use. The
// override keeps tests out of the installed app's data.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "nicole-test-user-data-")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.Setenv(userDataDirEnv, dir); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.RemoveAll(dir)
		os.Exit(1)
	}
	mygo.App.SetPath(mygo.PathUserData, dir)
	code := m.Run()
	os.RemoveAll(dir)
	os.Exit(code)
}

func TestApplicationInfo(t *testing.T) {
	info := NewApplication("0.0.1").Info()

	if info.Version != "0.0.1" {
		t.Errorf("Version = %q, want %q", info.Version, "0.0.1")
	}
	if info.OS != runtime.GOOS {
		t.Errorf("OS = %q, want %q", info.OS, runtime.GOOS)
	}
	if info.Arch != runtime.GOARCH {
		t.Errorf("Arch = %q, want %q", info.Arch, runtime.GOARCH)
	}
	if info.GoVersion != runtime.Version() {
		t.Errorf("GoVersion = %q, want %q", info.GoVersion, runtime.Version())
	}
}
