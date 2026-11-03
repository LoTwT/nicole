package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestRecovery(t *testing.T, root string) (*Workspace, *SingleFileService, *Recovery) {
	t.Helper()
	hashes := newDiskHashes()
	workspace := NewWorkspace()
	workspace.useDiskHashes(hashes)
	if root != "" {
		if _, err := workspace.open(root); err != nil {
			t.Fatal(err)
		}
	}
	singleFiles := NewSingleFileService()
	singleFiles.useDiskHashes(hashes)
	store := newRecoveryStoreIn(filepath.Join(t.TempDir(), recoveryDirName))
	recovery := NewRecovery(store, singleFiles, hashes)
	recovery.useWorkspace(workspace.openRoot, workspace.openGeneration)
	return workspace, singleFiles, recovery
}

func saveTestCopy(t *testing.T, recovery *Recovery, copy RecoveryCopy, generation int) string {
	t.Helper()
	id, err := recovery.Save(copy, generation)
	if err != nil {
		t.Fatalf("Save(%+v): %v", copy, err)
	}
	return id
}

func TestRecoveryWorkspaceDiskStates(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	filePath := filepath.Join(root, "notes", "a.md")
	mustWriteFile(t, filePath, []byte("disk version\n"))
	if _, err := workspace.ReadFile("notes/a.md"); err != nil {
		t.Fatal(err)
	}
	generation := workspace.openGeneration()

	copy := RecoveryCopy{
		Kind:       recoveryKindWorkspace,
		Root:       root,
		Path:       "notes/a.md",
		LineEnding: "\n",
		Text:       "disk version\nrestored text\n",
	}
	id := saveTestCopy(t, recovery, copy, generation)

	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 {
		t.Fatalf("List() = %+v, want one item", listing)
	}
	item := listing.Items[0]
	if item.ID != id || item.Name != "a.md" || item.Path != "notes/a.md" {
		t.Errorf("item = %+v", item)
	}
	if item.DiskState != recoveryStateSame {
		t.Errorf("DiskState = %q, want same", item.DiskState)
	}
	if item.DiskText != "disk version\n" {
		t.Errorf("DiskText = %q", item.DiskText)
	}
	if !item.Restorable {
		t.Errorf("Restorable = false, reason %q", item.Reason)
	}

	// A change made outside Nicole after the copy must be detected from the
	// recorded hash, without the page comparing files.
	mustWriteFile(t, filePath, []byte("changed outside\n"))
	listing, err = recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if got := listing.Items[0].DiskState; got != recoveryStateChanged {
		t.Errorf("DiskState after external edit = %q, want changed", got)
	}
	if listing.Items[0].DiskText != "changed outside\n" {
		t.Errorf("DiskText after external edit = %q", listing.Items[0].DiskText)
	}

	if err := os.Remove(filePath); err != nil {
		t.Fatal(err)
	}
	listing, err = recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if got := listing.Items[0].DiskState; got != recoveryStateMissing {
		t.Errorf("DiskState after delete = %q, want missing", got)
	}
	if listing.Items[0].DiskText != "" {
		t.Errorf("DiskText after delete = %q, want empty", listing.Items[0].DiskText)
	}

	if err := recovery.Delete(id, generation); err != nil {
		t.Fatal(err)
	}
	listing, err = recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 0 {
		t.Errorf("List() after Delete = %+v, want empty", listing.Items)
	}
}

func TestRecoveryMissingDiskHashFailsClosed(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	mustWriteFile(t, filepath.Join(root, "new.md"), []byte("on disk\n"))
	generation := workspace.openGeneration()

	// No read or write has recorded this file's hash yet.
	saveTestCopy(t, recovery, RecoveryCopy{
		Kind:       recoveryKindWorkspace,
		Root:       root,
		Path:       "new.md",
		LineEnding: "\n",
		Text:       "unsaved\n",
	}, generation)

	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if got := listing.Items[0].DiskState; got != recoveryStateChanged {
		t.Errorf("DiskState without a recorded hash = %q, want changed", got)
	}
}

