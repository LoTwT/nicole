package main

import (
	"errors"
	"log"
	"net/url"
	"os"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/locales/zh-Hans"
	"github.com/egoist/mygo/plugins/updater"
)

// appLanguage is the only language the interface shows. Language switching
// is not a product feature: MyGo's role menus, the updater and the page all
// follow this one tag.
const appLanguage = "zh-Hans"

// configureAppLanguage declares the app's language and works it out before
// the first menu exists. Menu items take the language of the app when they are
// made, and MyGo only relabels items that still have their role; since
// customizeEditMenu clears the roles of Undo and Redo, the language must be
// settled before the menu is built. Call it on the main thread.
func configureAppLanguage() {
	mygo.App.SetLanguages(appLanguage)
	if generatingClient() {
		// `mygo generate` runs this binary under a temporary app name, and
		// reading the locale may create its user data directory. It writes a
		// client, not a menu.
		return
	}
	_ = mygo.App.Locale()
}

// AppInfo describes the running app and the Go runtime behind it.
type AppInfo struct {
	Version   string `json:"version"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
	// HomeDir is the user's home folder, used to shorten paths in the
	// interface. It is empty when the platform cannot report it.
	HomeDir string `json:"homeDir"`
}

// Application is bound to the frontend: `mygo generate` turns its methods into
// typed TypeScript functions under src/services/.
type Application struct {
	version string
}

// The test seam keeps system browser calls out of unit tests.
var openExternal = mygo.Shell.OpenExternal

// NewApplication returns the service with the version of the packaged app.
func NewApplication(version string) Application {
	return Application{version: version}
}

// Info returns the app version and the runtime that serves the page.
func (app Application) Info() AppInfo {
	home, _ := os.UserHomeDir()
	return AppInfo{
		Version:   app.version,
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		GoVersion: runtime.Version(),
		HomeDir:   home,
	}
}

func validExternalURL(target string) bool {
	if strings.IndexFunc(target, func(character rune) bool {
		return character < 0x20 || character == 0x7f
	}) != -1 {
		return false
	}
	parsed, err := url.Parse(target)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}
	return parsed.Opaque == "" && parsed.Host != "" && parsed.Hostname() != ""
}

// OpenExternalURL opens a complete HTTP(S) URL in the system browser. No
// local path or other scheme reaches the operating system from the page.
func (app Application) OpenExternalURL(target string) error {
	if !validExternalURL(target) {
		return errors.New("external URL must be a complete HTTP(S) URL")
	}
	return openExternal(target)
}

func main() {
	if err := configureUserDataPath(); err != nil {
		log.Fatal(err)
	}
	if !acquireSingleInstanceLock() {
		return
	}
	installSecondInstanceFocus()
	configureAppLanguage()
	workspace := NewWorkspace()
	settingsStore, err := startupSettingsStore()
	if err != nil {
		log.Fatal(err)
	}
	workspace.useSettings(settingsStore)
	tabsStore, err := startupTabsStore()
	if err != nil {
		log.Fatal(err)
	}
	workspaceTabs := NewWorkspaceTabs(tabsStore)
	workspaceTabs.useCurrentRoot(workspace.openRoot)
	if !generatingClient() {
		applySavedTheme(settingsStore)
	}
	assets := NewAssets(workspace)

	diskHashes := newDiskHashes()
	workspace.useDiskHashes(diskHashes)
	singleFiles := NewSingleFileService()
	singleFiles.useDiskHashes(diskHashes)
	workspace.useOpenSingleFiles(singleFiles.grantedPaths)
	workspace.useOfferedFiles(singleFiles.offeredPaths, singleFiles.takeOfferedFolder)
	recoveryStore, err := startupRecoveryStore()
	if err != nil {
		log.Fatal(err)
	}
	recovery := NewRecovery(recoveryStore, singleFiles, diskHashes)
	recovery.useWorkspace(workspace.openRoot, workspace.openGeneration)
	settings := NewSettings(settingsStore)
	settings.useCurrentRoot(workspace.openRoot)
	openedFiles := NewOpenedFiles()
	// The updater plugin adds the Sparkle-style update window and the menu
	// item; `mygo build` enables it only together with signed updates and a
	// writable install location. See docs/release.md.
	mygo.Use(updater.Plugin)
	// Images are served from the folder that is open when the page asks; the
	// handler reads the same replaceable workspace state as the rest of the app.
	if err := registerImageProtocol(workspace); err != nil {
		log.Fatal(err)
	}

	// A file opened from the system is offered to the page; only accepting it
	// grants the page access to that exact file. See docs/architecture.md.
	mygo.App.OnOpenFile(func(path string) {
		openedFiles.add(path)
		singleFiles.offer(path)
	})

	stateStore, err := startupWindowStateStore()
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.SetWindowStateStore(stateStore)

	menu := appMenu(mygo.IsDev())
	customizeEditMenu(menu)
	mygo.App.SetMenu(menu)

	mygo.Bind(
		NewApplication(mygo.App.Version()),
		workspace,
		assets,
		settings,
		workspaceTabs,
		singleFiles,
		recovery,
		openedFiles,
		NewNativeMenu(menu),
	)

	mygo.App.WhenReady(func() {
		window := mygo.NewWindow(mainWindowOptions())
		if page := window.Page(); page != nil {
			page.OnContextMenu(func(event *mygo.ContextMenuEvent) {
				trimPageContextMenu(event, mygo.IsDev())
			})
		}
		// A close first asks the page to save its pending edits; the page
		// calls Workspace.FinishClose when it is done.
		window.OnClose(func(event *mygo.CloseEvent) {
			if workspace.requestClose(window) {
				event.PreventDefault()
			}
		})
		// Native drops carry paths the page cannot see. Keep them in Go and
		// send the page a one-time token plus the drop position.
		window.OnFileDrop(newAssetDropHandler(assets, workspace, func(drop AssetDrop) error {
			return assetFileDrop.Emit(window, drop)
		}))
		blockImageNavigation(window.Page())
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
