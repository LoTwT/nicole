package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/watch"
)

const (
	workspaceWatchRootPrefix = "workspace-"
	tempFilePrefix           = ".nicole-"
	tempFileSuffix           = ".tmp"

	// closeSaveTimeout bounds how long closing the window waits for the page
	// to save. A page that cannot answer must not leave the window stuck.
	closeSaveTimeout = 5 * time.Second
)

// workspaceSaveBeforeClose asks the page to save pending edits before its
// window closes. The page answers with Workspace.FinishClose.
var workspaceSaveBeforeClose = mygo.NewEvent[bool]("workspace:save-before-close")

var (
	errNoWorkspace     = errors.New("workspace: no folder is open")
	errPathOutside     = errors.New("workspace: path is outside the folder")
	errWorkspaceChange = errors.New("workspace: folder changed")
	errNotMarkdown     = errors.New("workspace: only .md files can be read or written")
	errIgnoredFolder   = errors.New("workspace: path is in an ignored folder")
	errReadOnlyFile    = errors.New("workspace: file is read-only")
	errDanglingLink    = errors.New("workspace: dangling symbolic link")
)

// WorkspaceFolder is the result of choosing a folder. Canceled is true when
// the dialog was dismissed; the other fields are then empty.
type WorkspaceFolder struct {
	// Root is the absolute path of the folder, with symlinks resolved.
	Root     string   `json:"root"`
	Files    []string `json:"files"`
	Canceled bool     `json:"canceled"`
	// Generation identifies this folder. Writes must carry it so a save
	// prepared for one folder cannot land in the next one.
	Generation int `json:"generation"`
	// WatchRoot is the name pages give the watch plugin for this folder.
	// It embeds Generation so an old watcher cannot be granted again.
	WatchRoot string `json:"watchRoot"`
}

// Workspace serves the folder the user opened: its Markdown files, and
// reading and replacing them. `mygo generate` turns the methods into typed
// functions in src/services/mygo.ts.
type Workspace struct {
	state *workspaceState

	closeMu    sync.Mutex
	closing    bool
	closeToken uint64
}

// NewWorkspace returns a workspace with no folder open.
func NewWorkspace() *Workspace {
	return &Workspace{state: &workspaceState{}}
}

// workspaceState is the one current workspace of the process. Services, the
// watch plugin and the protocol handler that follows read it; switching
// folders replaces this state in place, not the registrations that read it.
type workspaceState struct {
	mu         sync.RWMutex
	root       string
	generation int
}

func (s *workspaceState) snapshot() (root string, generation int) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.root, s.generation
}

func (s *workspaceState) replace(root string) (generation int, watchRoot string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.root = root
	s.generation++
	return s.generation, watchRootName(s.generation)
}

func watchRootName(generation int) string {
	return workspaceWatchRootPrefix + strconv.Itoa(generation)
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
	rootFS, err := os.OpenRoot(resolved)
	if err != nil {
		return WorkspaceFolder{}, err
	}
	defer rootFS.Close()

	files, err := listMarkdownFiles(rootFS)
	if err != nil {
		return WorkspaceFolder{}, err
	}
	removeTempFiles(rootFS)
	generation, watchRoot := w.state.replace(resolved)
	return WorkspaceFolder{
		Root:       resolved,
		Files:      files,
		Generation: generation,
		WatchRoot:  watchRoot,
	}, nil
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
	root, _ := w.state.snapshot()
	if root == "" {
		return nil, errNoWorkspace
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return nil, err
	}
	defer rootFS.Close()
	return listMarkdownFiles(rootFS)
}

