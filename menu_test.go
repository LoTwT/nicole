package main

import (
	"runtime"
	"testing"

	"github.com/egoist/mygo"
)

func TestViewMenuHasNoReloadAndKeepsZoom(t *testing.T) {
	items := viewMenuItems(false)
	roles := make([]mygo.MenuRole, 0, len(items))
	for _, item := range items {
		roles = append(roles, item.Role)
	}
	for _, forbidden := range []mygo.MenuRole{mygo.RoleReload, mygo.RoleForceReload, mygo.RoleToggleDevTools} {
		for _, role := range roles {
			if role == forbidden {
				t.Errorf("release View menu contains %q", forbidden)
			}
		}
	}
	for _, required := range []mygo.MenuRole{mygo.RoleResetZoom, mygo.RoleZoomIn, mygo.RoleZoomOut, mygo.RoleToggleFullScreen} {
		found := false
		for _, role := range roles {
			if role == required {
				found = true
			}
		}
		if !found {
			t.Errorf("View menu is missing %q", required)
		}
	}

	devRoles := make([]mygo.MenuRole, 0, len(viewMenuItems(true)))
	for _, item := range viewMenuItems(true) {
		devRoles = append(devRoles, item.Role)
	}
	if len(devRoles) == 0 || devRoles[0] != mygo.RoleToggleDevTools {
		t.Errorf("development View menu starts with %q, want %q", devRoles, mygo.RoleToggleDevTools)
	}
}

func TestWindowMenuHasNoCloseShortcut(t *testing.T) {
	for _, item := range windowMenuItems() {
		if item.Role == mygo.RoleClose {
			t.Fatal("Window menu contains RoleClose, which binds Ctrl+W to closing the window")
		}
	}
	if runtime.GOOS == "darwin" {
		roles := make([]mygo.MenuRole, 0, len(windowMenuItems()))
		for _, item := range windowMenuItems() {
			roles = append(roles, item.Role)
		}
		for _, required := range []mygo.MenuRole{mygo.RoleMinimize, mygo.RoleZoom, mygo.RoleFront} {
			found := false
			for _, role := range roles {
				if role == required {
					found = true
				}
			}
			if !found {
				t.Errorf("Window menu is missing %q", required)
			}
		}
	}
}

func TestTrimPageContextMenu(t *testing.T) {
	menu := mygo.NewMenu([]*mygo.MenuItem{
		{ID: mygo.ContextMenuReload, Label: "Reload"},
		{ID: mygo.ContextMenuBack, Label: "Back"},
		{ID: mygo.ContextMenuForward, Label: "Forward"},
		{ID: mygo.ContextMenuInspect, Label: "Inspect"},
		{ID: mygo.ContextMenuUndo, Label: "Undo"},
	})
	trimPageContextMenu(&mygo.ContextMenuEvent{Menu: menu}, false)
	for _, id := range []string{mygo.ContextMenuReload, mygo.ContextMenuBack, mygo.ContextMenuForward, mygo.ContextMenuInspect} {
		if menu.ItemByID(id) != nil {
			t.Errorf("release context menu still has %q", id)
		}
	}
	if menu.ItemByID(mygo.ContextMenuUndo) == nil {
		t.Error("context menu lost Undo")
	}

	devMenu := mygo.NewMenu([]*mygo.MenuItem{
		{ID: mygo.ContextMenuInspect, Label: "Inspect"},
	})
	trimPageContextMenu(&mygo.ContextMenuEvent{Menu: devMenu}, true)
	if devMenu.ItemByID(mygo.ContextMenuInspect) == nil {
		t.Error("development context menu lost Inspect")
	}

	trimPageContextMenu(nil, false)
	trimPageContextMenu(&mygo.ContextMenuEvent{}, false)
}

