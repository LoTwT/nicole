package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/egoist/mygo"
)

var (
	errTargetExists = errors.New("workspace: an item with that name already exists")
	errExcluded     = errors.New("workspace: hidden system item")
	errSymlinkEntry = errors.New("workspace: symbolic links are not listed or changed")
	errNotFolder    = errors.New("workspace: not a folder")
	errNotRegular   = errors.New("workspace: not a regular file")
)

// FileEntry is one item of a folder in the workspace tree. Path is relative
// to the workspace root and separated by slashes.
type FileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	IsDir      bool   `json:"isDir"`
	IsMarkdown bool   `json:"isMarkdown"`
	Size       int64  `json:"size"`
}

// DirectoryListing is one folder of the workspace tree. Path is "." for the
// root and is otherwise relative to it.
type DirectoryListing struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

// System actions are variables so tests can check the path guard without
// opening a file manager or the trash.
var (
	trashWorkspaceItem  = func(absPath string) error { return mygo.Shell.TrashItem(absPath) }
	revealWorkspaceItem = func(absPath string) {
		mygo.Shell.ShowItemInFolder(absPath)
	}
	openWorkspaceItem = func(absPath string) error { return mygo.Shell.OpenPath(absPath) }
)

// ListDirectory reads one level of the workspace tree: every file and folder
// there, including empty folders and files that are not Markdown. It does not
// recurse, so opening a folder with node_modules stays cheap. `.git`,
// `.DS_Store`, `Thumbs.db`, `desktop.ini` and this app's temporary files are
// left out; other names starting with a dot and node_modules are listed.
func (w *Workspace) ListDirectory(rel string) (DirectoryListing, error) {
	root, _ := w.state.snapshot()
	if root == "" {
		return DirectoryListing{}, errNoWorkspace
	}
	dir := normalizeTreeDir(rel)
	if dir != "." {
		if _, _, err := resolveTreeEntry(root, dir); err != nil {
			return DirectoryListing{}, err
		}
	}

	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return DirectoryListing{}, err
	}
	defer rootFS.Close()

	items, err := fs.ReadDir(rootFS.FS(), dir)
	if err != nil {
		return DirectoryListing{}, err
	}
	entries := make([]FileEntry, 0, len(items))
	for _, item := range items {
		name := item.Name()
		if item.Type()&fs.ModeSymlink != 0 {
			continue
		}
		isDir := item.IsDir()
		if !isDir && !item.Type().IsRegular() {
			continue
		}
		if excludedTreeEntry(name) {
			continue
		}
		info, err := item.Info()
		if err != nil {
			return DirectoryListing{}, err
		}
		relative := name
		if dir != "." {
			relative = path.Join(dir, name)
		}
		entries = append(entries, FileEntry{
			Name:       name,
			Path:       relative,
			IsDir:      isDir,
			IsMarkdown: !isDir && isMarkdownName(name),
			Size:       info.Size(),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name < entries[j].Name })
	return DirectoryListing{Path: dir, Entries: entries}, nil
}

// CreateFile creates an empty Markdown file in dir. A name without an
// extension gets ".md", as the file tree promises; other extensions are
// refused because this action only creates notes.
func (w *Workspace) CreateFile(dir, name string, generation int) (string, error) {
	root, err := w.currentRoot(generation)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(name) == "" {
		return "", fmt.Errorf("workspace: invalid name: %q", name)
	}
	if filepath.Ext(name) == "" {
		name += ".md"
	}
	if !isMarkdownName(name) {
		return "", fmt.Errorf("%w: %q", errNotMarkdown, name)
	}
	target, err := resolveNewTreeEntry(root, dir, name)
	if err != nil {
		return "", err
	}

	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer rootFS.Close()

	// Record the write before creating the file: the watch can report it as
	// soon as it exists, and the page may receive that batch before this call
	// returns.
	w.writes.record(target, nil)
	file, err := rootFS.OpenFile(filepath.FromSlash(target), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o666)
	if err != nil {
		w.writes.forget(target)
		if errors.Is(err, fs.ErrExist) {
			return "", fmt.Errorf("%w: %q", errTargetExists, target)
		}
		return "", err
	}
	if err := file.Close(); err != nil {
		w.writes.forget(target)
		_ = rootFS.Remove(filepath.FromSlash(target))
		return "", err
	}
	if err := syncRootDirectory(rootFS, path.Dir(target)); err != nil {
		return "", err
	}
	return target, nil
}