func listMarkdownFiles(root *os.Root) ([]string, error) {
	files := make([]string, 0)
	err := fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if name == "." {
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
		if !isMarkdownName(entry.Name()) {
			return nil
		}
		files = append(files, name)
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

// ignoredFolder reports whether a folder is left out of listings, watches,
// and file access: a name starting with a dot, or node_modules.
func ignoredFolder(name string) bool {
	return strings.HasPrefix(name, ".") || name == "node_modules"
}

func isMarkdownName(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".md")
}

func isWorkspaceTempName(name string) bool {
	return strings.HasPrefix(name, tempFilePrefix) && strings.HasSuffix(name, tempFileSuffix)
}

// removeTempFiles removes temporary files this app left behind. It only
// removes its own prefix and ignores failures: opening a folder must work
// even when old temporary files cannot be deleted.
func removeTempFiles(root *os.Root) {
	_ = fs.WalkDir(root.FS(), ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || name == "." {
			return nil
		}
		if entry.IsDir() {
			if ignoredFolder(entry.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		if entry.Type().IsRegular() && isWorkspaceTempName(entry.Name()) {
			_ = root.Remove(filepath.FromSlash(name))
		}
		return nil
	})
}

// ReadFile returns the exact bytes of a Markdown file in the open folder as a
// string, without changing its line endings or adding a final newline.
func (w *Workspace) ReadFile(rel string) (string, error) {
	root, _ := w.state.snapshot()
	if root == "" {
		return "", errNoWorkspace
	}
	target, err := resolveExistingFile(root, rel)
	if err != nil {
		return "", err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", err
	}
	defer rootFS.Close()
	info, err := rootFS.Stat(filepath.FromSlash(target))
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("workspace: not a file: %q", rel)
	}
	data, err := rootFS.ReadFile(filepath.FromSlash(target))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteFile replaces a Markdown file in the open folder with content.
// generation is the value ChooseFolder returned for that folder; a write
// prepared for an earlier folder is refused. It writes a temporary file next
// to the target and renames it into place, so a failure leaves the original
// file as it was, and the bytes are written unchanged.
func (w *Workspace) WriteFile(rel, content string, generation int) error {
	root, current := w.state.snapshot()
	if root == "" {
		return errNoWorkspace
	}
	if generation != current {
		return fmt.Errorf("%w: got generation %d, want %d", errWorkspaceChange, generation, current)
	}
	target, err := resolveWritableFile(root, rel)
	if err != nil {
		return err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return err
	}
	defer rootFS.Close()

	info, err := rootFS.Stat(filepath.FromSlash(target))
	if err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("workspace: not a file: %q", rel)
		}
		if info.Mode().Perm()&0o222 == 0 {
			return fmt.Errorf("%w: %q", errReadOnlyFile, rel)
		}
		return writeWorkspaceFile(rootFS, target, []byte(content), info.Mode().Perm())
	}
	if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	// A dangling link has nothing to write through; replacing it would
	// silently turn a link into a regular file.
	if info, err := rootFS.Lstat(filepath.FromSlash(rel)); err == nil && info.Mode()&fs.ModeSymlink != 0 {
		return fmt.Errorf("%w: %q", errDanglingLink, rel)
	}
	return writeWorkspaceFile(rootFS, target, []byte(content), 0)
}

