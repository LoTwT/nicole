package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func acceptOffered(t *testing.T, service *SingleFileService, path string) SingleFile {
	t.Helper()
	offerID := service.offer(path)
	file, err := service.AcceptSingleFile(path, offerID)
	if err != nil {
		t.Fatal(err)
	}
	return file
}

func TestSingleFileGrantIsPerFile(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.md")
	second := filepath.Join(root, "second.md")
	mustWriteFile(t, first, []byte("first\r\nline\r\n"))
	mustWriteFile(t, second, []byte("second"))

	service := NewSingleFileService()
	if _, err := service.ReadSingleFile(first); !errors.Is(err, errSingleFileNotGranted) {
		t.Fatalf("Read before a grant = %v, want %v", err, errSingleFileNotGranted)
	}

	file := acceptOffered(t, service, first)
	if file.Path == "" || file.Name != "first.md" {
		t.Errorf("accepted file = %+v", file)
	}
	content, err := service.ReadSingleFile(file.Path)
	if err != nil {
		t.Fatal(err)
	}
	if content != "first\r\nline\r\n" {
		t.Errorf("content = %q, want the exact bytes", content)
	}

	// The file next to the granted one stays inaccessible.
	if _, err := service.ReadSingleFile(second); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Read(sibling) = %v, want %v", err, errSingleFileNotGranted)
	}
	if err := service.WriteSingleFile(second, "overwritten"); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Write(sibling) = %v, want %v", err, errSingleFileNotGranted)
	}
	if data, err := os.ReadFile(second); err != nil || string(data) != "second" {
		t.Errorf("sibling content = %q, %v", data, err)
	}
	if _, err := service.AcceptSingleFile(second, ""); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept(not offered) = %v, want %v", err, errSingleFileNotGranted)
	}
}

func TestSingleFileWriteIsAtomicAndKeepsMode(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	mustWriteFile(t, path, []byte("old"))
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}

	service := NewSingleFileService()
	file := acceptOffered(t, service, path)
	if err := service.WriteSingleFile(file.Path, "new\r\ncontent"); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new\r\ncontent" {
		t.Errorf("content = %q, want exact bytes", data)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o640 {
		t.Errorf("mode = %o, want 640", info.Mode().Perm())
	}
	tempFiles, err := filepath.Glob(filepath.Join(root, tempFilePrefix+"*"+tempFileSuffix))
	if err != nil {
		t.Fatal(err)
	}
	if len(tempFiles) != 0 {
		t.Errorf("temporary files left behind: %q", tempFiles)
	}
}

func TestSingleFileWriteRefusesReadOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the read-only attribute does not map to permission bits")
	}
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	mustWriteFile(t, path, []byte("old"))
	if err := os.Chmod(path, 0o444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(path, 0o644) })

	service := NewSingleFileService()
	file := acceptOffered(t, service, path)
	if err := service.WriteSingleFile(file.Path, "new"); !errors.Is(err, errReadOnlyFile) {
		t.Errorf("WriteSingleFile(read-only) = %v, want %v", err, errReadOnlyFile)
	}
}

func TestSingleFileRejectsOtherTypes(t *testing.T) {
	root := t.TempDir()
	txt := filepath.Join(root, "note.txt")
	mustWriteFile(t, txt, []byte("text"))
	folder := filepath.Join(root, "folder")
	if err := os.Mkdir(folder, 0o755); err != nil {
		t.Fatal(err)
	}

	service := NewSingleFileService()
	offerID := service.offer(txt)
	if _, err := service.AcceptSingleFile(txt, offerID); !errors.Is(err, errSingleFileNotMarkdown) {
		t.Errorf("Accept(.txt) = %v, want %v", err, errSingleFileNotMarkdown)
	}
	offerID = service.offer(folder)
	if _, err := service.AcceptSingleFile(folder, offerID); !errors.Is(err, errNotRegular) {
		t.Errorf("Accept(folder) = %v, want %v", err, errNotRegular)
	}
	if _, err := service.AcceptSingleFile("relative.md", "missing"); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept(relative) = %v, want %v", err, errSingleFileNotGranted)
	}
}

func TestSingleFileReleaseAndDeletion(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	mustWriteFile(t, path, []byte("note"))
	service := NewSingleFileService()
	file := acceptOffered(t, service, path)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := service.ReadSingleFile(file.Path); err == nil {
		t.Error("ReadSingleFile succeeded after the file was deleted")
	}

	mustWriteFile(t, path, []byte("again"))
	acceptOffered(t, service, path)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := service.WriteSingleFile(file.Path, "restored"); err != nil {
		t.Fatalf("WriteSingleFile after deletion = %v", err)
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != "restored" {
		t.Errorf("restored content = %q, %v", data, err)
	}
	service.ReleaseSingleFile(file.Path)
	if _, err := service.ReadSingleFile(file.Path); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Read after Release = %v, want %v", err, errSingleFileNotGranted)
	}
}

func TestSingleFileWriteRejectsAReplacedSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	outside := filepath.Join(t.TempDir(), "outside.txt")
	mustWriteFile(t, path, []byte("note"))
	mustWriteFile(t, outside, []byte("outside"))

	service := NewSingleFileService()
	file := acceptOffered(t, service, path)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}

	if err := service.WriteSingleFile(file.Path, "changed"); !errors.Is(err, errNotRegular) {
		t.Fatalf("WriteSingleFile(replaced symlink) = %v, want %v", err, errNotRegular)
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "outside" {
		t.Errorf("outside target = %q, %v; want it unchanged", data, err)
	}
	if info, err := os.Lstat(path); err != nil || info.Mode()&os.ModeSymlink == 0 {
		t.Errorf("granted path is no longer a symlink: %v, %v", info, err)
	}
}

func TestSingleFileOfferCanBeDismissedOrConsumedByFolder(t *testing.T) {
	root := t.TempDir()
	first := filepath.Join(root, "first.md")
	second := filepath.Join(root, "second.md")
	mustWriteFile(t, first, []byte("first"))
	mustWriteFile(t, second, []byte("second"))

	service := NewSingleFileService()
	firstOffer := service.offer(first)
	service.DismissOfferedFile(first, firstOffer)
	if _, err := service.AcceptSingleFile(first, firstOffer); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept after Dismiss = %v, want %v", err, errSingleFileNotGranted)
	}

	service.offer(first)
	service.offer(second)
	if !service.takeOfferedFolder(root) {
		t.Fatal("takeOfferedFolder did not find the offered files")
	}
	if paths := service.offeredPaths(); len(paths) != 0 {
		t.Errorf("offered paths after takeOfferedFolder = %q, want none", paths)
	}
	if service.takeOfferedFolder(root) {
		t.Error("takeOfferedFolder matched the same offers twice")
	}
}

func TestSingleFileOfferCleanupUsesItsOwnOccurrence(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	mustWriteFile(t, path, []byte("note"))

	service := NewSingleFileService()
	oldOffer := service.offer(path)
	newOffer := service.offer(path)
	if oldOffer == newOffer {
		t.Fatal("two offers for the same path reused one identity")
	}
	service.DismissOfferedFile(path, oldOffer)
	if _, err := service.AcceptSingleFile(path, oldOffer); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept(old offer) = %v, want %v", err, errSingleFileNotGranted)
	}
	if _, err := service.AcceptSingleFile(path, newOffer); err != nil {
		t.Fatalf("Accept(new offer after old dismiss) = %v", err)
	}

	pendingOffer := service.offer(path)
	service.ReleaseSingleFile(path)
	service.mu.Lock()
	offeredID := service.offered[filepath.Clean(path)]
	service.mu.Unlock()
	if offeredID != pendingOffer {
		t.Errorf("offer after grant release = %q, want %q", offeredID, pendingOffer)
	}
	if _, err := service.AcceptSingleFile(path, pendingOffer); err != nil {
		t.Fatalf("Accept(offer after grant release) = %v", err)
	}
}

func TestSingleFileNewOfferSupersedesAliases(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	root := t.TempDir()
	target := filepath.Join(root, "real.md")
	link := filepath.Join(root, "link.md")
	mustWriteFile(t, target, []byte("real"))
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	service := NewSingleFileService()
	oldOffer := service.offer(link)
	newOffer := service.offer(target)
	if oldOffer == newOffer {
		t.Fatal("alias offers reused one identity")
	}
	if _, err := service.AcceptSingleFile(link, oldOffer); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept(old alias offer) = %v, want %v", err, errSingleFileNotGranted)
	}
	if _, err := service.AcceptSingleFile(target, newOffer); err != nil {
		t.Fatalf("Accept(new offer that superseded alias) = %v", err)
	}
	if _, err := service.AcceptSingleFile(link, newOffer); !errors.Is(err, errSingleFileNotGranted) {
		t.Errorf("Accept(consumed alias) = %v, want %v", err, errSingleFileNotGranted)
	}
}

func TestSingleFileRevealRequiresGrant(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "note.md")
	mustWriteFile(t, path, []byte("note"))

	originalReveal := revealWorkspaceItem
	var revealed []string
	revealWorkspaceItem = func(path string) { revealed = append(revealed, path) }
	t.Cleanup(func() { revealWorkspaceItem = originalReveal })

	service := NewSingleFileService()
	if err := service.RevealSingleFile(path); !errors.Is(err, errSingleFileNotGranted) {
		t.Fatalf("Reveal before grant = %v, want %v", err, errSingleFileNotGranted)
	}
	file := acceptOffered(t, service, path)
	if err := service.RevealSingleFile(file.Path); err != nil {
		t.Fatal(err)
	}
	if len(revealed) != 1 || revealed[0] != file.Path {
		t.Errorf("revealed = %q, want %q", revealed, file.Path)
	}
}

func TestSingleFileOfferResolvesSymlinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("creating symlinks needs a developer mode or administrator rights")
	}
	root := t.TempDir()
	target := filepath.Join(root, "real.md")
	mustWriteFile(t, target, []byte("real"))
	link := filepath.Join(root, "link.md")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	service := NewSingleFileService()
	file := acceptOffered(t, service, link)
	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		t.Fatal(err)
	}
	if file.Path != resolvedTarget {
		t.Errorf("accepted path = %q, want %q", file.Path, resolvedTarget)
	}
	content, err := service.ReadSingleFile(file.Path)
	if err != nil || content != "real" {
		t.Errorf("ReadSingleFile() = %q, %v", content, err)
	}
}