func TestRecoveryWorkspaceGuards(t *testing.T) {
	root := t.TempDir()
	otherRoot := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	generation := workspace.openGeneration()
	copy := RecoveryCopy{
		Kind:       recoveryKindWorkspace,
		Root:       root,
		Path:       "a.md",
		LineEnding: "\n",
		Text:       "text",
	}

	if _, err := recovery.Save(copy, generation+1); !errors.Is(err, errRecoveryGeneration) {
		t.Errorf("Save with wrong generation = %v, want errRecoveryGeneration", err)
	}
	outside := copy
	outside.Root = otherRoot
	if _, err := recovery.Save(outside, generation); !errors.Is(err, errRecoveryNotAllowed) {
		t.Errorf("Save for another root = %v, want errRecoveryNotAllowed", err)
	}
	traversal := copy
	traversal.Path = "../a.md"
	if _, err := recovery.Save(traversal, generation); !errors.Is(err, errRecoveryNotAllowed) {
		t.Errorf("Save with traversal = %v, want errRecoveryNotAllowed", err)
	}
	nonMarkdown := copy
	nonMarkdown.Path = "a.txt"
	if _, err := recovery.Save(nonMarkdown, generation); !errors.Is(err, errRecoveryNotAllowed) {
		t.Errorf("Save with non-Markdown path = %v, want errRecoveryNotAllowed", err)
	}

	id := saveTestCopy(t, recovery, copy, generation)
	if _, err := workspace.open(otherRoot); err != nil {
		t.Fatal(err)
	}
	newGeneration := workspace.openGeneration()
	listing, err := recovery.List(newGeneration)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 0 || listing.OtherFolders != 1 {
		t.Errorf("List after switching roots = %+v, want no items and one other folder", listing)
	}
	if err := recovery.Delete(id, newGeneration); !errors.Is(err, errRecoveryNotAllowed) {
		t.Errorf("Delete from another root = %v, want errRecoveryNotAllowed", err)
	}
	if _, err := recovery.List(generation); !errors.Is(err, errRecoveryGeneration) {
		t.Errorf("List with old generation = %v, want errRecoveryGeneration", err)
	}
}

func TestRecoveryDiscardOnlyListedCopies(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	generation := workspace.openGeneration()
	first := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "a.md",
		LineEnding: "\n", Text: "a",
	}, generation)
	second := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "b.md",
		LineEnding: "\n", Text: "b",
	}, generation)

	if err := recovery.Discard([]string{first}, generation); err != nil {
		t.Fatal(err)
	}
	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].ID != second {
		t.Errorf("List after Discard = %+v, want only %s", listing.Items, second)
	}
}

func TestRecoverySingleFileAuthorization(t *testing.T) {
	_, singleFiles, recovery := newTestRecovery(t, "")
	directory := t.TempDir()
	target := filepath.Join(directory, "note.md")
	mustWriteFile(t, target, []byte("first\n"))

	// Without a grant, even an existing Markdown file is refused.
	if _, err := recovery.Save(RecoveryCopy{
		Kind: recoveryKindSingle, Path: target, LineEnding: "\n", Text: "changed\n",
	}, 0); !errors.Is(err, errRecoveryNotAllowed) {
		t.Errorf("Save without grant = %v, want errRecoveryNotAllowed", err)
	}

	file, err := singleFiles.grant(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := singleFiles.ReadSingleFile(file.Path); err != nil {
		t.Fatal(err)
	}
	id := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindSingle, Path: file.Path, LineEnding: "\n", Text: "changed\n",
	}, 0)

	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 {
		t.Fatalf("List() = %+v, want one single-file copy", listing)
	}
	if listing.Items[0].Kind != recoveryKindSingle || listing.Items[0].Path != file.Path {
		t.Errorf("single item = %+v", listing.Items[0])
	}
	if listing.Items[0].DiskState != recoveryStateSame {
		t.Errorf("DiskState = %q, want same", listing.Items[0].DiskState)
	}

	// Grants do not survive a restart; restore is the one way to re-authorize
	// a single-file path.
	singleFiles.ReleaseSingleFile(file.Path)
	if _, err := singleFiles.ReadSingleFile(file.Path); err == nil {
		t.Fatal("ReadSingleFile succeeded after release")
	}
	restored, err := recovery.RestoreSingleFile(id)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Path != file.Path {
		t.Errorf("RestoreSingleFile() path = %q, want %q", restored.Path, file.Path)
	}
	if _, err := singleFiles.ReadSingleFile(restored.Path); err != nil {
		t.Errorf("ReadSingleFile after restore: %v", err)
	}
	if _, err := recovery.RestoreSingleFile(id); !errors.Is(err, errRecoveryConsumed) {
		t.Errorf("second RestoreSingleFile = %v, want errRecoveryConsumed", err)
	}
	if _, err := recovery.RestoreSingleFile("0123456789abcdef"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("RestoreSingleFile unknown id = %v, want not-exist", err)
	}
	if _, err := recovery.RestoreSingleFile("../../etc/passwd"); !errors.Is(err, errRecoveryInvalidID) {
		t.Errorf("RestoreSingleFile bad id = %v, want errRecoveryInvalidID", err)
	}
}