// resolveExistingFile resolves a path relative to root to an existing regular
// Markdown file below it, after following any symlinks inside the workspace.
func resolveExistingFile(root, rel string) (string, error) {
	if err := validateWorkspaceFile(rel); err != nil {
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
	if err := validateWorkspaceFile(target); err != nil {
		return "", err
	}
	return target, nil
}

// resolveWritableFile resolves a path relative to root to where its
// replacement goes. An existing file is resolved through its symlinks, so a
// link that leaves the workspace is rejected; a new file is created in its
// resolved folder, which must also be a usable workspace folder.
func resolveWritableFile(root, rel string) (string, error) {
	if err := validateWorkspaceFile(rel); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(rel))
	resolved, err := filepath.EvalSymlinks(candidate)
	if err == nil {
		target := relativeToRoot(root, resolved)
		if target == "" {
			return "", errPathOutside
		}
		if err := validateWorkspaceFile(target); err != nil {
			return "", err
		}
		return target, nil
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
	target := filepath.Join(dir, filepath.Base(candidate))
	relative := relativeToRoot(root, target)
	if relative == "" {
		return "", errPathOutside
	}
	if err := validateWorkspaceFile(relative); err != nil {
		return "", err
	}
	return relative, nil
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

// relativeToRoot returns target relative to root in slash form, or "" when
// target is outside root or root itself.
func relativeToRoot(root, target string) string {
	rel, err := filepath.Rel(root, target)
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return ""
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ""
	}
	return filepath.ToSlash(rel)
}

// validateWorkspaceFile accepts only a Markdown file that is not in an
// ignored folder, with the same rules listing and watching use.
func validateWorkspaceFile(rel string) error {
	if err := validateRelativePath(rel); err != nil {
		return err
	}
	if !isMarkdownName(rel) {
		return fmt.Errorf("%w: %q", errNotMarkdown, rel)
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

// validateRelativePath accepts only a path relative to the workspace that
// names a file: no absolute paths, no parent traversal in either slash
// style, no drive or other colon paths, and no empty segments. Keeping the
// rules the same on every platform means a path rejected on one is rejected
// everywhere.
func validateRelativePath(rel string) error {
	if rel == "" || rel == "." {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if strings.ContainsRune(rel, '\\') || strings.ContainsRune(rel, ':') {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if path.IsAbs(rel) || filepath.IsAbs(rel) || looksLikeDrivePath(rel) {
		return fmt.Errorf("workspace: invalid path: %q", rel)
	}
	if !fs.ValidPath(rel) || !filepath.IsLocal(filepath.FromSlash(rel)) {
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

// writeWorkspaceFile replaces target inside root with data in one rename.
// Until the rename succeeds, target is untouched, and a failure removes the
// temporary file. A new file gets the process umask; an existing file keeps
// its permission bits.
func writeWorkspaceFile(root *os.Root, target string, data []byte, mode fs.FileMode) error {
	return writeWorkspaceFileWith(root, target, data, mode, func(root *os.Root, oldName, newName string) error {
		return retryRename(func() error { return root.Rename(oldName, newName) })
	})
}

// writeWorkspaceFileWith is writeWorkspaceFile with the rename step passed
// in, so a test can observe a failure after the new content was written.
func writeWorkspaceFileWith(root *os.Root, target string, data []byte, mode fs.FileMode, rename func(*os.Root, string, string) error) (err error) {
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
	if err = rename(root, tempPath, targetPath); err != nil {
		return err
	}
	return syncRootDirectory(root, dir)
}

func newTempFileName() (string, error) {
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "", err
	}
	return tempFilePrefix + hex.EncodeToString(random[:]) + tempFileSuffix, nil
}

// syncRootDirectory makes the rename durable. Windows has no directory fsync;
// opening a directory for this purpose is not supported there.
func syncRootDirectory(root *os.Root, dir string) error {
	if runtime.GOOS == "windows" {
		return nil
	}
	f, err := root.Open(filepath.FromSlash(dir))
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// retryRename retries a rename while Windows reports the file in use, as
// MyGo's own file replacement does.
func retryRename(fn func() error) error {
	for i := 1; ; i++ {
		err := fn()
		if err == nil || i == 10 || runtime.GOOS != "windows" ||
			!errors.Is(err, syscall.Errno(32)) && !errors.Is(err, syscall.Errno(5)) {
			return err
		}
		time.Sleep(time.Duration(i) * 100 * time.Millisecond)
	}
}

// requestClose asks the page to save before its window closes. It reports
// whether the close was delayed; a page that does not answer is closed when
// closeSaveTimeout passes.
func (w *Workspace) requestClose(win *mygo.Window) bool {
	w.closeMu.Lock()
	if w.closing {
		// A save is already in progress; keep the window open until it
		// answers or the timeout closes it.
		w.closeMu.Unlock()
		return true
	}
	w.closing = true
	w.closeToken++
	token := w.closeToken
	w.closeMu.Unlock()

	if err := workspaceSaveBeforeClose.Emit(win, true); err != nil {
		w.closeMu.Lock()
		if w.closeToken == token {
			w.closing = false
		}
		w.closeMu.Unlock()
		return false
	}
	time.AfterFunc(closeSaveTimeout, func() {
		w.closeMu.Lock()
		if !w.closing || w.closeToken != token {
			w.closeMu.Unlock()
			return
		}
		w.closing = false
		w.closeToken++
		w.closeMu.Unlock()
		win.Destroy()
	})
	return true
}

// FinishClose closes the calling window when the page saved successfully.
// When saved is false the window stays open, with the page's error visible.
func (w *Workspace) FinishClose(ctx context.Context, saved bool) {
	w.closeMu.Lock()
	if !w.closing {
		w.closeMu.Unlock()
		return
	}
	w.closing = false
	w.closeToken++
	w.closeMu.Unlock()
	if !saved {
		return
	}
	if win := mygo.CallerWindow(ctx); win != nil {
		win.Destroy()
	}
}

// watchRoot grants the watch plugin a root only for the open folder and only
// for its current generation. The plugin asks on each watch, so a watcher
// from an earlier folder cannot be granted again.
func (w *Workspace) watchRoot(_ context.Context, name string) (watch.Root, bool) {
	root, generation := w.state.snapshot()
	if root == "" || name != watchRootName(generation) {
		return watch.Root{}, false
	}
	return watch.Root{
		Path:      root,
		Recursive: true,
		Ignore: func(name string, isDir bool) bool {
			base := path.Base(name)
			return isWorkspaceTempName(base) || isDir && ignoredFolder(base)
		},
	}, true
}
