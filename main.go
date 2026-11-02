package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
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

func main() {
	if err := configureUserDataPath(); err != nil {
		log.Fatal(err)
	}
	if !acquireSingleInstanceLock() {
		return
	}
	installSecondInstanceFocus()
	workspace := NewWorkspace()
	settingsStore, err := startupSettingsStore()
	if err != nil {
		log.Fatal(err)
	}
	if !generatingClient() {
		applySavedTheme(settingsStore)
	}

	singleFiles := NewSingleFileService()
	openedFiles := NewOpenedFiles()
	// The updater plugin adds the Sparkle-style update window and the menu
	// item; `mygo build` enables it only together with signed updates and a
	// writable install location. See docs/release.md.
	mygo.Use(updater.Plugin)

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

	mygo.Bind(
		NewApplication(mygo.App.Version()),
		workspace,
		NewSettings(settingsStore),
		singleFiles,
		openedFiles,
		NativeMenu{},
	)
	menu := appMenu(mygo.IsDev())
	customizeEditMenu(menu)
	mygo.App.SetMenu(menu)

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
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
