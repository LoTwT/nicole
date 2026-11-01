package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo"
)

func TestCenterWindow(t *testing.T) {
	fallback := mygo.Size{Width: 1100, Height: 780}
	workArea := mygo.Rectangle{X: 100, Y: 50, Width: 1440, Height: 900}

	tests := []struct {
		name  string
		saved mygo.WindowState
		want  mygo.WindowState
	}{
		{
			name: "default size when nothing was saved",
			want: mygo.WindowState{X: 270, Y: 110, Width: 1100, Height: 780},
		},
		{
			name:  "saved size is kept and centered",
			saved: mygo.WindowState{X: -900, Y: 700, Width: 800, Height: 600},
			want:  mygo.WindowState{X: 420, Y: 200, Width: 800, Height: 600},
		},
		{
			name:  "size larger than the display is limited to it",
			saved: mygo.WindowState{X: 0, Y: 0, Width: 3000, Height: 2000},
			want:  mygo.WindowState{X: 100, Y: 50, Width: 1440, Height: 900},
		},
		{
			name:  "maximized state survives centering",
			saved: mygo.WindowState{Width: 900, Height: 700, Maximized: true},
			want:  mygo.WindowState{X: 370, Y: 150, Width: 900, Height: 700, Maximized: true},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := centerWindow(test.saved, workArea, fallback); got != test.want {
				t.Errorf("centerWindow() = %+v, want %+v", got, test.want)
			}
		})
	}
}

func TestWindowStateStoreLoad(t *testing.T) {
	workArea := mygo.Rectangle{X: 100, Y: 50, Width: 1440, Height: 900}
	store := &windowStateStore{
		filePath: filepath.Join(t.TempDir(), windowStateFile),
		workArea: func() mygo.Rectangle { return workArea },
	}

	states, err := store.LoadWindowStates()
	if err != nil {
		t.Fatal(err)
	}
	if got := states[mainWindowStateKey]; got != (mygo.WindowState{X: 270, Y: 110, Width: 1100, Height: 780}) {
		t.Errorf("without a state file: %+v", got)
	}

	saved := map[string]mygo.WindowState{
		mainWindowStateKey: {X: -1200, Y: 1400, Width: 900, Height: 700, Maximized: true},
		"other":            {X: 10, Y: 20, Width: 300, Height: 200},
	}
	data, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.filePath, data, 0o644); err != nil {
		t.Fatal(err)
	}

	states, err = store.LoadWindowStates()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := states[mainWindowStateKey], (mygo.WindowState{X: 370, Y: 150, Width: 900, Height: 700, Maximized: true}); got != want {
		t.Errorf("main = %+v, want %+v", got, want)
	}
	if got, want := states["other"], (mygo.WindowState{X: 10, Y: 20, Width: 300, Height: 200}); got != want {
		t.Errorf("other = %+v, want %+v", got, want)
	}

	if err := os.WriteFile(store.filePath, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	states, err = store.LoadWindowStates()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := states[mainWindowStateKey], (mygo.WindowState{X: 270, Y: 110, Width: 1100, Height: 780}); got != want {
		t.Errorf("damaged state file: %+v, want %+v", got, want)
	}
}

func TestWindowStateStoreSaveAndReload(t *testing.T) {
	workArea := mygo.Rectangle{X: 0, Y: 0, Width: 1600, Height: 1000}
	store := &windowStateStore{
		filePath: filepath.Join(t.TempDir(), windowStateFile),
		workArea: func() mygo.Rectangle { return workArea },
	}

	saved := map[string]mygo.WindowState{
		mainWindowStateKey: {X: 2000, Y: 2000, Width: 1200, Height: 800},
	}
	if err := store.SaveWindowStates(saved); err != nil {
		t.Fatal(err)
	}

	states, err := store.LoadWindowStates()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := states[mainWindowStateKey], (mygo.WindowState{X: 200, Y: 100, Width: 1200, Height: 800}); got != want {
		t.Errorf("reloaded main = %+v, want %+v", got, want)
	}

	onDisk, err := readWindowStates(store.filePath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := onDisk[mainWindowStateKey], saved[mainWindowStateKey]; got != want {
		t.Errorf("saved main = %+v, want the captured state %+v", got, want)
	}
}
