package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func testPNG() []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), []byte("test image")...)
}

func testJPEG() []byte {
	return []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 0x01, 0x02, 0x03}
}

func testAssets(workspace *Workspace, clipboard []byte) *Assets {
	assets := NewAssets(workspace)
	assets.now = func() time.Time {
		return time.Date(2026, time.November, 1, 12, 0, 0, 0, time.Local)
	}
	assets.clipboard = func() ([]byte, error) { return clipboard, nil }
	return assets
}

func TestPasteImageSavesPNGInAssets(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "notes", "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, testPNG())

	image, err := assets.PasteImage("notes/chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if want := "assets/image-20261101-120000.png"; image.Path != want {
		t.Errorf("Path = %q, want %q", image.Path, want)
	}
	if want := "![](../assets/image-20261101-120000.png)"; image.Markdown != want {
		t.Errorf("Markdown = %q, want %q", image.Markdown, want)
	}
	data, err := os.ReadFile(filepath.Join(root, "assets", "image-20261101-120000.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, testPNG()) {
		t.Errorf("saved bytes = %q, want the clipboard bytes", data)
	}
}

func TestPasteImageUsesRootForRootDocument(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	image, err := testAssets(workspace, testPNG()).PasteImage("chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if want := "![](assets/image-20261101-120000.png)"; image.Markdown != want {
		t.Errorf("Markdown = %q, want %q", image.Markdown, want)
	}
}

func TestPasteImageRenamesCollisions(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, testPNG())

	for _, want := range []string{
		"assets/image-20261101-120000.png",
		"assets/image-20261101-120000-2.png",
		"assets/image-20261101-120000-3.png",
	} {
		image, err := assets.PasteImage("chapter.md", currentGeneration(workspace))
		if err != nil {
			t.Fatal(err)
		}
		if image.Path != want {
			t.Errorf("Path = %q, want %q", image.Path, want)
		}
	}
}

func TestPasteImageRejectsStaleGeneration(t *testing.T) {
	first := t.TempDir()
	mustWriteFile(t, filepath.Join(first, "chapter.md"), []byte("# First"))
	workspace := openTestWorkspace(t, first)
	stale := currentGeneration(workspace)

	second := t.TempDir()
	mustWriteFile(t, filepath.Join(second, "chapter.md"), []byte("# Second"))
	if _, err := workspace.open(second); err != nil {
		t.Fatal(err)
	}

	_, err := testAssets(workspace, testPNG()).PasteImage("chapter.md", stale)
	if !errors.Is(err, errWorkspaceChange) {
		t.Fatalf("PasteImage() with an old generation = %v, want %v", err, errWorkspaceChange)
	}
	if _, err := os.Stat(filepath.Join(second, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("stale paste created assets: %v", err)
	}
}

func TestPasteImageRequiresClipboardImage(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	if _, err := testAssets(workspace, nil).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errNoClipboardImage) {
		t.Errorf("PasteImage() without an image = %v, want %v", err, errNoClipboardImage)
	}
	if _, err := testAssets(workspace, []byte("not png")).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errUnsupportedImage) {
		t.Errorf("PasteImage() with non-PNG data = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("invalid paste created assets: %v", err)
	}
}

func TestPasteImageRejectsDocumentOutsideWorkspace(t *testing.T) {
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)
	for _, doc := range []string{"chapter.md", "../chapter.md", "notes/chapter.txt"} {
		if _, err := testAssets(workspace, testPNG()).PasteImage(doc, currentGeneration(workspace)); err == nil {
			t.Errorf("PasteImage(%q) succeeded, want an error", doc)
		}
	}
}

func TestPasteImageRejectsSymlinkedAssetsFolder(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	if err := os.Symlink(outside, filepath.Join(root, "assets")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	workspace := openTestWorkspace(t, root)

	if _, err := testAssets(workspace, testPNG()).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errAssetsNotFolder) {
		t.Fatalf("PasteImage() with a linked assets folder = %v, want %v", err, errAssetsNotFolder)
	}
	entries, err := os.ReadDir(outside)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("linked assets folder received files: %v", entries)
	}
}

