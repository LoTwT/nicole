package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func testPNG() []byte {
	return append([]byte("\x89PNG\r\n\x1a\n"), []byte("test image")...)
}

func testJPEG() []byte {
	return []byte{0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'J', 'F', 'I', 'F', 0, 0x01, 0x02, 0x03}
}

type fakeClipboard struct {
	image    []byte
	imageErr error
	files    []string
	filesErr error
}

func (c fakeClipboard) Image() ([]byte, error) {
	return c.image, c.imageErr
}

func (c fakeClipboard) Files() ([]string, error) {
	return c.files, c.filesErr
}

func testAssets(workspace *Workspace, clipboard clipboardSource) *Assets {
	assets := NewAssets(workspace)
	assets.now = func() time.Time {
		return time.Date(2026, time.November, 1, 12, 0, 0, 0, time.Local)
	}
	assets.clipboard = clipboard
	return assets
}

func pastePNG(assets *Assets, docPath string, generation int) ([]SavedImage, error) {
	return assets.PasteImage(docPath, generation)
}

func pngClipboard() fakeClipboard {
	return fakeClipboard{image: testPNG()}
}

func TestPasteImageSavesPNGInAssets(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "notes", "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, pngClipboard())

	images, err := pastePNG(assets, "notes/chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 {
		t.Fatalf("PasteImage() returned %d images, want 1", len(images))
	}
	if want := "assets/image-20261101-120000.png"; images[0].Path != want {
		t.Errorf("Path = %q, want %q", images[0].Path, want)
	}
	if want := "![](../assets/image-20261101-120000.png)"; images[0].Markdown != want {
		t.Errorf("Markdown = %q, want %q", images[0].Markdown, want)
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

	images, err := testAssets(workspace, pngClipboard()).PasteImage("chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if want := "![](assets/image-20261101-120000.png)"; images[0].Markdown != want {
		t.Errorf("Markdown = %q, want %q", images[0].Markdown, want)
	}
}

func TestPasteImageRenamesCollisions(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, pngClipboard())

	for _, want := range []string{
		"assets/image-20261101-120000.png",
		"assets/image-20261101-120000-2.png",
		"assets/image-20261101-120000-3.png",
	} {
		images, err := assets.PasteImage("chapter.md", currentGeneration(workspace))
		if err != nil {
			t.Fatal(err)
		}
		if images[0].Path != want {
			t.Errorf("Path = %q, want %q", images[0].Path, want)
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

	_, err := testAssets(workspace, pngClipboard()).PasteImage("chapter.md", stale)
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

	if _, err := testAssets(workspace, fakeClipboard{}).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errNoClipboardImage) {
		t.Errorf("PasteImage() without an image = %v, want %v", err, errNoClipboardImage)
	}
	if _, err := testAssets(workspace, fakeClipboard{image: []byte("not png")}).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errUnsupportedImage) {
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
		if _, err := testAssets(workspace, pngClipboard()).PasteImage(doc, currentGeneration(workspace)); err == nil {
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

	if _, err := testAssets(workspace, pngClipboard()).PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, errAssetsNotFolder) {
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
	assets := testAssets(workspace, pngClipboard())
	linkFailed := errors.New("link failed")
	assets.write = func(root *os.Root, target string, data []byte, mode fs.FileMode) error {
		return writeNewWorkspaceFileWith(root, target, data, mode, func(*os.Root, string, string) error {
			return linkFailed
		})
	}

	if _, err := assets.PasteImage("chapter.md", currentGeneration(workspace)); !errors.Is(err, linkFailed) {
		t.Fatalf("PasteImage() = %v, want %v", err, linkFailed)
	}
	entries, err := os.ReadDir(filepath.Join(root, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("failed save left files: %v", entries)
	}
}

func TestPasteImageUsesClipboardFilesBeforeBitmap(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	source := filepath.Join(t.TempDir(), "copied.JPG")
	mustWriteFile(t, source, testJPEG())

	assets := testAssets(workspace, fakeClipboard{
		image: testPNG(),
		files: []string{source},
	})
	images, err := assets.PasteImage("chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/copied.jpg" {
		t.Errorf("PasteImage() = %+v, want the copied jpg", images)
	}
	data, err := os.ReadFile(filepath.Join(root, "assets", "copied.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, testJPEG()) {
		t.Errorf("saved bytes = %q, want the source bytes", data)
	}
}

func TestPasteImageFallsBackToBitmapForNonImageFiles(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	text := filepath.Join(t.TempDir(), "notes.txt")
	mustWriteFile(t, text, []byte("text"))

	assets := testAssets(workspace, fakeClipboard{
		image: testPNG(),
		files: []string{text},
	})
	images, err := assets.PasteImage("chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/image-20261101-120000.png" {
		t.Errorf("PasteImage() = %+v, want the bitmap fallback", images)
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

	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{source, text})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	images, err := assets.ImportImages("notes/chapter.md", currentGeneration(workspace), token)
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

	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{first, second})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	images, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token)
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
	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{source})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	if _, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token); !errors.Is(err, errUnsupportedImage) {
		t.Fatalf("ImportImages() = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("invalid import created assets: %v", err)
	}
}

func TestImportImagesReadsEveryFileBeforeWriting(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	good := filepath.Join(t.TempDir(), "good.png")
	mustWriteFile(t, good, testPNG())
	bad := filepath.Join(t.TempDir(), "bad.png")
	mustWriteFile(t, bad, []byte("not an image"))

	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{good, bad})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	if _, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token); !errors.Is(err, errUnsupportedImage) {
		t.Fatalf("ImportImages() = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("failed batch created assets: %v", err)
	}
}

func TestImportImagesRejectsSymlinkSources(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	outsideImage := filepath.Join(outside, "outside.png")
	mustWriteFile(t, outsideImage, testPNG())
	link := filepath.Join(t.TempDir(), "link.png")
	if err := os.Symlink(outsideImage, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{link})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	if _, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token); !errors.Is(err, errUnsupportedImage) {
		t.Fatalf("ImportImages() = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("symlink import created assets: %v", err)
	}
}

func TestImportImagesAcceptsSVG(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	source := filepath.Join(t.TempDir(), "diagram.svg")
	mustWriteFile(t, source, []byte(`<?xml version="1.0"?><!-- drawing --><svg xmlns="http://www.w3.org/2000/svg"></svg>`))
	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{source})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	images, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/diagram.svg" {
		t.Errorf("ImportImages() = %+v, want one assets/diagram.svg", images)
	}
}

