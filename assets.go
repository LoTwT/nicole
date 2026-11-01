package main

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
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
)

var (
	errNoClipboardImage = errors.New("assets: no image in the clipboard")
	errUnsupportedImage = errors.New("assets: unsupported image")
	errAssetsNotFolder  = errors.New("assets: assets is not a regular folder")
)

// SavedImage is an image added to the workspace. Path is relative to the
// workspace root; Markdown is the image syntax relative to the document that
// asked for it.
type SavedImage struct {
	Path     string `json:"path"`
	Markdown string `json:"markdown"`
}

// Assets saves images next to the workspace root and reads the system
// clipboard and dropped files in Go, so image bytes never cross the IPC
// boundary. `mygo generate` turns its methods into typed functions in
// src/services/mygo.ts.
type Assets struct {
	workspace *Workspace

	now       func() time.Time
	clipboard func() ([]byte, error)
	write     func(*os.Root, string, []byte, fs.FileMode) error
}

// NewAssets returns the image service for workspace.
func NewAssets(workspace *Workspace) *Assets {
	return &Assets{
		workspace: workspace,
		now:       time.Now,
		clipboard: func() ([]byte, error) {
			data, err := mygo.Clipboard.ReadFormat(transfer.PNG)
			if errors.Is(err, transfer.ErrFormat) {
				return nil, errNoClipboardImage
			}
			return data, err
		},
		write: writeWorkspaceFile,
	}
}

// PasteImage saves the image from the system clipboard as a new file in the
// workspace's assets folder and returns Markdown that refers to it from
// docPath. generation is the value ChooseFolder returned for that folder; an
// image prepared for an earlier folder is refused.
func (a *Assets) PasteImage(docPath string, generation int) (SavedImage, error) {
	data, err := a.clipboard()
	if err != nil {
		return SavedImage{}, err
	}
	if len(data) == 0 {
		return SavedImage{}, errNoClipboardImage
	}
	if !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		return SavedImage{}, fmt.Errorf("%w: clipboard data is not PNG", errUnsupportedImage)
	}
	return a.saveImage(docPath, generation, "", ".png", data)
}

// ImportImages copies image files that were dropped on the editor into the
// workspace's assets folder and returns Markdown that refers to them from
// docPath. Files without an image extension are ignored.
func (a *Assets) ImportImages(docPath string, generation int, sources []string) ([]SavedImage, error) {
	root, current := a.workspace.state.snapshot()
	if root == "" {
		return nil, errNoWorkspace
	}
	if generation != current {
		return nil, fmt.Errorf("%w: got generation %d, want %d", errWorkspaceChange, generation, current)
	}

	images := make([]SavedImage, 0, len(sources))
	for _, source := range sources {
		ext := strings.ToLower(filepath.Ext(source))
		if _, ok := imageContentTypes[ext]; !ok {
			continue
		}
		data, err := readDroppedImage(source)
		if err != nil {
			return nil, err
		}
		base := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
		image, err := a.saveImageIn(root, docPath, sanitizeImageBase(base), ext, data)
		if err != nil {
			return nil, err
		}
		images = append(images, image)
	}
	return images, nil
}

func (a *Assets) saveImage(docPath string, generation int, base, ext string, data []byte) (SavedImage, error) {
	root, current := a.workspace.state.snapshot()
	if root == "" {
		return SavedImage{}, errNoWorkspace
	}
	if generation != current {
		return SavedImage{}, fmt.Errorf("%w: got generation %d, want %d", errWorkspaceChange, generation, current)
	}
	return a.saveImageIn(root, docPath, base, ext, data)
}

// saveImageIn writes an already validated image below root. The caller has
// checked generation and root.
func (a *Assets) saveImageIn(root, docPath, base, ext string, data []byte) (SavedImage, error) {
	doc, err := resolveExistingFile(root, docPath)
	if err != nil {
		return SavedImage{}, err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return SavedImage{}, err
	}
	defer rootFS.Close()

	if err := ensureAssetsFolder(rootFS); err != nil {
		return SavedImage{}, err
	}
	name, err := a.uniqueAssetName(rootFS, base, ext)
	if err != nil {
		return SavedImage{}, err
	}
	target := path.Join(assetsFolder, name)
	if err := a.write(rootFS, target, data, 0); err != nil {
		return SavedImage{}, err
	}

	markdownPath, err := markdownImagePath(doc, target)
	if err != nil {
		return SavedImage{}, err
	}
	return SavedImage{
		Path:     target,
		Markdown: "![](" + markdownPath + ")",
	}, nil
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

func (a *Assets) uniqueAssetName(root *os.Root, base, ext string) (string, error) {
	if base == "" {
		base = "image-" + a.now().Format(imageNameStampFormat)
	}
	for suffix := 1; suffix <= 1000; suffix++ {
		name := base
		if suffix > 1 {
			name += "-" + fmt.Sprint(suffix)
		}
		name += ext
		if _, err := root.Lstat(filepath.FromSlash(path.Join(assetsFolder, name))); errors.Is(err, fs.ErrNotExist) {
			return name, nil
		} else if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("assets: too many files named %q", base)
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

func readDroppedImage(source string) ([]byte, error) {
	info, err := os.Stat(source)
	if err != nil {
		return nil, err
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
	if !looksLikeImage(data) {
		return nil, fmt.Errorf("%w: %q", errUnsupportedImage, source)
	}
	return data, nil
}

// looksLikeImage rejects files whose extension claims an image but whose
// bytes are something else. SVG is text, so its check is the root element.
func looksLikeImage(data []byte) bool {
	trimmed := bytes.TrimSpace(data)
	if bytes.Contains(trimmed, []byte("<svg")) || bytes.Contains(trimmed, []byte("<SVG")) {
		return true
	}
	return strings.HasPrefix(http.DetectContentType(data), "image/")
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
