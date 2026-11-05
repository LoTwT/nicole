package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestCloseWorkspaceClearsRootAndDependentServices(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("# A\n"))
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	tabsStore := newTabsStoreIn(filepath.Join(t.TempDir(), tabsFileName))
	if err := tabsStore.save(root, StoredTabs{
		Tabs:   []StoredTab{{Kind: tabKindMarkdown, Path: "a.md"}},
		Active: "a.md",
	}); err != nil {
		t.Fatal(err)
	}
	workspace := NewWorkspace()
	hashes := newDiskHashes()
	workspace.useDiskHashes(hashes)
	workspace.useSettings(store)
	workspace.lastPicked = root
	if _, err := workspace.OpenFolder(root); err != nil {
		t.Fatal(err)
	}
	oldGeneration := currentGeneration(workspace)
	if _, err := workspace.ReadFile("a.md"); err != nil {
		t.Fatal(err)
	}
	if _, ok := hashes.lookup(filepath.Join(root, "a.md")); !ok {
		t.Fatal("reading the file did not record its disk hash")
	}

	if err := workspace.CloseWorkspace(); err != nil {
		t.Fatal(err)
	}
	if got := workspace.openRoot(); got != "" {
		t.Errorf("openRoot() after close = %q, want empty", got)
	}
	if got := currentGeneration(workspace); got <= oldGeneration {
		t.Errorf("generation after close = %d, want greater than %d", got, oldGeneration)
	}
	if _, ok := hashes.lookup(filepath.Join(root, "a.md")); ok {
		t.Error("closing the workspace kept the old root's disk hash")
	}

	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if !settings.WorkspaceClosed {
		t.Error("closing the workspace did not set WorkspaceClosed")
	}
	if len(settings.RecentFolders) == 0 || settings.RecentFolders[0] != root {
		t.Errorf("recent folders after close = %q, want %q first", settings.RecentFolders, root)
	}

	for name, call := range map[string]func() error{
		"ListFiles":          func() error { _, err := workspace.ListFiles(); return err },
		"ReadFile":           func() error { _, err := workspace.ReadFile("a.md"); return err },
		"WriteFile":          func() error { return workspace.WriteFile("a.md", "x", oldGeneration) },
		"ListDirectory":      func() error { _, err := workspace.ListDirectory("."); return err },
		"CreateFile":         func() error { _, err := workspace.CreateFile(".", "new", oldGeneration); return err },
		"CreateFolder":       func() error { _, err := workspace.CreateFolder(".", "new", oldGeneration); return err },
		"RenameEntry":        func() error { _, err := workspace.RenameEntry("a.md", "b.md", oldGeneration); return err },
		"TrashEntry":         func() error { return workspace.TrashEntry("a.md", oldGeneration) },
		"OpenWithDefaultApp": func() error { return workspace.OpenWithDefaultApp(context.Background(), "a.md", oldGeneration) },
		"RevealEntry":        func() error { return workspace.RevealEntry("a.md", oldGeneration) },
		"Watch":              func() error { return workspace.Watch(context.Background(), oldGeneration, nil) },
	} {
		if err := call(); !errors.Is(err, errNoWorkspace) {
			t.Errorf("%s after close = %v, want errNoWorkspace", name, err)
		}
	}

	assets := NewAssets(workspace)
	if _, err := assets.PasteImage("a.md", oldGeneration); !errors.Is(err, errNoWorkspace) {
		t.Errorf("PasteImage after close = %v, want errNoWorkspace", err)
	}
	if _, err := assets.ImportImages("a.md", oldGeneration, "token"); !errors.Is(err, errNoWorkspace) {
		t.Errorf("ImportImages after close = %v, want errNoWorkspace", err)
	}

	response := imageRequest(workspace.state, http.MethodGet, imageURL(oldGeneration, "a.png"))
	if response.Code != http.StatusNotFound {
		t.Errorf("image request after close = %d, want 404", response.Code)
	}

	tabs := NewWorkspaceTabs(newTabsStoreIn(filepath.Join(t.TempDir(), tabsFileName)))
	tabs.useCurrentRoot(workspace.openRoot)
	if _, err := tabs.Get(root); !errors.Is(err, errTabsRootNotCurrent) {
		t.Errorf("WorkspaceTabs.Get after close = %v, want errTabsRootNotCurrent", err)
	}
	if err := tabs.Save(root, nil, "", nil); !errors.Is(err, errTabsRootNotCurrent) {
		t.Errorf("WorkspaceTabs.Save after close = %v, want errTabsRootNotCurrent", err)
	}

	settingsService := NewSettings(store)
	settingsService.useCurrentRoot(workspace.openRoot)
	if err := settingsService.AddRecentFolder(root); !errors.Is(err, errRecentFolderNotCurrent) {
		t.Errorf("AddRecentFolder after close = %v, want errRecentFolderNotCurrent", err)
	}

	stored, err := tabsStore.get(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Tabs) != 1 || stored.Tabs[0].Path != "a.md" {
		t.Errorf("tabs.json after close = %+v, want the remembered layout", stored)
	}
}