func TestImportImagesRejectsSVGWithAnotherRoot(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)

	source := filepath.Join(t.TempDir(), "fake.svg")
	mustWriteFile(t, source, []byte("\xef\xbb\xbf<?xml version=\"1.0\"?><!-- note -->\n<html><svg></svg></html>"))
	assets := testAssets(workspace, fakeClipboard{})
	token, ok := assets.acceptDrop([]string{source})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	if _, err := assets.ImportImages("chapter.md", currentGeneration(workspace), token); !errors.Is(err, errUnsupportedImage) {
		t.Fatalf("ImportImages() = %v, want %v", err, errUnsupportedImage)
	}
	if _, err := os.Stat(filepath.Join(root, "assets")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("fake svg created assets: %v", err)
	}
}

func TestDropTokensAreOneTimeAndExpire(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	source := filepath.Join(t.TempDir(), "photo.png")
	mustWriteFile(t, source, testPNG())

	assets := testAssets(workspace, fakeClipboard{})
	generation := currentGeneration(workspace)

	token, ok := assets.acceptDrop([]string{source})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	if _, err := assets.ImportImages("chapter.md", generation, "unknown"); !errors.Is(err, errDropToken) {
		t.Errorf("unknown token = %v, want %v", err, errDropToken)
	}
	if _, err := assets.ImportImages("chapter.md", generation, token); err != nil {
		t.Fatal(err)
	}
	if _, err := assets.ImportImages("chapter.md", generation, token); !errors.Is(err, errDropToken) {
		t.Errorf("reused token = %v, want %v", err, errDropToken)
	}

	assets.now = func() time.Time {
		return time.Date(2026, time.November, 1, 12, 0, 11, 0, time.Local)
	}
	token, ok = assets.acceptDrop([]string{source})
	if !ok {
		t.Fatal("acceptDrop() failed")
	}
	assets.now = func() time.Time {
		return time.Date(2026, time.November, 1, 12, 0, 22, 0, time.Local)
	}
	if _, err := assets.ImportImages("chapter.md", generation, token); !errors.Is(err, errDropToken) {
		t.Errorf("expired token = %v, want %v", err, errDropToken)
	}

	entries, err := os.ReadDir(filepath.Join(root, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("assets contains %d files, want only the first import", len(entries))
	}
}

func TestConcurrentPastesDoNotOverwrite(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	first := testAssets(workspace, fakeClipboard{image: append(testPNG(), []byte("one")...)})
	second := testAssets(workspace, fakeClipboard{image: append(testPNG(), []byte("two")...)})
	baseWrite := first.write
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	barrier := func(root *os.Root, target string, data []byte, mode fs.FileMode) error {
		entered <- struct{}{}
		<-release
		return baseWrite(root, target, data, mode)
	}
	first.write = barrier
	second.write = barrier

	var wait sync.WaitGroup
	wait.Add(2)
	errorsSeen := make(chan error, 2)
	go func() {
		defer wait.Done()
		_, err := first.PasteImage("chapter.md", generation)
		errorsSeen <- err
	}()
	go func() {
		defer wait.Done()
		_, err := second.PasteImage("chapter.md", generation)
		errorsSeen <- err
	}()
	<-entered
	<-entered
	close(release)
	wait.Wait()
	close(errorsSeen)
	for err := range errorsSeen {
		if err != nil {
			t.Fatal(err)
		}
	}

	entries, err := os.ReadDir(filepath.Join(root, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("assets contains %d files, want 2", len(entries))
	}
	contents := map[string]bool{}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(root, "assets", entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		contents[string(data)] = true
	}
	if len(contents) != 2 {
		t.Errorf("files do not contain both pastes: %v", contents)
	}
}

func TestImageRelativePathUsesCallerDocumentPath(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "deep", "nested", "real.md"), []byte("# Real"))
	if err := os.Symlink(filepath.Join("deep", "nested", "real.md"), filepath.Join(root, "link.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	workspace := openTestWorkspace(t, root)
	assets := testAssets(workspace, pngClipboard())

	images, err := assets.PasteImage("link.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if want := "![](assets/image-20261101-120000.png)"; images[0].Markdown != want {
		t.Errorf("Markdown = %q, want %q based on the caller path", images[0].Markdown, want)
	}
}

func TestSVGDetection(t *testing.T) {
	for _, test := range []struct {
		name string
		data string
		want bool
	}{
		{"plain", `<svg></svg>`, true},
		{"xml and comment", "\xef\xbb\xbf<?xml version=\"1.0\"?>\n<!-- x -->\n<svg version=\"1.1\"></svg>", true},
		{"doctype", `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>`, true},
		{"html wrapper", `<html><svg></svg></html>`, false},
		{"prefix only", `<svgx></svgx>`, false},
		{"script before svg", `<script>alert(1)</script><svg></svg>`, false},
		{"unterminated declaration", `<?xml version="1.0"`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := isSVG([]byte(test.data)); got != test.want {
				t.Errorf("isSVG(%q) = %v, want %v", test.data, got, test.want)
			}
		})
	}
}

func TestSanitizeImageBase(t *testing.T) {
	for _, test := range []struct{ name, want string }{
		{"photo", "photo"},
		{"my photo", "my-photo"},
		{"a:b*c?", "a-b-c"},
		{"  ..name..  ", "name"},
		{"照片", "照片"},
		{"line\nbreak", "line-break"},
		{strings.Repeat("a", 80), strings.Repeat("a", 60)},
	} {
		if got := sanitizeImageBase(test.name); got != test.want {
			t.Errorf("sanitizeImageBase(%q) = %q, want %q", test.name, got, test.want)
		}
	}
}

func TestAssetDropHandlerEmitsTokenAndImports(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	workspace := openTestWorkspace(t, root)
	source := filepath.Join(t.TempDir(), "photo.png")
	mustWriteFile(t, source, testPNG())

	assets := testAssets(workspace, fakeClipboard{})
	var emitted AssetDrop
	handler := newAssetDropHandler(assets, func(drop AssetDrop) error {
		emitted = drop
		return nil
	})
	handler(&mygo.FileDropEvent{Paths: []string{source}, X: 12, Y: 34})

	if emitted.Token == "" {
		t.Fatal("drop handler emitted no token")
	}
	if emitted.X != 12 || emitted.Y != 34 {
		t.Errorf("emitted position = (%d, %d), want (12, 34)", emitted.X, emitted.Y)
	}
	images, err := assets.ImportImages("chapter.md", currentGeneration(workspace), emitted.Token)
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/photo.png" {
		t.Errorf("ImportImages() = %+v, want assets/photo.png", images)
	}
}