// CreateFolder creates a folder in dir.
func (w *Workspace) CreateFolder(dir, name string, generation int) (string, error) {
	root, err := w.currentRoot(generation)
	if err != nil {
		return "", err
	}
	target, err := resolveNewTreeEntry(root, dir, name)
	if err != nil {
		return "", err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer rootFS.Close()
	if err := rootFS.Mkdir(filepath.FromSlash(target), 0o777); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return "", fmt.Errorf("%w: %q", errTargetExists, target)
		}
		return "", err
	}
	if err := syncRootDirectory(rootFS, path.Dir(target)); err != nil {
		return "", err
	}
	return target, nil
}

// RenameEntry renames a file or folder within its folder. name is a bare
// name, not a path. An existing target is refused instead of replaced.
func (w *Workspace) RenameEntry(rel, name string, generation int) (string, error) {
	root, err := w.currentRoot(generation)
	if err != nil {
		return "", err
	}
	source, _, err := resolveTreeEntry(root, rel)
	if err != nil {
		return "", err
	}
	if err := validateTreeName(name); err != nil {
		return "", err
	}
	target := path.Join(path.Dir(source), name)
	if target == source {
		return source, nil
	}
	if err := validateTreePath(target); err != nil {
		return "", err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer rootFS.Close()
	if _, err := rootFS.Lstat(filepath.FromSlash(target)); err == nil {
		return "", fmt.Errorf("%w: %q", errTargetExists, target)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if err := retryRename(func() error {
		return rootFS.Rename(filepath.FromSlash(source), filepath.FromSlash(target))
	}); err != nil {
		if errors.Is(err, fs.ErrExist) {
			return "", fmt.Errorf("%w: %q", errTargetExists, target)
		}
		return "", err
	}
	if err := syncRootDirectory(rootFS, path.Dir(target)); err != nil {
		return "", err
	}
	return target, nil
}

// TrashEntry moves a file or folder to the platform's trash. The trash itself
// reports when it cannot take the item; it never falls back to deleting it.
func (w *Workspace) TrashEntry(rel string, generation int) error {
	root, err := w.currentRoot(generation)
	if err != nil {
		return err
	}
	target, _, err := resolveTreeEntry(root, rel)
	if err != nil {
		return err
	}
	return trashWorkspaceItem(filepath.Join(root, filepath.FromSlash(target)))
}

// OpenWithDefaultApp opens a file with the application the desktop uses for
// it. Folders are refused here; RevealEntry shows them instead.
func (w *Workspace) OpenWithDefaultApp(rel string, generation int) error {
	root, err := w.currentRoot(generation)
	if err != nil {
		return err
	}
	target, info, err := resolveTreeEntry(root, rel)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: %q", errNotRegular, rel)
	}
	return openWorkspaceItem(filepath.Join(root, filepath.FromSlash(target)))
}

// RevealEntry shows a file or folder in the desktop's file manager. The
// workspace root itself may be revealed.
func (w *Workspace) RevealEntry(rel string, generation int) error {
	root, err := w.currentRoot(generation)
	if err != nil {
		return err
	}
	if normalizeTreeDir(rel) == "." {
		revealWorkspaceItem(root)
		return nil
	}
	target, _, err := resolveTreeEntry(root, rel)
	if err != nil {
		return err
	}
	revealWorkspaceItem(filepath.Join(root, filepath.FromSlash(target)))
	return nil
}

// currentRoot returns the workspace root only when generation still names it.
func (w *Workspace) currentRoot(generation int) (string, error) {
	root, current := w.state.snapshot()
	if root == "" {
		return "", errNoWorkspace
	}
	if generation != current {
		return "", fmt.Errorf("%w: got generation %d, want %d", errWorkspaceChange, generation, current)
	}
	return root, nil
}

func normalizeTreeDir(rel string) string {
	if rel == "" || rel == "." {
		return "."
	}
	return rel
}

// resolveTreeEntry checks that rel names an existing file or folder that the
// tree may show or change. It returns the path relative to the root after
// resolving folders above it, so a replaced parent cannot redirect the
// operation outside.
func resolveTreeEntry(root, rel string) (string, fs.FileInfo, error) {
	if err := validateTreePath(rel); err != nil {
		return "", nil, err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", nil, err
	}
	defer rootFS.Close()

	linkInfo, err := rootFS.Lstat(filepath.FromSlash(rel))
	if err != nil {
		return "", nil, err
	}
	if linkInfo.Mode()&fs.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("%w: %q", errSymlinkEntry, rel)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(rel)))
	if err != nil {
		return "", nil, err
	}
	target := relativeToRoot(root, resolved)
	if target == "" {
		return "", nil, errPathOutside
	}
	if err := validateTreePath(target); err != nil {
		return "", nil, err
	}
	info, err := rootFS.Lstat(filepath.FromSlash(target))
	if err != nil {
		return "", nil, err
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return "", nil, fmt.Errorf("%w: %q", errSymlinkEntry, rel)
	}
	if !info.IsDir() && !info.Mode().IsRegular() {
		return "", nil, fmt.Errorf("workspace: not a file or folder: %q", rel)
	}
	return target, info, nil
}

