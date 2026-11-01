package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	"github.com/egoist/mygo/plugins/watch"
)

// AppInfo describes the running app and the Go runtime behind it.
type AppInfo struct {
	Version   string `json:"version"`
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
}

// Application is bound to the frontend: `mygo generate` turns its methods into
// typed TypeScript functions under src/services/.
type Application struct {
	version string
}

// NewApplication returns the service with the version of the packaged app.
func NewApplication(version string) Application {
	return Application{version: version}
}

// Info returns the app version and the runtime that serves the page.
func (app Application) Info() AppInfo {
	return AppInfo{
		Version:   app.version,
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		GoVersion: runtime.Version(),
	}
}

// appMenu sets the standard menus and puts "Check for Updates…" in the app
// menu, where macOS users expect it. The updater disables the check itself in
// builds that cannot update, such as `mygo dev` and package-managed installs.
func appMenu() *mygo.Menu {
	appItems := []*mygo.MenuItem{
		{Role: mygo.RoleAbout},
		updater.MenuItem(),
		mygo.Separator(),
	}
	if runtime.GOOS == "darwin" {
		appItems = append(appItems,
			&mygo.MenuItem{Role: mygo.RoleHide},
			&mygo.MenuItem{Role: mygo.RoleHideOthers},
			&mygo.MenuItem{Role: mygo.RoleUnhide},
			mygo.Separator(),
		)
	}
	appItems = append(appItems, &mygo.MenuItem{Role: mygo.RoleQuit})

	items := []*mygo.MenuItem{
		{Label: "Nicole", Submenu: appItems},
		{Role: mygo.RoleEditMenu},
	}
	if runtime.GOOS == "darwin" {
		items = append(items, &mygo.MenuItem{Role: mygo.RoleViewMenu})
	}
	items = append(items, &mygo.MenuItem{Role: mygo.RoleWindowMenu})
	return mygo.NewMenu(items)
}

func main() {
	workspace := NewWorkspace()
	assets := NewAssets(workspace)

	// The updater plugin adds the Sparkle-style update window and the menu
	// item; `mygo build` enables it only together with signed updates and a
	// writable install location. See docs/release.md.
	// The watch plugin is registered once, before the window exists; its
	// Resolve callback grants whatever folder is open at watch time.
	mygo.Use(updater.Plugin, watch.New(watch.Options{Resolve: workspace.watchRoot}))
	// Images are served from the folder that is open when the page asks; the
	// handler reads the same replaceable workspace state as the watch plugin.
	if err := registerImageProtocol(workspace); err != nil {
		log.Fatal(err)
	}

	stateStore, err := newWindowStateStore()
	if err != nil {
		log.Fatal(err)
	}
	mygo.App.SetWindowStateStore(stateStore)

	mygo.Bind(NewApplication(mygo.App.Version()), workspace, assets)
	mygo.App.SetMenu(appMenu())

	mygo.App.WhenReady(func() {
		window := mygo.NewWindow(mygo.WindowOptions{
			Title:           "Nicole",
			Width:           defaultWindowSize.Width,
			Height:          defaultWindowSize.Height,
			MinWidth:        640,
			MinHeight:       480,
			BackgroundColor: "light-dark(#faf8f4, #121019)", // the page's surface canvas
			StateKey:        mainWindowStateKey,
			URL:             "/",
		})
		// A close first asks the page to save its pending edits; the page
		// calls Workspace.FinishClose when it is done.
		window.OnClose(func(event *mygo.CloseEvent) {
			if workspace.requestClose(window) {
				event.PreventDefault()
			}
		})
		// Native drops carry paths the page cannot see. Keep them in Go and
		// send the page a one-time token plus the drop position.
		window.OnFileDrop(newAssetDropHandler(assets, func(drop AssetDrop) error {
			return assetFileDrop.Emit(window, drop)
		}))
		blockImageNavigation(window.Page())
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
