package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/watch"
)

// workspaceWatchRoot is the name pages give the file watcher. The watch
// plugin asks watchRoot for its path on every watch, so opening another
// folder replaces the state without registering anything again.
const workspaceWatchRoot = "workspace"

var (
	errNoWorkspace = errors.New("workspace: no folder is open")
	errPathOutside = errors.New("workspace: path is outside the folder")
)

// WorkspaceFolder is the result of choosing a folder. Canceled is true when
// the dialog was dismissed; the other fields are then empty.
type WorkspaceFolder struct {
	// Root is the absolute path of the folder, with symlinks resolved.
	Root     string   `json:"root"`
	Files    []string `json:"files"`
	Canceled bool     `json:"canceled"`
}

// Workspace serves the folder the user opened: its Markdown files, and
// reading and replacing them. `mygo generate` turns the methods into typed
// functions in src/services/mygo.ts.
type Workspace struct {
	state *workspaceState
}

// NewWorkspace returns a workspace with no folder open.
func NewWorkspace() *Workspace {
	return &Workspace{state: &workspaceState{}}
}

// workspaceState is the one current workspace of the process. Services, the
// watch plugin and the protocol handler that follows read it; switching
// folders replaces this state in place, not the registrations that read it.
type workspaceState struct {
	mu   sync.RWMutex
	root string
}

func (s *workspaceState) get() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.root
}

func (s *workspaceState) set(root string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root = root
}

// ChooseFolder shows the native folder picker and makes the chosen folder
// the workspace. A canceled dialog returns Canceled without changing the
// current folder.
func (w *Workspace) ChooseFolder(ctx context.Context) (WorkspaceFolder, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "打开文件夹",
		ButtonLabel: "打开",
		Directory:   true,
	})
	if err != nil {
		return WorkspaceFolder{}, err
	}
	if len(paths) == 0 {
		return WorkspaceFolder{Files: []string{}, Canceled: true}, nil
	}
	return w.open(paths[0])
}

// open switches the workspace to root and lists its Markdown files. The
// switch happens only after the folder resolves and lists, so a failure
// leaves the current workspace in place.
func (w *Workspace) open(root string) (WorkspaceFolder, error) {
	resolved, err := resolveWorkspaceRoot(root)
	if err != nil {
		return WorkspaceFolder{}, err
	}
	files, err := listMarkdownFiles(resolved)
	if err != nil {
		return WorkspaceFolder{}, err
	}
	w.state.set(resolved)
	return WorkspaceFolder{Root: resolved, Files: files}, nil
}

// resolveWorkspaceRoot turns the folder the picker returned into the path
// every file operation is checked against: absolute, clean and with its
// symlinks resolved.
func resolveWorkspaceRoot(root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("workspace: folder is not absolute: %q", root)
	}
	resolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("workspace: not a folder: %q", root)
	}
	return filepath.Clean(resolved), nil
}

// ListFiles lists the Markdown files of the open folder as paths relative to
// it, separated by slashes. Hidden folders and node_modules are not entered,
// and symlinks are neither followed nor listed.
func (w *Workspace) ListFiles() ([]string, error) {
	root := w.state.get()
	if root == "" {
		return nil, errNoWorkspace
	}
	return listMarkdownFiles(root)
}

