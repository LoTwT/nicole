package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"

	"github.com/egoist/mygo"
)

const (
	// windowStateFile is MyGo's own window state file; keeping its name and
	// format preserves the size remembered by earlier versions.
	windowStateFile    = "window-state.json"
	mainWindowStateKey = "main"
)

// defaultWindowSize is used until a window size has been saved.
var defaultWindowSize = mygo.Size{Width: 1100, Height: 780}

// windowStateStore reads and writes window states in window-state.json under
// PathUserData, as MyGo's default store does. Unlike the default store, it
// ignores the saved position and centers the window on the display under the
// pointer at launch, keeping the saved size limited to that display's work
// area. MyGo still records and saves the window's real size and position.
type windowStateStore struct {
	filePath string
	workArea func() mygo.Rectangle
}

var _ mygo.WindowStateStore = (*windowStateStore)(nil)

// newWindowStateStore returns the store in PathUserData.
func newWindowStateStore() (*windowStateStore, error) {
	dir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		return nil, err
	}
	return &windowStateStore{
		filePath: filepath.Join(dir, windowStateFile),
		workArea: cursorScreenWorkArea,
	}, nil
}

// cursorScreenWorkArea is the usable area of the display with the pointer.
func cursorScreenWorkArea() mygo.Rectangle {
	display := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	if display.WorkArea.Width <= 0 || display.WorkArea.Height <= 0 {
		display = mygo.Screen.PrimaryDisplay()
	}
	return display.WorkArea
}

// LoadWindowStates centers the main window on the display with the pointer,
// with the saved size when there is one and the default size otherwise.
func (s *windowStateStore) LoadWindowStates() (map[string]mygo.WindowState, error) {
	states, err := readWindowStates(s.filePath)
	if err != nil {
		// A damaged state file loses the saved size, not the centering.
		states = nil
	}
	if states == nil {
		states = map[string]mygo.WindowState{}
	}
	states[mainWindowStateKey] = centerWindow(states[mainWindowStateKey], s.workArea(), defaultWindowSize)
	return states, nil
}

// SaveWindowStates writes the states in one rename, like the default store,
// retrying while Windows reports the file in use.
func (s *windowStateStore) SaveWindowStates(states map[string]mygo.WindowState) error {
	data, err := json.MarshalIndent(states, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomicAbs(s.filePath, data)
}

func writeFileAtomicAbs(target string, data []byte) (err error) {
	mode := fs.FileMode(0o644)
	preserveMode := false
	if info, statErr := os.Stat(target); statErr == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("window state: not a file: %q", target)
		}
		mode = info.Mode().Perm()
		preserveMode = true
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		return statErr
	}

	tempName, err := newTempFileName()
	if err != nil {
		return err
	}
	dir := filepath.Dir(target)
	tempPath := filepath.Join(dir, tempName)
	tmp, err := os.OpenFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = os.Remove(tempPath)
		}
	}()
	if _, err = tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if preserveMode {
		if err = os.Chmod(tempPath, mode); err != nil {
			return err
		}
	}
	if err = retryRename(func() error { return os.Rename(tempPath, target) }); err != nil {
		return err
	}
	return syncDirectoryPath(dir)
}

// syncDirectoryPath makes a rename durable. Windows has no directory fsync.
func syncDirectoryPath(dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func readWindowStates(filePath string) (map[string]mygo.WindowState, error) {
	data, err := os.ReadFile(filePath)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var states map[string]mygo.WindowState
	if err := json.Unmarshal(data, &states); err != nil {
		return nil, err
	}
	return states, nil
}

// centerWindow keeps the saved size, or the default size when none was
// saved, limits it to the work area, and centers it there. The saved
// position is deliberately not used: the window opens where the user is
// looking now, not on the display it was last on.
func centerWindow(saved mygo.WindowState, area mygo.Rectangle, fallback mygo.Size) mygo.WindowState {
	width, height := saved.Width, saved.Height
	if width <= 0 || height <= 0 {
		width, height = fallback.Width, fallback.Height
	}
	if area.Width > 0 {
		width = min(width, area.Width)
	}
	if area.Height > 0 {
		height = min(height, area.Height)
	}
	saved.Width, saved.Height = width, height
	saved.X = area.X + max(area.Width-width, 0)/2
	saved.Y = area.Y + max(area.Height-height, 0)/2
	return saved
}
