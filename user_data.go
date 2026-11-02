package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

// userDataDirEnv overrides the directory where the app keeps its user data:
// the settings file, the window state and, later, recovery copies. Tests and
// development builds set it so they never read or write the installed app's
// data. An override must be absolute, so a mistyped relative path cannot put
// the data in a build directory that is later cleaned.
const userDataDirEnv = "NICOLE_USER_DATA_DIR"

// generatingClient reports MyGo's client-generation run. `mygo generate`,
// `mygo dev` and `mygo build` compile a temporary binary named
// "Nicole-<pid>" and run it with MYGO_GENERATE set; MyGo's Path(PathUserData)
// would name a real directory after that temporary binary. Startup must not
// touch user data in that mode.
func generatingClient() bool {
	return os.Getenv("MYGO_GENERATE") != ""
}

// configureUserDataPath points MyGo's PathUserData at the override too, so
// plugin state such as updater.json follows the same isolated directory.
func configureUserDataPath() error {
	dir := strings.TrimSpace(os.Getenv(userDataDirEnv))
	if dir == "" {
		return nil
	}
	if !filepath.IsAbs(dir) {
		return fmt.Errorf("%s must be an absolute path: %q", userDataDirEnv, dir)
	}
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	mygo.App.SetPath(mygo.PathUserData, dir)
	return nil
}

// userDataDir returns the directory for the app's user data. MyGo's
// Path(PathUserData) creates <user config dir>/<app name> on first use; with
// an override, the directory is the override itself and its ancestors are not
// touched.
func userDataDir() (string, error) {
	if dir := strings.TrimSpace(os.Getenv(userDataDirEnv)); dir != "" {
		if !filepath.IsAbs(dir) {
			return "", fmt.Errorf("%s must be an absolute path: %q", userDataDirEnv, dir)
		}
		dir = filepath.Clean(dir)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		return dir, nil
	}
	return mygo.App.Path(mygo.PathUserData)
}
