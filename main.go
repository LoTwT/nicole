package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
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
	mygo.Bind(NewApplication(mygo.App.Version()))

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           "Nicole",
			Width:           1100,
			Height:          780,
			MinWidth:        640,
			MinHeight:       480,
			BackgroundColor: "light-dark(#faf8f4, #121019)", // the page's surface canvas
			StateKey:        "main",
			URL:             "/",
		})
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