func listMarkdownFiles(root string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(root, func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == root {
			return nil
		}
		if entry.IsDir() {
			if ignoredFolder(entry.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		// WalkDir does not follow symlinks; leaving them out keeps a link
		// from standing in for a file the workspace does not contain.
		if !entry.Type().IsRegular() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(entry.Name()), ".md") {
			return nil
		}
		rel, err := filepath.Rel(root, name)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

// ignoredFolder reports whether a folder is left out of listings and
// watches: a name starting with a dot, or node_modules.
func ignoredFolder(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules"
}

// ReadFile returns the exact bytes of a file in the open folder as a string,
// without changing its line endings or adding a final newline.
func (w *Workspace) ReadFile(rel string) (string, error) {
	target, err := w.readTarget(rel)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(target)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile replaces a file in the open folder with content. It writes a
// temporary file next to the target and renames it into place, so a failure
// leaves the original file as it was, and the bytes are written unchanged.
func (w *Workspace) WriteFile(rel, content string) error {
	target, err := w.writeTarget(rel)
	if err != nil {
		return err
	}
	return writeFileAtomic(target, []byte(content))
}

// readTarget resolves a path relative to the open folder to an existing
// regular file in it.
func (w *Workspace) readTarget(rel string) (string, error) {
	root := w.state.get()
	if root == "" {
		return "", errNoWorkspace
	}
	if err := validateRelativePath(rel); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", err
	}
	if !withinRoot(root, resolved) {
		return "", errPathOutside
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("workspace: not a file: %q", rel)
	}
	return resolved, nil
}

// writeTarget resolves a path relative to the open folder to where its
// replacement goes. A file that exists is resolved through its symlinks, so
// a link that leaves the workspace is rejected. A new file is created in its
// resolved folder, which must be in the workspace.
func (w *Workspace) writeTarget(rel string) (string, error) {
	root := w.state.get()
	if root == "" {
		return "", errNoWorkspace
	}
	if err := validateRelativePath(rel); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err == nil {
		if !withinRoot(root, resolved) {
			return "", errPathOutside
		}
		info, err := os.Stat(resolved)
		if err != nil {
			return "", err
		}
		if !info.Mode().IsRegular() {
			return "", fmt.Errorf("workspace: not a file: %q", rel)
		}
		return resolved, nil
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	dir, err := filepath.EvalSymlinks(filepath.Dir(candidate))
	if err != nil {
		return "", err
	}
	if !withinRoot(root, dir) {
		return "", errPathOutside
	}
	return filepath.Join(dir, filepath.Base(candidate)), nil
}

// validateRelativePath accepts only a path relative to the workspace that
// names a file: no absolute paths, no parent traversal in either slash
// style, and no drive prefix. Keeping the rules the same on every platform
// means a path rejected on one is rejected everywhere.
func validateRelativePath(rel string) error {
	if rel == "" || rel == "." {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if strings.ContainsRune(rel, '\\') {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if path.IsAbs(rel) || filepath.IsAbs(rel) || looksLikeDrivePath(rel) {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if !fs.ValidPath(rel) {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	return nil
}

// looksLikeDrivePath reports a Windows drive path on any platform, so the
// same relative paths work and fail the same way everywhere.
func looksLikeDrivePath(rel string) bool {
	if len(rel) < 2 || rel[1] != ':' {
		return false
	}
	c := rel[0]
	return 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z'
}

// withinRoot reports whether target is root or below it. Rel compares path
// components, so a sibling whose name merely starts with root's name is not
// taken for a child, and a path that differs from root only by case is
// refused rather than guessed at: the frontend passes the names listing
// returned, which have the case on disk.
func withinRoot(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// writeFileAtomic replaces target with data in one rename. Until the rename
// succeeds, target is untouched, and a failure removes the temporary file.
func writeFileAtomic(target string, data []byte) error {
	return writeFileAtomicWith(target, data, os.Rename)
}

// writeFileAtomicWith is writeFileAtomic with the rename step passed in, so
// a test can observe a failure after the new content was written.
func writeFileAtomicWith(target string, data []byte, rename func(string, string) error) (err error) {
	mode := fs.FileMode(0o644)
	if info, statErr := os.Stat(target); statErr == nil {
		if info.Mode().IsRegular() {
			mode = info.Mode().Perm()
		}
	} else if !errors.Is(statErr, fs.ErrNotExist) {
		return statErr
	}

	tmp, err := os.CreateTemp(filepath.Dir(target), ".nicole-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() {
		if err != nil {
			_ = os.Remove(tmpName)
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
	if err = os.Chmod(tmpName, mode); err != nil {
		return err
	}
	return rename(tmpName, target)
}

// watchRoot grants the watch plugin a root only for the open folder. The
// plugin asks on each watch, so it always watches the folder that is open
// then; the ignore rules match the ones listing uses.
func (w *Workspace) watchRoot(ctx context.Context, name string) (watch.Root, bool) {
	if name != workspaceWatchRoot {
		return watch.Root{}, false
	}
	root := w.state.get()
	if root == "" {
		return watch.Root{}, false
	}
	return watch.Root{
		Path:      root,
		Recursive: true,
		Ignore: func(name string, isDir bool) bool {
			return isDir && ignoredFolder(path.Base(name))
		},
	}, true
}