// resolveNewTreeEntry returns where a new item named name goes in dir, after
// checking that dir exists and that nothing is there yet.
func resolveNewTreeEntry(root, dir, name string) (string, error) {
	if err := validateTreeName(name); err != nil {
		return "", err
	}
	dir = normalizeTreeDir(dir)
	dirTarget := dir
	if dir != "." {
		target, info, err := resolveTreeEntry(root, dir)
		if err != nil {
			return "", err
		}
		if !info.IsDir() {
			return "", fmt.Errorf("%w: %q", errNotFolder, dir)
		}
		dirTarget = target
	}
	target := name
	if dirTarget != "." {
		target = path.Join(dirTarget, name)
	}
	if err := validateTreePath(target); err != nil {
		return "", err
	}

	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer rootFS.Close()
	if _, err := rootFS.Lstat(filepath.FromSlash(target)); err == nil {
		return "", fmt.Errorf("%w: %q", errTargetExists, target)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	return target, nil
}

// validateTreePath accepts a path the file tree may show or change. Unlike
// validateWorkspaceFile, it allows hidden folders (except .git), node_modules
// and files that are not Markdown; those are visible in the tree.
func validateTreePath(rel string) error {
	if err := validateRelativePath(rel); err != nil {
		return err
	}
	for _, part := range strings.Split(rel, "/") {
		if excludedTreeEntry(part) {
			return fmt.Errorf("%w: %q", errExcluded, rel)
		}
	}
	return nil
}

// validateTreeName accepts a new bare file or folder name.
func validateTreeName(name string) error {
	if name == "" || name == "." || name == ".." ||
		strings.ContainsRune(name, '/') || strings.ContainsRune(name, '\\') || strings.ContainsRune(name, ':') {
		return fmt.Errorf("workspace: invalid name: %q", name)
	}
	if !fs.ValidPath(name) || !filepath.IsLocal(name) {
		return fmt.Errorf("workspace: invalid name: %q", name)
	}
	return validateTreePath(name)
}

// excludedTreeEntry reports names the file tree never shows: the system's own
// files, .git, and temporary files this app writes.
func excludedTreeEntry(name string) bool {
	switch name {
	case ".git", ".DS_Store", "Thumbs.db", "desktop.ini":
		return true
	}
	return isWorkspaceTempName(name)
}
