package main

import (
	"fmt"
	"os"
	"runtime"
	"testing"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
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
	// Menus take the app's language when they are built, as in main; resolving
	// it here keeps the label tests independent of the test machine's language.
	// The user data path is set first: reading the locale may create it.
	configureAppLanguage()
	// The menu test builds the app menu, which holds the updater's item.
	mygo.Use(updater.Plugin)
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
	home, _ := os.UserHomeDir()
	if info.HomeDir != home {
		t.Errorf("HomeDir = %q, want %q", info.HomeDir, home)
	}
}
