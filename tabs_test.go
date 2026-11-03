package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func newTestTabs(t *testing.T) (*WorkspaceTabs, string, string) {
	t.Helper()
	dir := t.TempDir()
	root := filepath.Join(dir, "notes")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	store := newTabsStoreIn(filepath.Join(dir, tabsFileName))
	service := NewWorkspaceTabs(store)
	service.useCurrentRoot(func() string { return root })
	return service, root, filepath.Join(dir, tabsFileName)
}

func jsonEqual(left, right []byte) bool {
	var leftValue, rightValue any
	if err := json.Unmarshal(left, &leftValue); err != nil {
		return false
	}
	if err := json.Unmarshal(right, &rightValue); err != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func TestTabsRoundTrip(t *testing.T) {
	service, root, filePath := newTestTabs(t)
	selection := json.RawMessage(`{"ranges":[{"anchor":3,"head":7}],"main":0}`)
	tabs := []StoredTab{
		{
			Kind:            tabKindMarkdown,
			Path:            "essay/README.md",
			Selection:       selection,
			ScrollTopLine:   12,
			ScrollTopOffset: 6.5,
		},
		{Kind: tabKindPreview, Path: "assets/cover.png", Size: 2048},
	}
	if err := service.Save(root, tabs, "assets/cover.png", []string{"essay/README.md"}); err != nil {
		t.Fatal(err)
	}

	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Active != "assets/cover.png" {
		t.Errorf("Active = %q, want the preview tab", got.Active)
	}
	if len(got.Tabs) != 2 {
		t.Fatalf("len(Tabs) = %d, want 2", len(got.Tabs))
	}
	if !jsonEqual(got.Tabs[0].Selection, selection) {
		t.Errorf("Selection = %s, want %s", got.Tabs[0].Selection, selection)
	}
	if got.Tabs[0].ScrollTopLine != 12 || got.Tabs[0].ScrollTopOffset != 6.5 {
		t.Errorf("scroll state = %d/%v, want 12/6.5", got.Tabs[0].ScrollTopLine, got.Tabs[0].ScrollTopOffset)
	}
	if got.Tabs[1].Size != 2048 {
		t.Errorf("preview size = %d, want 2048", got.Tabs[1].Size)
	}
	if !reflect.DeepEqual(got.RecentFiles, []string{"essay/README.md"}) {
		t.Errorf("RecentFiles = %v, want the saved path", got.RecentFiles)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Errorf("tabs file does not end with a newline: %q", data)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("tabs file is not valid JSON: %v", err)
	}
}

func TestTabsRejectsOtherRoots(t *testing.T) {
	service, root, _ := newTestTabs(t)
	other := filepath.Join(filepath.Dir(root), "other")

	if _, err := service.Get(other); !errors.Is(err, errTabsRootNotCurrent) {
		t.Errorf("Get(other) = %v, want errTabsRootNotCurrent", err)
	}
	if err := service.Save(other, nil, "", nil); !errors.Is(err, errTabsRootNotCurrent) {
		t.Errorf("Save(other) = %v, want errTabsRootNotCurrent", err)
	}
	if _, err := service.Get("relative"); !errors.Is(err, errInvalidTabsRootPath) {
		t.Errorf("Get(relative) = %v, want errInvalidTabsRootPath", err)
	}

	withoutCurrent := NewWorkspaceTabs(newTabsStoreIn(filepath.Join(t.TempDir(), tabsFileName)))
	if _, err := withoutCurrent.Get(root); !errors.Is(err, errTabsRootNotCurrent) {
		t.Errorf("Get without current root = %v, want errTabsRootNotCurrent", err)
	}
}

func TestTabsEmptyLayoutDeletesRecord(t *testing.T) {
	service, root, filePath := newTestTabs(t)
	if err := service.Save(root, []StoredTab{{Kind: tabKindMarkdown, Path: "a.md"}}, "a.md", nil); err != nil {
		t.Fatal(err)
	}
	if err := service.Save(root, nil, "", nil); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tabs) != 0 || got.Active != "" {
		t.Errorf("after empty save, layout = %+v, want empty", got)
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), root) {
		t.Errorf("empty save kept the root in tabs.json: %s", data)
	}
}