func TestClosingKeepsSingleFileHashesAndAReopenClearsTheFlag(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	singlePath := filepath.Join(root, "single.md")
	mustWriteFile(t, singlePath, []byte("# Single\n"))
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	workspace := NewWorkspace()
	hashes := newDiskHashes()
	workspace.useDiskHashes(hashes)
	workspace.useSettings(store)
	singles := NewSingleFileService()
	singles.useDiskHashes(hashes)
	file, err := singles.grant(singlePath)
	if err != nil {
		t.Fatal(err)
	}
	workspace.useOpenSingleFiles(singles.grantedPaths)
	workspace.lastPicked = root
	if _, err := workspace.OpenFolder(root); err != nil {
		t.Fatal(err)
	}
	if _, err := singles.ReadSingleFile(file.Path); err != nil {
		t.Fatal(err)
	}
	if err := workspace.CloseWorkspace(); err != nil {
		t.Fatal(err)
	}
	if _, ok := hashes.lookup(file.Path); !ok {
		t.Error("closing the workspace dropped an open single file's hash")
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if !settings.WorkspaceClosed {
		t.Fatal("WorkspaceClosed was not set")
	}

	// The closed root remains a recent folder, so it can be opened again; a
	// successful open clears the start-page flag.
	folder, err := workspace.OpenFolder(root)
	if err != nil {
		t.Fatalf("OpenFolder(recent) after close = %v, want success", err)
	}
	if folder.Generation == 0 {
		t.Error("reopened workspace has no generation")
	}
	settings, err = store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceClosed {
		t.Error("opening a folder did not clear WorkspaceClosed")
	}
}

func TestCloseWithoutWorkspaceIsRejected(t *testing.T) {
	if err := NewWorkspace().CloseWorkspace(); !errors.Is(err, errNoWorkspace) {
		t.Fatalf("CloseWorkspace() = %v, want errNoWorkspace", err)
	}
}

func TestSettingsWorkspaceClosedField(t *testing.T) {
	store, dir := newTestSettings(t)
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceClosed {
		t.Error("default WorkspaceClosed is true")
	}
	if err := store.markWorkspaceClosed(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, settingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["workspaceClosed"] != true {
		t.Errorf("settings.json workspaceClosed = %v, want true", stored["workspaceClosed"])
	}
	settings, err = store.get()
	if err != nil || !settings.WorkspaceClosed {
		t.Fatalf("Get() after mark = %+v, %v", settings, err)
	}
	if err := store.clearWorkspaceClosed(); err != nil {
		t.Fatal(err)
	}
	data, err = os.ReadFile(filepath.Join(dir, settingsFileName))
	if err != nil {
		t.Fatal(err)
	}
	stored = nil
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if _, ok := stored["workspaceClosed"]; ok {
		t.Error("clearing WorkspaceClosed left the field in settings.json")
	}
}

func TestFolderDropTokenIsOneTimeExpiringAndSingleFolder(t *testing.T) {
	workspace := NewWorkspace()
	now := time.Now()
	workspace.now = func() time.Time { return now }
	folder := resolveTestPath(t, t.TempDir())
	other := resolveTestPath(t, t.TempDir())
	file := filepath.Join(folder, "note.md")
	mustWriteFile(t, file, []byte("# note\n"))

	if _, ok := workspace.acceptFolderDrop([]string{folder, other}); ok {
		t.Error("a multi-item drop got a folder token")
	}
	if _, ok := workspace.acceptFolderDrop([]string{file}); ok {
		t.Error("a file drop got a folder token")
	}
	if _, ok := workspace.acceptFolderDrop([]string{filepath.Join(folder, "missing")}); ok {
		t.Error("a missing path got a folder token")
	}
	if runtime.GOOS != "windows" {
		link := filepath.Join(t.TempDir(), "link")
		if err := os.Symlink(folder, link); err != nil {
			t.Fatal(err)
		}
		if _, ok := workspace.acceptFolderDrop([]string{link}); ok {
			t.Error("a symlink to a folder got a folder token")
		}
	}

	token, ok := workspace.acceptFolderDrop([]string{folder})
	if !ok {
		t.Fatal("single folder drop got no token")
	}
	if _, err := workspace.OpenDroppedFolder(token); err != nil {
		t.Fatal(err)
	}
	if got := workspace.openRoot(); got != folder {
		t.Errorf("OpenDroppedFolder root = %q, want %q", got, folder)
	}
	if _, err := workspace.OpenDroppedFolder(token); !errors.Is(err, errFolderDrop) {
		t.Errorf("second OpenDroppedFolder = %v, want errFolderDrop", err)
	}
	if _, err := workspace.OpenFolder(other); !errors.Is(err, errFolderNotChosen) {
		t.Errorf("OpenFolder(arbitrary) after a drop = %v, want errFolderNotChosen", err)
	}

	token, ok = workspace.acceptFolderDrop([]string{other})
	if !ok {
		t.Fatal("second folder drop got no token")
	}
	now = now.Add(dropTokenLifetime + time.Second)
	if _, err := workspace.OpenDroppedFolder(token); !errors.Is(err, errFolderDrop) {
		t.Errorf("expired OpenDroppedFolder = %v, want errFolderDrop", err)
	}
}

func TestFailedFolderDropOpenConsumesTheToken(t *testing.T) {
	workspace := NewWorkspace()
	folder := resolveTestPath(t, t.TempDir())
	token, ok := workspace.acceptFolderDrop([]string{folder})
	if !ok {
		t.Fatal("folder drop got no token")
	}
	if err := os.RemoveAll(folder); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.OpenDroppedFolder(token); err == nil || errors.Is(err, errFolderDrop) {
		t.Fatalf("OpenDroppedFolder after removal = %v, want a path error", err)
	}
	if _, err := workspace.OpenDroppedFolder(token); !errors.Is(err, errFolderDrop) {
		t.Errorf("reusing the consumed token = %v, want errFolderDrop", err)
	}
	if got := workspace.openRoot(); got != "" {
		t.Errorf("failed drop open left root %q", got)
	}
}

func TestFolderDropOpenClearsWorkspaceClosed(t *testing.T) {
	folder := resolveTestPath(t, t.TempDir())
	store := newSettingsStoreIn(filepath.Join(t.TempDir(), settingsFileName))
	if err := store.markWorkspaceClosed(); err != nil {
		t.Fatal(err)
	}
	workspace := NewWorkspace()
	workspace.useSettings(store)
	token, ok := workspace.acceptFolderDrop([]string{folder})
	if !ok {
		t.Fatal("folder drop got no token")
	}
	if _, err := workspace.OpenDroppedFolder(token); err != nil {
		t.Fatal(err)
	}
	settings, err := store.get()
	if err != nil {
		t.Fatal(err)
	}
	if settings.WorkspaceClosed {
		t.Error("OpenDroppedFolder did not clear WorkspaceClosed")
	}
}

func TestAssetDropHandlerAddsAFolderTokenOnlyForOneFolder(t *testing.T) {
	workspace := NewWorkspace()
	assets := NewAssets(workspace)
	folder := resolveTestPath(t, t.TempDir())
	file := filepath.Join(folder, "note.md")
	mustWriteFile(t, file, []byte("# note\n"))

	var emitted AssetDrop
	handler := newAssetDropHandler(assets, workspace, func(drop AssetDrop) error {
		emitted = drop
		return nil
	})
	handler(&mygo.FileDropEvent{Paths: []string{folder}})
	if emitted.Token == "" || emitted.FolderToken == "" {
		t.Errorf("folder drop event = %+v, want both tokens", emitted)
	}
	emitted = AssetDrop{}
	handler(&mygo.FileDropEvent{Paths: []string{folder, file}})
	if emitted.Token == "" {
		t.Error("multi-item drop emitted no image token")
	}
	if emitted.FolderToken != "" {
		t.Error("multi-item drop got a folder token")
	}
}

func TestRecoveryListWithoutRootShowsOnlySingleFileCopies(t *testing.T) {
	root := resolveTestPath(t, t.TempDir())
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("# A\n"))
	workspace, singles, recovery := newTestRecovery(t, root)
	generation := currentGeneration(workspace)
	if _, err := workspace.ReadFile("a.md"); err != nil {
		t.Fatal(err)
	}
	saveTestCopy(t, recovery, RecoveryCopy{
		Kind:       recoveryKindWorkspace,
		Root:       root,
		Path:       "a.md",
		LineEnding: "\n",
		Text:       "# A\nedited\n",
	}, generation)

	singlePath := filepath.Join(root, "single.md")
	mustWriteFile(t, singlePath, []byte("# Single\n"))
	file, err := singles.grant(singlePath)
	if err != nil {
		t.Fatal(err)
	}
	saveTestCopy(t, recovery, RecoveryCopy{
		Kind:       recoveryKindSingle,
		Path:       file.Path,
		LineEnding: "\n",
		Text:       "# Single\nedited\n",
	}, 0)

	if err := workspace.CloseWorkspace(); err != nil {
		t.Fatal(err)
	}
	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].Kind != recoveryKindSingle {
		t.Errorf("List after close = %+v, want one single-file copy", listing.Items)
	}
	if listing.OtherFolders != 1 {
		t.Errorf("OtherFolders after close = %d, want 1", listing.OtherFolders)
	}
	if _, err := recovery.Save(RecoveryCopy{
		Kind:       recoveryKindWorkspace,
		Root:       root,
		Path:       "a.md",
		LineEnding: "\n",
		Text:       "x",
	}, generation); !errors.Is(err, errRecoveryGeneration) {
		t.Errorf("workspace Save after close = %v, want errRecoveryGeneration", err)
	}
}
