package main

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

const maxNativeMenuItems = 64

// appMenu sets the standard menus and puts "Check for Updates…" in the app
// menu, where macOS users expect it. The updater disables the check itself in
// builds that cannot update, such as `mygo dev` and package-managed installs.
//
// The View and Window menus replace MyGo's defaults: reloading the page would
// lose editor state, and closing the window from Ctrl+W on Windows and Linux
// would bypass the tab close command. Zoom, full screen and the window
// controls remain. DevTools is a development-only item.
func appMenu(dev bool) *mygo.Menu {
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
		{Role: mygo.RoleViewMenu, Submenu: viewMenuItems(dev)},
		{Role: mygo.RoleWindowMenu, Submenu: windowMenuItems()},
	}
	return mygo.NewMenu(items)
}

// customizeEditMenu makes Undo and Redo send an edit command to the page
// instead of AppKit's undo: and redo: selectors. The selectors act on the web
// view's own undo manager, which knows nothing of CodeMirror's history. The
// page runs CodeMirror's history itself so it can ignore the command during an
// IME composition. The labels and accelerators stay the ones MyGo localizes.
func customizeEditMenu(menu *mygo.Menu) {
	if menu == nil {
		return
	}
	for _, top := range menu.Items() {
		if top.Role != mygo.RoleEditMenu {
			continue
		}
		for _, item := range top.Submenu {
			switch item.Role {
			case mygo.RoleUndo:
				item.Role = ""
				item.Click = pageCommand("undo")
			case mygo.RoleRedo:
				item.Role = ""
				item.Click = pageCommand("redo")
			}
		}
	}
}

// pageCommand asks the page to run an edit command in the window the menu
// belongs to. The page owns CodeMirror's history and can ignore the command
// while an IME composition is active; execCommand cannot make that decision.
func pageCommand(command string) func(*mygo.MenuItem, *mygo.Window) {
	return func(_ *mygo.MenuItem, win *mygo.Window) {
		if win == nil {
			win = mygo.FocusedWindow()
		}
		if win == nil {
			return
		}
		if page := win.Page(); page != nil {
			script := fmt.Sprintf(
				`window.dispatchEvent(new CustomEvent("nicole:edit-command", { detail: %q }))`,
				command,
			)
			_, _ = page.Eval(script)
		}
	}
}

func viewMenuItems(dev bool) []*mygo.MenuItem {
	items := make([]*mygo.MenuItem, 0, 7)
	if dev {
		items = append(items,
			&mygo.MenuItem{Role: mygo.RoleToggleDevTools},
			mygo.Separator(),
		)
	}
	return append(items,
		&mygo.MenuItem{Role: mygo.RoleResetZoom},
		&mygo.MenuItem{Role: mygo.RoleZoomIn},
		&mygo.MenuItem{Role: mygo.RoleZoomOut},
		mygo.Separator(),
		&mygo.MenuItem{Role: mygo.RoleToggleFullScreen},
	)
}

// windowMenuItems keeps the window controls but leaves out RoleClose:
// CmdOrCtrl+W belongs to the page's close-tab command, and a window close from
// the menu would skip saving.
func windowMenuItems() []*mygo.MenuItem {
	items := []*mygo.MenuItem{{Role: mygo.RoleMinimize}}
	if runtime.GOOS == "darwin" {
		items = append(items,
			&mygo.MenuItem{Role: mygo.RoleZoom},
			mygo.Separator(),
			&mygo.MenuItem{Role: mygo.RoleFront},
		)
	}
	return items
}

// trimPageContextMenu removes the web view's navigation and reload items, and
// its inspector outside development builds. The page adds no app items here:
// the file tree and tabs ask for their own native menus.
func trimPageContextMenu(event *mygo.ContextMenuEvent, dev bool) {
	if event == nil || event.Menu == nil {
		return
	}
	event.Menu.Remove(
		mygo.ContextMenuBack,
		mygo.ContextMenuForward,
		mygo.ContextMenuReload,
	)
	if !dev {
		event.Menu.Remove(mygo.ContextMenuInspect)
	}
}

// NativeMenuItem describes one entry of a native context menu the page asks
// for. IDs are returned to the page; separators need none.
type NativeMenuItem struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Accelerator string `json:"accelerator,omitempty"`
	Separator   bool   `json:"separator,omitempty"`
	Disabled    bool   `json:"disabled,omitempty"`
}

// NativeMenuRequest is a menu at a position relative to the page's top-left
// corner, in CSS pixels, as a context menu.
type NativeMenuRequest struct {
	X     int              `json:"x"`
	Y     int              `json:"y"`
	Items []NativeMenuItem `json:"items"`
}

// NativeMenu shows the native context menus the file tree and tabs assemble.
// The page chooses the labels and shortcut text; the menu itself, keyboard
// navigation and platform look come from the system.
type NativeMenu struct{}

// PopupNativeMenu shows the menu and returns the ID of the chosen item, or an
// empty string when the menu was dismissed. Disabled items and separators
// never produce an ID.
func (NativeMenu) PopupNativeMenu(ctx context.Context, request NativeMenuRequest) (string, error) {
	win := mygo.CallerWindow(ctx)
	if win == nil {
		return "", errors.New("menu: no window for the menu")
	}
	items, err := nativeMenuItems(request.Items)
	if err != nil {
		return "", err
	}
	menu := mygo.NewMenu(items)
	var mu sync.Mutex
	selected := ""
	for _, item := range menu.Items() {
		id := item.ID
		if id == "" {
			continue
		}
		item.Click = func(*mygo.MenuItem, *mygo.Window) {
			mu.Lock()
			selected = id
			mu.Unlock()
		}
	}
	x, y := max(request.X, 0), max(request.Y, 0)
	menu.PopupAt(win, x, y)
	mu.Lock()
	defer mu.Unlock()
	return selected, nil
}

// nativeMenuItems validates and turns the page's description into MyGo menu
// items. The Click handlers are filled in by PopupNativeMenu once the items
// exist.
func nativeMenuItems(specs []NativeMenuItem) ([]*mygo.MenuItem, error) {
	if len(specs) == 0 {
		return nil, errors.New("menu: no items")
	}
	if len(specs) > maxNativeMenuItems {
		return nil, fmt.Errorf("menu: at most %d items", maxNativeMenuItems)
	}
	seen := make(map[string]bool, len(specs))
	items := make([]*mygo.MenuItem, 0, len(specs))
	for _, spec := range specs {
		if spec.Separator {
			if spec.ID != "" || spec.Label != "" {
				return nil, errors.New("menu: a separator cannot have an ID or label")
			}
			items = append(items, mygo.Separator())
			continue
		}
		if spec.ID == "" {
			return nil, errors.New("menu: every item needs an ID")
		}
		if seen[spec.ID] {
			return nil, fmt.Errorf("menu: duplicate item ID %q", spec.ID)
		}
		if spec.Label == "" {
			return nil, fmt.Errorf("menu: item %q has no label", spec.ID)
		}
		seen[spec.ID] = true
		items = append(items, &mygo.MenuItem{
			ID:          spec.ID,
			Label:       spec.Label,
			Accelerator: spec.Accelerator,
			Disabled:    spec.Disabled,
		})
	}
	return items, nil
}