func TestRecoverySingleFileRevalidatesOnRestore(t *testing.T) {
	_, singleFiles, recovery := newTestRecovery(t, "")
	directory := t.TempDir()
	target := filepath.Join(directory, "note.md")
	mustWriteFile(t, target, []byte("text\n"))
	file, err := singleFiles.grant(target)
	if err != nil {
		t.Fatal(err)
	}
	id := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindSingle, Path: file.Path, LineEnding: "\n", Text: "changed\n",
	}, 0)
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(target, 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := recovery.RestoreSingleFile(id); !errors.Is(err, errRecoveryUnrestorable) {
		t.Errorf("RestoreSingleFile for a folder = %v, want errRecoveryUnrestorable", err)
	}
	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].Restorable {
		t.Errorf("List() = %+v, want an unrestorable item", listing.Items)
	}

	other := filepath.Join(directory, "other.md")
	mustWriteFile(t, other, []byte("other\n"))
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, target); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := recovery.RestoreSingleFile(id); !errors.Is(err, errRecoveryUnrestorable) {
		t.Errorf("RestoreSingleFile for a symlink = %v, want errRecoveryUnrestorable", err)
	}
}

func TestRecoverySingleFileMissingStillAuthorizes(t *testing.T) {
	_, singleFiles, recovery := newTestRecovery(t, "")
	directory := t.TempDir()
	target := filepath.Join(directory, "gone.md")
	mustWriteFile(t, target, []byte("text\n"))
	file, err := singleFiles.grant(target)
	if err != nil {
		t.Fatal(err)
	}
	id := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindSingle, Path: file.Path, LineEnding: "\n", Text: "changed\n",
	}, 0)
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].DiskState != recoveryStateMissing || !listing.Items[0].Restorable {
		t.Errorf("List() = %+v, want a restorable missing item", listing.Items)
	}
	restored, err := recovery.RestoreSingleFile(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := singleFiles.WriteSingleFile(restored.Path, "rewritten\n"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "rewritten\n" {
		t.Errorf("recreated file = %q", data)
	}
}

func TestRecoveryCorruptFileIsRenamed(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	generation := workspace.openGeneration()
	id := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "a.md",
		LineEnding: "\n", Text: "a",
	}, generation)
	bad := filepath.Join(recovery.store.dir, "broken.json")
	if err := os.WriteFile(bad, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(recovery.store.dir, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].ID != id {
		t.Errorf("List() = %+v, want the valid copy only", listing.Items)
	}
	entries, err := os.ReadDir(recovery.store.dir)
	if err != nil {
		t.Fatal(err)
	}
	corrupt := 0
	for _, entry := range entries {
		if strings.Contains(entry.Name(), ".corrupt-") {
			corrupt++
		}
	}
	if corrupt != 2 {
		t.Errorf("corrupt backups = %d, want 2 (entries: %v)", corrupt, entries)
	}
}