func TestNativeMenuItemsValidate(t *testing.T) {
	items, err := nativeMenuItems([]NativeMenuItem{
		{ID: "new-file", Label: "新建文件", Accelerator: "CmdOrCtrl+N"},
		{Separator: true},
		{ID: "trash", Label: "移到废纸篓", Disabled: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || items[1].Type != mygo.MenuItemSeparator {
		t.Fatalf("items = %+v", items)
	}
	if items[0].ID != "new-file" || items[0].Accelerator != "CmdOrCtrl+N" {
		t.Errorf("first item = %+v", items[0])
	}
	if !items[2].Disabled {
		t.Error("disabled item is enabled")
	}

	for name, specs := range map[string][]NativeMenuItem{
		"empty":     nil,
		"no id":     {{Label: "x"}},
		"no label":  {{ID: "x"}},
		"duplicate": {{ID: "x", Label: "x"}, {ID: "x", Label: "y"}},
		"separator": {{Separator: true, ID: "x"}},
	} {
		if _, err := nativeMenuItems(specs); err == nil {
			t.Errorf("%s menu was accepted", name)
		}
	}

	tooMany := make([]NativeMenuItem, maxNativeMenuItems+1)
	for i := range tooMany {
		tooMany[i] = NativeMenuItem{ID: string(rune('a' + i)), Label: "x"}
	}
	if _, err := nativeMenuItems(tooMany); err == nil {
		t.Error("menu over the item limit was accepted")
	}
}

func TestMainWindowOptions(t *testing.T) {
	options := mainWindowOptions()
	if options.TitleBarStyle != mygo.TitleBarHidden {
		t.Errorf("TitleBarStyle = %q, want %q", options.TitleBarStyle, mygo.TitleBarHidden)
	}
	if options.TitleBarHeight != titleBarHeight {
		t.Errorf("TitleBarHeight = %d, want %d", options.TitleBarHeight, titleBarHeight)
	}
	if titleBarHeight != 40 {
		t.Errorf("titleBarHeight = %d, want 40", titleBarHeight)
	}
	if runtime.GOOS == "darwin" {
		if options.TrafficLightPosition == nil {
			t.Fatal("macOS window has no TrafficLightPosition")
		}
		if options.TrafficLightPosition.X != trafficLightX || options.TrafficLightPosition.Y != trafficLightY {
			t.Errorf("TrafficLightPosition = %+v", *options.TrafficLightPosition)
		}
	} else if options.TrafficLightPosition != nil {
		t.Error("TrafficLightPosition is set outside macOS")
	}
}

func TestCustomizeEditMenuKeepsUndoRedoOutOfNativeSelectors(t *testing.T) {
	menu := mygo.NewMenu([]*mygo.MenuItem{{Role: mygo.RoleEditMenu}})
	customizeEditMenu(menu)
	edit := menu.Items()[0]
	if edit.Role != mygo.RoleEditMenu {
		t.Fatalf("top item role = %q, want %q", edit.Role, mygo.RoleEditMenu)
	}
	var undo, redo, cut *mygo.MenuItem
	for _, item := range edit.Submenu {
		switch item.Role {
		case mygo.RoleCut:
			cut = item
		}
		if item.Label == "Undo" || item.Label == "撤销" {
			undo = item
		}
		if item.Label == "Redo" || item.Label == "重做" {
			redo = item
		}
	}
	// The labels come from MyGo's locale, so find by the roles before they
	// were cleared when the labels are unknown.
	for _, item := range edit.Submenu {
		if item.Click != nil && item.Role == "" && item.Accelerator == "CmdOrCtrl+Z" {
			undo = item
		}
		if item.Click != nil && item.Role == "" && (item.Accelerator == "Shift+CmdOrCtrl+Z" || item.Accelerator == "Ctrl+Y") {
			redo = item
		}
	}
	if undo == nil || redo == nil {
		t.Fatalf("Undo or Redo item not found: undo=%v redo=%v", undo, redo)
	}
	if undo.Role != "" || redo.Role != "" {
		t.Errorf("Undo/Redo roles = %q/%q, want page commands", undo.Role, redo.Role)
	}
	if cut == nil || cut.Role != mygo.RoleCut {
		t.Error("cut item lost its role")
	}
}
