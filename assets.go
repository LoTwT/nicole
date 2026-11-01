package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

const (
	assetsFolder = "assets"
	// A screenshot or photo larger than this is more likely a mistake than
	// something the editor should load and hold in memory.
	maxImageBytes = 64 << 20
	// imageNameStampFormat keeps pasted screenshots distinct without random
	// names; collisions within the same second get a numeric suffix.
	imageNameStampFormat = "20060102-150405"

	// dropTokenLifetime bounds how long a page may claim a native file drop.
	// The page receives the token immediately with the drop event.
	dropTokenLifetime = 10 * time.Second
)

var (
	errNoClipboardImage = errors.New("assets: no image in the clipboard")
	errUnsupportedImage = errors.New("assets: unsupported image")
	errAssetsNotFolder  = errors.New("assets: assets is not a regular folder")
	errDropToken        = errors.New("assets: unknown or expired drop token")
	errAssetNameTaken   = errors.New("assets: image name already exists")
)

// AssetDrop tells the page that native files were dropped and names the
// one-time token that lets it import them. The paths stay in Go.
type AssetDrop struct {
	Token string `json:"token"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
}

// assetFileDrop is emitted to the page after Window.OnFileDrop receives
// paths. The page uses the coordinates to place the insertion.
var assetFileDrop = mygo.NewEvent[AssetDrop]("assets:file-drop")

// newAssetDropHandler turns a native drop into a page event. Paths stay in
// Assets; the page receives only a one-time token and the drop position.
func newAssetDropHandler(assets *Assets, emit func(AssetDrop) error) func(*mygo.FileDropEvent) {
	return func(drop *mygo.FileDropEvent) {
		token, ok := assets.acceptDrop(drop.Paths)
		if !ok {
			return
		}
		_ = emit(AssetDrop{Token: token, X: drop.X, Y: drop.Y})
	}
}

// clipboardSource reads image data and local file paths from the system
// clipboard. It is an interface so tests never touch the real clipboard.
type clipboardSource interface {
	Image() ([]byte, error)
	Files() ([]string, error)
}

type systemClipboard struct{}

func (systemClipboard) Image() ([]byte, error) {
	data, err := mygo.Clipboard.ReadFormat(transfer.PNG)
	if errors.Is(err, transfer.ErrFormat) {
		return nil, errNoClipboardImage
	}
	return data, err
}

func (systemClipboard) Files() ([]string, error) {
	return mygo.Clipboard.ReadFiles()
}

// SavedImage is an image added to the workspace. Path is relative to the
// workspace root; Markdown is the image syntax relative to the document that
// asked for it.
type SavedImage struct {
	Path     string `json:"path"`
	Markdown string `json:"markdown"`
}

type droppedPaths struct {
	paths   []string
	expires time.Time
}

// Assets saves images next to the workspace root and reads the system
// clipboard and native file drops in Go, so image bytes and page-untrusted
// paths never cross the IPC boundary. `mygo generate` turns its methods into
// typed functions in src/services/mygo.ts.
type Assets struct {
	workspace *Workspace

	now       func() time.Time
	clipboard clipboardSource
	write     func(*os.Root, string, []byte, fs.FileMode) error
	dropTTL   time.Duration

	mu    sync.Mutex
	drops map[string]droppedPaths
}

// NewAssets returns the image service for workspace.
func NewAssets(workspace *Workspace) *Assets {
	return &Assets{
		workspace: workspace,
		now:       time.Now,
		clipboard: systemClipboard{},
		write:     writeNewWorkspaceFile,
		dropTTL:   dropTokenLifetime,
		drops:     map[string]droppedPaths{},
	}
}

// acceptDrop stores the paths of a native file drop and returns a one-time
// token for the page. It is called from Window.OnFileDrop, not from the page.
func (a *Assets) acceptDrop(paths []string) (string, bool) {
	if len(paths) == 0 {
		return "", false
	}
	var random [16]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", false
	}
	token := hex.EncodeToString(random[:])
	now := a.now()

	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneDropsLocked(now)
	a.drops[token] = droppedPaths{
		paths:   append([]string(nil), paths...),
		expires: now.Add(a.dropTTL),
	}
	return token, true
}

func (a *Assets) takeDrop(token string) ([]string, error) {
	now := a.now()
	a.mu.Lock()
	defer a.mu.Unlock()
	a.pruneDropsLocked(now)
	drop, ok := a.drops[token]
	if !ok || !now.Before(drop.expires) {
		delete(a.drops, token)
		return nil, errDropToken
	}
	delete(a.drops, token)
	return drop.paths, nil
}

func (a *Assets) pruneDropsLocked(now time.Time) {
	for token, drop := range a.drops {
		if !now.Before(drop.expires) {
			delete(a.drops, token)
		}
	}
}

type pendingImage struct {
	base string
	ext  string
	data []byte
}

// PasteImage saves an image from the system clipboard. If the clipboard
// contains local image files, as after copying them in Finder or Explorer,
// those files are imported instead of a bitmap representation. generation is
// the value ChooseFolder returned for that folder.
func (a *Assets) PasteImage(docPath string, generation int) ([]SavedImage, error) {
	root, err := a.currentRoot(generation)
	if err != nil {
		return nil, err
	}
	if files, err := a.clipboard.Files(); err == nil {
		if pending, err := readImages(files); err != nil {
			return nil, err
		} else if len(pending) > 0 {
			return a.saveImages(root, docPath, pending)
		}
	}

	data, err := a.clipboard.Image()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errNoClipboardImage
	}
	if !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		return nil, fmt.Errorf("%w: clipboard data is not PNG", errUnsupportedImage)
	}
	return a.saveImages(root, docPath, []pendingImage{{base: "", ext: ".png", data: data}})
}

// ImportImages copies the image files of a native drop into the workspace's
// assets folder. The page passes the one-time drop token instead of paths, so
// it cannot make Go read a file the user did not drop. Files without an image
// extension are ignored.
func (a *Assets) ImportImages(docPath string, generation int, dropToken string) ([]SavedImage, error) {
	root, err := a.currentRoot(generation)
	if err != nil {
		return nil, err
	}
	paths, err := a.takeDrop(dropToken)
	if err != nil {
		return nil, err
	}
	pending, err := readImages(paths)
	if err != nil {
		return nil, err
	}
	if len(pending) == 0 {
		return []SavedImage{}, nil
	}
	return a.saveImages(root, docPath, pending)
}

func (a *Assets) currentRoot(generation int) (string, error) {
	root, current := a.workspace.state.snapshot()
	if root == "" {
		return "", errNoWorkspace
	}
	if generation != current {
		return "", fmt.Errorf("%w: got generation %d, want %d", errWorkspaceChange, generation, current)
	}
	return root, nil
}

// saveImages validates the document once, then writes every image. All
// sources are read before the first write; a failed write removes images
// already added by this call, so a rejected batch leaves no partial batch.
func (a *Assets) saveImages(root, docPath string, pending []pendingImage) ([]SavedImage, error) {
	// The caller-visible path defines the relative Markdown base. Resolving it
	// only validates the document; a symlink must not change the base.
	if _, err := resolveExistingFile(root, docPath); err != nil {
		return nil, err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer rootFS.Close()
	if err := ensureAssetsFolder(rootFS); err != nil {
		return nil, err
	}

	images := make([]SavedImage, 0, len(pending))
	for _, image := range pending {
		saved, err := a.saveImage(rootFS, docPath, image)
		if err != nil {
			for _, written := range images {
				_ = rootFS.Remove(filepath.FromSlash(written.Path))
			}
			return nil, err
		}
		images = append(images, saved)
	}
	return images, nil
}

func (a *Assets) saveImage(root *os.Root, docPath string, image pendingImage) (SavedImage, error) {
	for suffix := 1; suffix <= 1000; suffix++ {
		name := a.assetName(image.base, image.ext, suffix)
		target := path.Join(assetsFolder, name)
		err := a.write(root, target, image.data, 0)
		if errors.Is(err, errAssetNameTaken) {
			continue
		}
		if err != nil {
			return SavedImage{}, err
		}
		markdownPath, err := markdownImagePath(docPath, target)
		if err != nil {
			_ = root.Remove(filepath.FromSlash(target))
			return SavedImage{}, err
		}
		return SavedImage{
			Path:     target,
			Markdown: "![](" + markdownPath + ")",
		}, nil
	}
	return SavedImage{}, fmt.Errorf("assets: too many files named %q", image.base)
}

func (a *Assets) assetName(base, ext string, suffix int) string {
	if base == "" {
		base = "image-" + a.now().Format(imageNameStampFormat)
	}
	if suffix > 1 {
		base += "-" + fmt.Sprint(suffix)
	}
	return base + ext
}

// ensureAssetsFolder creates the assets folder when it is missing. A symlink
// is refused: writes must land in a real folder below the workspace, not
// wherever a link points.
func ensureAssetsFolder(root *os.Root) error {
	info, err := root.Lstat(assetsFolder)
	if err == nil {
		if info.Mode()&fs.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("%w: %q", errAssetsNotFolder, assetsFolder)
		}
		return nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err := root.Mkdir(assetsFolder, 0o777); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	return nil
}

// readImages filters sources by extension and reads every image before any
// file is written. Source symlinks are refused: a dropped link must not make
// Go read a file outside the user's selection.
func readImages(sources []string) ([]pendingImage, error) {
	pending := make([]pendingImage, 0, len(sources))
	for _, source := range sources {
		ext := strings.ToLower(filepath.Ext(source))
		if _, ok := imageContentTypes[ext]; !ok {
			continue
		}
		data, err := readImageFile(source, ext)
		if err != nil {
			return nil, err
		}
		base := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
		pending = append(pending, pendingImage{
			base: sanitizeImageBase(base),
			ext:  ext,
			data: data,
		})
	}
	return pending, nil
}

func readImageFile(source, ext string) ([]byte, error) {
	info, err := os.Lstat(source)
	if err != nil {
		return nil, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return nil, fmt.Errorf("%w: %q is a symbolic link", errUnsupportedImage, source)
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("%w: %q is not a file", errUnsupportedImage, source)
	}
	if info.Size() > maxImageBytes {
		return nil, fmt.Errorf("%w: %q is too large", errUnsupportedImage, source)
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return nil, err
	}
	if !looksLikeImage(data, ext) {
		return nil, fmt.Errorf("%w: %q", errUnsupportedImage, source)
	}
	return data, nil
}

// looksLikeImage rejects files whose extension claims an image but whose
// bytes are something else. SVG is text, so its root element is checked after
// any BOM, XML declaration and comments.
func looksLikeImage(data []byte, ext string) bool {
	if ext == ".svg" {
		return isSVG(data)
	}
	return strings.HasPrefix(http.DetectContentType(data), "image/")
}

func isSVG(data []byte) bool {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	data = bytes.TrimSpace(data)
	for {
		lower := bytes.ToLower(data)
		switch {
		case bytes.HasPrefix(lower, []byte("<?xml")):
			end := bytes.Index(data, []byte("?>"))
			if end < 0 {
				return false
			}
			data = bytes.TrimSpace(data[end+2:])
		case bytes.HasPrefix(data, []byte("<!--")):
			end := bytes.Index(data, []byte("-->"))
			if end < 0 {
				return false
			}
			data = bytes.TrimSpace(data[end+3:])
		case bytes.HasPrefix(lower, []byte("<!doctype")):
			end := bytes.IndexByte(data, '>')
			if end < 0 {
				return false
			}
			data = bytes.TrimSpace(data[end+1:])
		default:
			lower = bytes.ToLower(data)
			if !bytes.HasPrefix(lower, []byte("<svg")) {
				return false
			}
			if len(data) == 4 {
				return false
			}
			switch data[4] {
			case '>', '/', ' ', '\t', '\r', '\n':
				return true
			}
			return false
		}
	}
}

// sanitizeImageBase keeps dropped file names readable while removing
// characters that are unsafe in paths or awkward in Markdown links. Windows
// reserved characters are removed on every platform so a name behaves the
// same everywhere.
func sanitizeImageBase(name string) string {
	var cleaned strings.Builder
	lastDash := false
	for _, r := range name {
		switch {
		case r == '/' || r == '\\' || r == ':' || r == '*' || r == '?' ||
			r == '"' || r == '<' || r == '>' || r == '|':
			if !lastDash {
				cleaned.WriteByte('-')
				lastDash = true
			}
		case r == ' ' || r == '\t' || r < 0x20 || r == 0x7f:
			if !lastDash {
				cleaned.WriteByte('-')
				lastDash = true
			}
		default:
			cleaned.WriteRune(r)
			lastDash = false
		}
	}
	cleanedName := strings.Trim(cleaned.String(), " .-")
	runes := []rune(cleanedName)
	if len(runes) > 60 {
		cleanedName = string(runes[:60])
		cleanedName = strings.TrimRight(cleanedName, " .-")
	}
	return cleanedName
}

// markdownImagePath returns imagePath relative to the folder of docPath, in
// the slash form Markdown uses, with each segment escaped for a link.
func markdownImagePath(docPath, imagePath string) (string, error) {
	relative, err := filepath.Rel(filepath.Dir(filepath.FromSlash(docPath)), filepath.FromSlash(imagePath))
	if err != nil {
		return "", err
	}
	parts := strings.Split(filepath.ToSlash(relative), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}
	return strings.Join(parts, "/"), nil
}

// resolveExistingImage resolves a path relative to root to an existing image
// below it, after following symlinks inside the workspace. The same checks as
// the Markdown file guard apply: no escaping the root, hidden folders or
// node_modules, and only allowed image extensions.
func resolveExistingImage(root, rel string) (string, error) {
	if err := validateImagePath(rel); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	target := relativeToRoot(root, resolved)
	if target == "" {
		return "", errPathOutside
	}
	if err := validateImagePath(target); err != nil {
		return "", err
	}
	return target, nil
}

func validateImagePath(rel string) error {
	if err := validateRelativePath(rel); err != nil {
		return err
	}
	if _, ok := imageContentType(rel); !ok {
		return fmt.Errorf("%w: %q", errUnsupportedImage, rel)
	}
	dir := path.Dir(rel)
	if dir == "." {
		return nil
	}
	for _, part := range strings.Split(dir, "/") {
		if ignoredFolder(part) {
			return fmt.Errorf("%w: %q", errIgnoredFolder, rel)
		}
	}
	return nil
}

// writeNewWorkspaceFile writes data to a new file without replacing an
// existing one. The temporary file gets its final bytes first; Link then
// publishes it only when the name is still free. A taken name is reported as
// errAssetNameTaken so the caller can try the next suffix.
func writeNewWorkspaceFile(root *os.Root, target string, data []byte, mode fs.FileMode) error {
	return writeNewWorkspaceFileWith(root, target, data, mode, func(root *os.Root, oldName, newName string) error {
		return root.Link(oldName, newName)
	})
}

func writeNewWorkspaceFileWith(root *os.Root, target string, data []byte, mode fs.FileMode, link func(*os.Root, string, string) error) (err error) {
	tempName, err := newTempFileName()
	if err != nil {
		return err
	}
	dir := path.Dir(target)
	temp := path.Join(dir, tempName)
	tempPath := filepath.FromSlash(temp)
	targetPath := filepath.FromSlash(target)

	tmp, err := root.OpenFile(tempPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = root.Remove(tempPath)
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
	if mode != 0 {
		if err = root.Chmod(tempPath, mode.Perm()); err != nil {
			return err
		}
	}
	if err = link(root, tempPath, targetPath); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return fmt.Errorf("%w: %v", errAssetNameTaken, err)
		}
		return err
	}
	if err = root.Remove(tempPath); err != nil {
		return err
	}
	return syncRootDirectory(root, dir)
}