func TestRecoveryPruneKeepsNewestCorruptBackupsAndValidCopies(t *testing.T) {
	workspace, _, recovery := newTestRecovery(t, t.TempDir())
	root := workspace.openRoot()
	generation := workspace.openGeneration()
	validID := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "valid.md",
		LineEnding: "\n", Text: "valid\n",
	}, generation)
	store := recovery.store
	dir := store.dir
	validPath := store.filePath(validID)
	unrelatedPath := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(unrelatedPath, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	oldTime := base.Add(-time.Hour)
	for _, path := range []string{validPath, unrelatedPath} {
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < maxCorruptBackups+5; i++ {
		// Names sort oldest-first, timestamps newest-first, so ordering by the
		// whole file name would discard the newest backups.
		at := base.Add(time.Duration(maxCorruptBackups+4-i) * time.Minute)
		name := fmt.Sprintf("backup-%02d.json%s%s", i, corruptBackupMarker, at.Format(corruptBackupTimeLayout))
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	store.pruneCorruptLocked()

	for i := 0; i < maxCorruptBackups+5; i++ {
		at := base.Add(time.Duration(maxCorruptBackups+4-i) * time.Minute)
		name := fmt.Sprintf("backup-%02d.json%s%s", i, corruptBackupMarker, at.Format(corruptBackupTimeLayout))
		_, err := os.Stat(filepath.Join(dir, name))
		wantKept := i < maxCorruptBackups
		if wantKept && err != nil {
			t.Errorf("newest backup %s was removed: %v", name, err)
		}
		if !wantKept && !errors.Is(err, os.ErrNotExist) {
			t.Errorf("old backup %s was not removed: %v", name, err)
		}
	}
	if _, err := store.get(validID); err != nil {
		t.Errorf("valid recovery copy was removed or damaged: %v", err)
	}
	if _, err := os.Stat(unrelatedPath); err != nil {
		t.Errorf("non-corrupt file was removed: %v", err)
	}
}

func TestRecoveryLimits(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	generation := workspace.openGeneration()
	recovery.store.maxFile = 4
	if _, err := recovery.Save(RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "big.md",
		LineEnding: "\n", Text: "12345",
	}, generation); !errors.Is(err, errRecoveryTooLarge) {
		t.Errorf("Save over the file limit = %v, want errRecoveryTooLarge", err)
	}

	// Replacing a path does not count its old copy against the folder limit,
	// but another path still does.
	store := recovery.store
	store.maxFile = 100
	store.maxTotal = 230
	if err := os.MkdirAll(store.dir, 0o755); err != nil {
		t.Fatal(err)
	}
	targetID := "0011223344556677"
	if err := os.WriteFile(store.filePath(targetID), make([]byte, 100), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.dir, "other.json"), make([]byte, 200), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.save(targetID, make([]byte, 20)); err != nil {
		t.Errorf("replacing a copy should exclude the old file: %v", err)
	}
	if err := store.save("8899aabbccddeeff", make([]byte, 20)); !errors.Is(err, errRecoveryFolderFull) {
		t.Errorf("Save over the folder limit = %v, want errRecoveryFolderFull", err)
	}
}

func TestRecoveryClearsOldRootHashes(t *testing.T) {
	hashes := newDiskHashes()
	first := t.TempDir()
	second := t.TempDir()
	workspace := NewWorkspace()
	workspace.useDiskHashes(hashes)
	if _, err := workspace.open(first); err != nil {
		t.Fatal(err)
	}
	first = workspace.openRoot()
	mustWriteFile(t, filepath.Join(first, "a.md"), []byte("a"))
	if _, err := workspace.ReadFile("a.md"); err != nil {
		t.Fatal(err)
	}
	if _, ok := hashes.lookup(filepath.Join(first, "a.md")); !ok {
		t.Fatal("ReadFile did not record a hash")
	}
	if _, err := workspace.open(second); err != nil {
		t.Fatal(err)
	}
	if _, ok := hashes.lookup(filepath.Join(first, "a.md")); ok {
		t.Error("switching roots kept the old root's hash")
	}
}

func TestRecoveryRecordRejectsNonPendingIDs(t *testing.T) {
	_, _, recovery := newTestRecovery(t, "")
	if _, err := recovery.RestoreSingleFile("0000000000000000"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("RestoreSingleFile missing id = %v, want not-exist", err)
	}
}

func TestRecoveryRepeatedCopyKeepsDiskHash(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("disk\n"))
	if _, err := workspace.ReadFile("a.md"); err != nil {
		t.Fatal(err)
	}
	generation := workspace.openGeneration()
	copy := RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "a.md",
		LineEnding: "\n", Text: "first edit\n",
	}
	saveTestCopy(t, recovery, copy, generation)

	// Simulate a later page session that has not read the file again. The
	// stored copy still knows the disk baseline.
	recovery.hashes = newDiskHashes()
	copy.Text = "second edit\n"
	saveTestCopy(t, recovery, copy, generation)

	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if got := listing.Items[0].DiskState; got != recoveryStateSame {
		t.Errorf("DiskState after repeated copy = %q, want same", got)
	}
}