func TestPasteImageFailureLeavesNoFile(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, testPNG())
	renameFailed := errors.New("rename failed")
	assets.write = func(root *os.Root, target string, data []byte, mode fs.FileMode) error {
		return writeWorkspaceFileWith(root, target, data, mode, func(*os.Root, string, string) error {
			return renameFailed
		})
	}

	if _, err := assets.PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, renameFailed) {
		t.Fatalf("PasteImage() = %v, want %v", err, renameFailed)
	}
	entries, err := os.ReadDir(filepath.Join(root, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("failed save left files: %v", entries)
	}
}

func TestImportImagesCopiesAndSkipsNonImages(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "notes", "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	source := filepath.Join(t.TempDir(), "my photo.JPG")
	mustWriteFile(t, source, testJPEG())
	text := filepath.Join(t.TempDir(), "notes.txt")
	mustWriteFile(t, text, []byte("text"))

	images, err := testAssets(workspace, nil).ImportImages(
		"notes/chapter.md",
		currentGeneration(workspace),
		[]string{source, text},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 {
		t.Fatalf("ImportImages() returned %d images, want 1", len(images))
	}
	if want := "assets/my-photo.jpg"; images[0].Path != want {
		t.Errorf("Path = %q, want %q", images[0].Path, want)
	}
	if want := "![](../assets/my-photo.jpg)"; images[0].Markdown != want {
		t.Errorf("Markdown = %q, want %q", images[0].Markdown, want)
	}
	data, err := os.ReadFile(filepath.Join(root, "assets", "my-photo.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, testJPEG()) {
		t.Errorf("saved bytes = %q, want the source bytes", data)
	}
}

func TestImportImagesRenamesCollisions(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	firstDir := t.TempDir()
	secondDir := t.TempDir()
	first := filepath.Join(firstDir, "photo.png")
	second := filepath.Join(secondDir, "photo.png")
	mustWriteFile(t, first, testPNG())
	mustWriteFile(t, second, testPNG())

	images, err := testAssets(workspace, nil).ImportImages(
		"chapter.md",
		currentGeneration(workspace),
		[]string{first, second},
	)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"assets/photo.png", "assets/photo-2.png"}
	if len(images) != len(want) {
		t.Fatalf("ImportImages() returned %d images, want %d", len(images), len(want))
	}
	for index, path := range want {
		if images[index].Path != path {
			t.Errorf("image %d = %q, want %q", index, images[index].Path, path)
		}
	}
}

func TestImportImagesRejectsContentThatIsNotAnImage(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	source := filepath.Join(t.TempDir(), "fake.png")
	mustWriteFile(t, source, []byte("<html><body>not an image</body></html>"))
	if _, err := testAssets(workspace, nil).ImportImages("chapter.md", currentGeneration(workspace), []string{source}); !errors.Is(err, errUnsupportedImage) {
		t.Fatalf("ImportImages() = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("invalid import created assets: %v", err)
	}
}

func TestImportImagesAcceptsSVG(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	source := filepath.Join(t.TempDir(), "diagram.svg")
	mustWriteFile(t, source, []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	images, err := testAssets(workspace, nil).ImportImages("chapter.md", currentGeneration(workspace), []string{source})
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/diagram.svg" {
		t.Errorf("ImportImages() = %+v, want one assets/diagram.svg", images)
	}
}

func TestSanitizeImageBase(t *testing.T) {
	for _, test := range []struct{ name, want string }{
		{"photo", "photo"},
		{"my photo", "my-photo"},
		{"a:b*c?", "a-b-c"},
		{"  ..name..  ", "name"},
		{"照片", "照片"},
		{strings.Repeat("a", 80), strings.Repeat("a", 60)},
	} {
		if got := sanitizeImageBase(test.name); got != test.want {
			t.Errorf("sanitizeImageBase(%q) = %q, want %q", test.name, got, test.want)
		}
	}
}