func TestTabsSanitizesLayout(t *testing.T) {
	service, root, _ := newTestTabs(t)
	input := []StoredTab{
		{Kind: "unknown", Path: "x.md"},
		{Kind: tabKindMarkdown, Path: "../outside.md"},
		{Kind: tabKindMarkdown, Path: "/absolute.md"},
		{Kind: tabKindMarkdown, Path: `dir\file.md`},
		{Kind: tabKindMarkdown, Path: "dir:file.md"},
		{Kind: tabKindMarkdown, Path: "."},
		{Kind: tabKindMarkdown, Path: "a.md", Selection: json.RawMessage(`{not json`)},
		{Kind: tabKindMarkdown, Path: "a.md"},
		{Kind: tabKindPreview, Path: "cover.png", Size: -2, ScrollTopLine: -9},
	}
	if err := service.Save(root, input, "missing.md", nil); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Active != "" {
		t.Errorf("Active = %q, want empty for an unknown active path", got.Active)
	}
	if len(got.Tabs) != 2 {
		t.Fatalf("len(Tabs) = %d, want 2: %+v", len(got.Tabs), got.Tabs)
	}
	if got.Tabs[0].Path != "a.md" || got.Tabs[1].Path != "cover.png" {
		t.Errorf("kept tabs = %+v", got.Tabs)
	}
	if got.Tabs[0].Selection != nil {
		t.Errorf("invalid JSON selection was kept: %+v", got.Tabs[0])
	}
	if got.Tabs[1].Size != 0 || got.Tabs[1].ScrollTopLine != 0 {
		t.Errorf("negative preview values were kept: %+v", got.Tabs[1])
	}
}

func TestTabsSanitizesRecentFiles(t *testing.T) {
	service, root, filePath := newTestTabs(t)
	recent := []string{
		"a.md",
		"../outside.md",
		"/absolute.md",
		`dir\file.md`,
		"dir/./file.md",
		"a.md",
	}
	for index := 0; index < maxRecentFiles+3; index++ {
		recent = append(recent, "note-"+string(rune('a'+index))+".md")
	}
	if err := service.Save(root, nil, "", recent); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Tabs) != 0 {
		t.Errorf("Tabs = %v, want none", got.Tabs)
	}
	if len(got.RecentFiles) != maxRecentFiles {
		t.Fatalf("len(RecentFiles) = %d, want %d", len(got.RecentFiles), maxRecentFiles)
	}
	if got.RecentFiles[0] != "a.md" || got.RecentFiles[1] != "note-a.md" {
		t.Errorf("RecentFiles = %v, want the valid paths in input order", got.RecentFiles)
	}
	for _, path := range got.RecentFiles {
		if !validStoredTabPath(path) {
			t.Errorf("invalid recent path survived: %q", path)
		}
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "recentFiles") {
		t.Errorf("tabs.json does not contain recentFiles: %s", data)
	}
}

func TestTabsDropsOversizedSnapshots(t *testing.T) {
	service, root, _ := newTestTabs(t)
	bigSelection := json.RawMessage(`"` + strings.Repeat("x", maxSelectionBytes) + `"`)
	if err := service.Save(root, []StoredTab{{
		Kind:      tabKindMarkdown,
		Path:      "big.md",
		Selection: bigSelection,
	}}, "big.md", nil); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tabs[0].Selection != nil {
		t.Errorf("oversized selection was kept")
	}
}

func TestTabsBacksUpCorruptFile(t *testing.T) {
	service, root, filePath := newTestTabs(t)
	if err := os.WriteFile(filePath, []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatalf("Get on corrupt file: %v", err)
	}
	if len(got.Tabs) != 0 {
		t.Errorf("corrupt read returned tabs: %+v", got.Tabs)
	}
	matches, err := filepath.Glob(filePath + ".corrupt-*")
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 1 {
		t.Fatalf("corrupt backups = %v, want one", matches)
	}
	if data, err := os.ReadFile(matches[0]); err != nil || string(data) != "{broken" {
		t.Errorf("backup content = %q, %v", data, err)
	}
	if err := service.Save(root, []StoredTab{{Kind: tabKindMarkdown, Path: "a.md"}}, "a.md", nil); err != nil {
		t.Fatal(err)
	}
}

func TestTabsConcurrentSaves(t *testing.T) {
	service, root, _ := newTestTabs(t)
	var group sync.WaitGroup
	for index := 0; index < 20; index++ {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			path := "note-" + string(rune('a'+index)) + ".md"
			if err := service.Save(root, []StoredTab{{Kind: tabKindMarkdown, Path: path}}, path, nil); err != nil {
				t.Errorf("Save(%d): %v", index, err)
			}
		}(index)
	}
	group.Wait()
	if _, err := service.Get(root); err != nil {
		t.Fatalf("Get after concurrent saves: %v", err)
	}
}

func TestTabsNullTabsReadAsEmpty(t *testing.T) {
	service, root, filePath := newTestTabs(t)
	data := `{"roots":{"` + root + `":{"tabs":null,"active":"a.md","recentFiles":["a.md"]}}}` + "\n"
	if err := os.WriteFile(filePath, []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := service.Get(root)
	if err != nil {
		t.Fatal(err)
	}
	if got.Tabs == nil || len(got.Tabs) != 0 {
		t.Errorf("Tabs = %#v, want a non-nil empty slice", got.Tabs)
	}
	if !reflect.DeepEqual(got.RecentFiles, []string{"a.md"}) {
		t.Errorf("RecentFiles = %v, want the stored path", got.RecentFiles)
	}
}