func TestRecoveryUnconfirmedBaselineDoesNotBecomeSame(t *testing.T) {
	root := t.TempDir()
	workspace, _, recovery := newTestRecovery(t, root)
	root = workspace.openRoot()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("disk version\n"))
	if _, err := workspace.ReadFile("a.md"); err != nil {
		t.Fatal(err)
	}
	generation := workspace.openGeneration()
	saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "a.md",
		LineEnding: "\n", Text: "confirmed copy\n",
	}, generation)

	id, err := recovery.Save(RecoveryCopy{
		Kind: recoveryKindWorkspace, Root: root, Path: "a.md",
		LineEnding: "\n", Text: "unconfirmed copy\n",
		BaselineUnconfirmed: true,
	}, generation)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := recovery.store.get(id)
	if err != nil {
		t.Fatal(err)
	}
	if entry.DiskHash != "" {
		t.Errorf("unconfirmed copy recorded disk hash %q, want empty", entry.DiskHash)
	}
	listing, err := recovery.List(generation)
	if err != nil {
		t.Fatal(err)
	}
	if got := listing.Items[0].DiskState; got != recoveryStateChanged {
		t.Errorf("unconfirmed copy state = %q, want changed", got)
	}
}

func TestRecoveryEncodesHTMLLiterallyAndUsesJSONByteLimit(t *testing.T) {
	dir := t.TempDir()
	entry := storedRecovery{
		Version:    1,
		Kind:       recoveryKindWorkspace,
		Root:       t.TempDir(),
		Path:       "a.md",
		SavedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		LineEnding: "\n",
		Text:       strings.Repeat("<div>&</div>", 20),
	}
	data, err := encodeRecoveryEntry(entry)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), `\u003c`) || strings.Contains(string(data), `\u0026`) {
		t.Errorf("encoded copy escaped HTML characters: %s", data[:80])
	}
	if !strings.Contains(string(data), "<div>&</div>") {
		t.Errorf("encoded copy does not contain literal HTML")
	}

	id := recoveryID(entry.Kind, entry.Root, entry.Path)
	atLimit := newRecoveryStoreIn(dir)
	atLimit.maxFile = len(data)
	if err := atLimit.save(id, data); err != nil {
		t.Errorf("save at JSON byte limit: %v", err)
	}
	if _, err := atLimit.get(id); err != nil {
		t.Errorf("read at JSON byte limit: %v", err)
	}

	tooSmall := newRecoveryStoreIn(t.TempDir())
	tooSmall.maxFile = len(data) - 1
	if err := tooSmall.save(id, data); !errors.Is(err, errRecoveryTooLarge) {
		t.Errorf("save over JSON byte limit = %v, want errRecoveryTooLarge", err)
	}
}

