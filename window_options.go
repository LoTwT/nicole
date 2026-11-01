package main

import (
	"runtime"

	"github.com/egoist/mygo"
)

const (
	// titleBarHeight is the height of the page's own top bar. It is the same
	// in full screen: MyGo's --mygo-titlebar-height becomes 0px there, so the
	// page must not follow that variable.
	titleBarHeight = 40

	// macOS traffic lights: a 14px button centered in the 40px bar, with its
	// left edge on the sidebar's 16px inset.
	trafficLightX = 16
	trafficLightY = (titleBarHeight - 14) / 2
)

// mainWindowOptions describes the single window: the page draws the title bar
// itself, under the window controls, and the top bar is titleBarHeight tall.
func mainWindowOptions() mygo.WindowOptions {
	options := mygo.WindowOptions{
		Title:           "Nicole",
		Width:           defaultWindowSize.Width,
		Height:          defaultWindowSize.Height,
		MinWidth:        640,
		MinHeight:       480,
		BackgroundColor: "light-dark(#faf8f4, #121019)", // the page's surface canvas
		StateKey:        mainWindowStateKey,
		URL:             "/",
		TitleBarStyle:   mygo.TitleBarHidden,
		TitleBarHeight:  titleBarHeight,
	}
	if runtime.GOOS == "darwin" {
		options.TrafficLightPosition = &mygo.Point{X: trafficLightX, Y: trafficLightY}
	}
	return options
}
