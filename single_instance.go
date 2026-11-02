package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

// A second launch normally belongs to the running app: hand it the files on
// the command line and focus the existing window. Test and development runs
// use NICOLE_USER_DATA_DIR to stay away from the installed app's data; they
// must also get their own lock, or an isolated instance would be mistaken for
// the installed app. MyGo keys its lock by app name, so acquireSingleInstanceLock() temporarily
// adds a short hash of the data directory to that name. The visible app name
// is restored before anything else runs.
var (
	appName               = mygo.App.Name
	setAppName            = mygo.App.SetName
	requestSingleInstance = func() bool { return mygo.App.RequestSingleInstanceLock() }
)

// acquireSingleInstanceLock is called once at startup. It reports whether
// this process owns the single-instance lock. A false result means another
// process with the same app and data directory received this launch's files
// and this process should exit.
func acquireSingleInstanceLock() bool {
	base := appName()
	if dir := instanceDataDir(); dir != "" && !generatingClient() {
		setAppName(instanceNameForDataDir(base, dir))
		defer setAppName(base)
	}
	return requestSingleInstance()
}

// instanceDataDir returns the absolute user data directory only when the
// override is set. A failed symlink resolution falls back to the clean path;
// configureUserDataPath has already validated it.
func instanceDataDir() string {
	dir := strings.TrimSpace(os.Getenv(userDataDirEnv))
	if dir == "" {
		return ""
	}
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return filepath.Clean(dir)
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return resolved
	}
	return filepath.Clean(absolute)
}

// instanceNameForDataDir keeps the display name for logs while separating
// MyGo's lock namespace for the given data directory.
func instanceNameForDataDir(base, dir string) string {
	sum := sha256.Sum256([]byte(filepath.Clean(dir)))
	return base + " [" + hex.EncodeToString(sum[:8]) + "]"
}

// installSecondInstanceFocus brings the existing main window forward when a
// later launch hands its command line to this process. MyGo calls the handler
// on the main thread and then delivers the files through OnOpenFile.
func installSecondInstanceFocus() {
	mygo.App.OnSecondInstance(func([]string, string) {
		focusMainWindow()
	})
}

// focusMainWindow restores and focuses the first app window. It is separate
// from the window list so a unit test can check the choice without a native
// window.
func focusMainWindow() {
	focusMainWindowWith(mygo.Windows, func(win *mygo.Window) {
		win.Restore()
		win.Show()
		win.Focus()
	})
}

func focusMainWindowWith(list func() []*mygo.Window, focus func(*mygo.Window)) {
	windows := list()
	if len(windows) == 0 {
		return
	}
	focus(windows[0])
}