func TestRecoveryRejectsMismatchedFilename(t *testing.T) {
	dir := t.TempDir()
	store := newRecoveryStoreIn(dir)
	entry := storedRecovery{
		Version:    1,
		Kind:       recoveryKindWorkspace,
		Root:       t.TempDir(),
		Path:       "a.md",
		SavedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		LineEnding: "\n",
		Text:       "text",
	}
	data, err := encodeRecoveryEntry(entry)
	if err != nil {
		t.Fatal(err)
	}
	wrongPath := filepath.Join(dir, "0000000000000000.json")
	if err := os.WriteFile(wrongPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	copies, err := store.list()
	if err != nil {
		t.Fatal(err)
	}
	if len(copies) != 0 {
		t.Errorf("list returned copies with a mismatched filename: %+v", copies)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range entries {
		if strings.Contains(item.Name(), ".corrupt-") {
			found = true
		}
	}
	if !found {
		t.Errorf("mismatched file was not renamed as corrupt")
	}
}

func TestRecoveryCorruptBackupsDoNotConsumeQuota(t *testing.T) {
	dir := t.TempDir()
	store := newRecoveryStoreIn(dir)
	store.maxFile = 100
	store.maxTotal = 150
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "old.json.corrupt-20260101T000000.000000000Z"), make([]byte, 1000), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := store.save("0011223344556677", make([]byte, 100)); err != nil {
		t.Errorf("corrupt backup consumed quota: %v", err)
	}
}

func TestRecoverySingleMissingFileWithSymlinkedParentIsUnrestorable(t *testing.T) {
	_, singleFiles, recovery := newTestRecovery(t, "")
	base := t.TempDir()
	realDir := filepath.Join(base, "real")
	mustWriteFile(t, filepath.Join(realDir, "note.md"), []byte("text\n"))
	file, err := singleFiles.grant(filepath.Join(realDir, "note.md"))
	if err != nil {
		t.Fatal(err)
	}
	id := saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindSingle, Path: file.Path, LineEnding: "\n", Text: "changed\n",
	}, 0)
	if err := os.Remove(file.Path); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(realDir); err != nil {
		t.Fatal(err)
	}
	elsewhere := filepath.Join(base, "elsewhere")
	if err := os.Mkdir(elsewhere, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(elsewhere, realDir); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].Restorable {
		t.Errorf("List() = %+v, want an unrestorable item", listing.Items)
	}
	if _, err := recovery.RestoreSingleFile(id); !errors.Is(err, errRecoveryUnrestorable) {
		t.Errorf("RestoreSingleFile with symlinked parent = %v, want errRecoveryUnrestorable", err)
	}
}

func TestRecoverySingleUnreadableFileIsUnrestorable(t *testing.T) {
	_, singleFiles, recovery := newTestRecovery(t, "")
	path := filepath.Join(t.TempDir(), "note.md")
	mustWriteFile(t, path, []byte("text\n"))
	file, err := singleFiles.grant(path)
	if err != nil {
		t.Fatal(err)
	}
	saveTestCopy(t, recovery, RecoveryCopy{
		Kind: recoveryKindSingle, Path: file.Path, LineEnding: "\n", Text: "changed\n",
	}, 0)
	if err := os.Chmod(file.Path, 0); err != nil {
		t.Skipf("cannot remove read permission: %v", err)
	}
	defer os.Chmod(file.Path, 0o644)
	if _, err := os.ReadFile(file.Path); err == nil {
		t.Skip("permissions are not enforced for this user")
	}

	listing, err := recovery.List(0)
	if err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 {
		t.Fatalf("List() = %+v, want one item", listing.Items)
	}
	item := listing.Items[0]
	if item.Restorable {
		t.Errorf("unreadable single file is restorable: %+v", item)
	}
	if item.Reason == "" {
		t.Errorf("unreadable single file has no reason: %+v", item)
	}
	if item.DiskState != recoveryStateChanged {
		t.Errorf("unreadable single file state = %q, want changed", item.DiskState)
	}
}

func TestRecoveryKeepsOpenSingleFileHashesAcrossRootSwitch(t *testing.T) {
	hashes := newDiskHashes()
	first := t.TempDir()
	second := t.TempDir()
	workspace := NewWorkspace()
	workspace.useDiskHashes(hashes)
	singleFiles := NewSingleFileService()
	singleFiles.useDiskHashes(hashes)
	workspace.useOpenSingleFiles(singleFiles.grantedPaths)
	if _, err := workspace.open(first); err != nil {
		t.Fatal(err)
	}
	first = workspace.openRoot()
	mustWriteFile(t, filepath.Join(first, "workspace.md"), []byte("workspace\n"))
	if _, err := workspace.ReadFile("workspace.md"); err != nil {
		t.Fatal(err)
	}
	singlePath := filepath.Join(first, "single.md")
	mustWriteFile(t, singlePath, []byte("single\n"))
	file, err := singleFiles.grant(singlePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := singleFiles.ReadSingleFile(file.Path); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.open(second); err != nil {
		t.Fatal(err)
	}
	if _, ok := hashes.lookup(filepath.Join(first, "workspace.md")); ok {
		t.Error("workspace hash from the old root was kept")
	}
	if _, ok := hashes.lookup(file.Path); !ok {
		t.Error("open single-file hash was cleared with the old root")
	}
}
