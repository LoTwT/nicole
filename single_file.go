package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
)

var (
	errSingleFileNotGranted  = errors.New("single file: the file was not chosen by the user")
	errSingleFileNotMarkdown = errors.New("single file: only .md files can be opened")
)

// SingleFile names a file the user explicitly chose outside the workspace.
// Path is absolute and has its symlinks resolved; it is the only path the
// single-file methods accept, and no other file in its folder is accessible.
type SingleFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
}

// SingleFileSelection is the result of the native file dialog. Canceled is
// true when the dialog was dismissed.
type SingleFileSelection struct {
	Path     string `json:"path"`
	Name     string `json:"name"`
	Canceled bool   `json:"canceled"`
}

type singleFileGrant struct {
	path string
}

// SingleFileService reads and writes one Markdown file that is not in the
// workspace. Grants are in memory and per file: a path may be granted by the
// native file dialog or by accepting a file the system opened with Nicole.
// Reading or writing a path that was not granted, including another file in
// the same folder, fails.
type SingleFileService struct {
	mu      sync.Mutex
	grants  map[string]singleFileGrant
	offered map[string]bool
}

// NewSingleFileService returns a service with no grants.
func NewSingleFileService() *SingleFileService {
	return &SingleFileService{
		grants:  map[string]singleFileGrant{},
		offered: map[string]bool{},
	}
}

// ChooseSingleFile shows a Markdown file picker and grants the choice. The
// returned selection is empty and Canceled when the dialog is dismissed.
func (s *SingleFileService) ChooseSingleFile(ctx context.Context) (SingleFileSelection, error) {
	paths, err := mygo.Dialog.Open(mygo.OpenDialogOptions{
		Parent:      mygo.CallerWindow(ctx),
		Title:       "打开文件",
		ButtonLabel: "打开",
		Filters:     []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md"}}},
	})
	if err != nil {
		return SingleFileSelection{}, err
	}
	if len(paths) == 0 {
		return SingleFileSelection{Canceled: true}, nil
	}
	file, err := s.grant(paths[0])
	if err != nil {
		return SingleFileSelection{}, err
	}
	return SingleFileSelection{Path: file.Path, Name: file.Name}, nil
}

// AcceptSingleFile grants a file the system opened with Nicole after the user
// confirmed opening it as a single-file tab. Only a path that reached the app
// through the file association is accepted; a page cannot grant a path of its
// own choosing.
func (s *SingleFileService) AcceptSingleFile(path string) (SingleFile, error) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return SingleFile{}, fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	key := clean
	if !s.offered[key] {
		if resolved, err := filepath.EvalSymlinks(clean); err == nil {
			key = resolved
		}
	}
	if !s.offered[key] {
		return SingleFile{}, fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
	}
	file, err := resolveSingleFile(key)
	if err != nil {
		return SingleFile{}, err
	}
	s.grants[file.Path] = singleFileGrant{path: file.Path}
	delete(s.offered, clean)
	delete(s.offered, key)
	delete(s.offered, file.Path)
	return file, nil
}

// ReadSingleFile returns the exact bytes of a granted file.
func (s *SingleFileService) ReadSingleFile(path string) (string, error) {
	granted, err := s.grantedPath(path)
	if err != nil {
		return "", err
	}
	info, err := os.Lstat(granted)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("%w: %q", errNotRegular, granted)
	}
	data, err := os.ReadFile(granted)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// WriteSingleFile atomically replaces a granted file. It follows the workspace
// writer's rules: the file keeps its mode, a read-only file is refused, and a
// failure leaves the old content in place.
func (s *SingleFileService) WriteSingleFile(path, content string) error {
	granted, err := s.grantedPath(path)
	if err != nil {
		return err
	}
	info, err := os.Lstat(granted)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err == nil {
		if !info.Mode().IsRegular() {
			return fmt.Errorf("%w: %q", errNotRegular, granted)
		}
		if info.Mode().Perm()&0o222 == 0 {
			return fmt.Errorf("%w: %q", errReadOnlyFile, granted)
		}
	}
	// A granted file deleted outside Nicole keeps its authorization: saving
	// again recreates it at the same path, as an open workspace file does.
	return writeFileAtomicAbs(granted, []byte(content))
}

// ReleaseSingleFile forgets a grant, such as when its tab closes.
func (s *SingleFileService) ReleaseSingleFile(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	clean := filepath.Clean(path)
	delete(s.grants, clean)
	delete(s.offered, clean)
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		delete(s.grants, resolved)
		delete(s.offered, resolved)
	}
}

// offer remembers a file the system asked Nicole to open. It grants nothing:
// the page must confirm it with AcceptSingleFile.
func (s *SingleFileService) offer(path string) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.offered[clean] = true
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		s.offered[resolved] = true
	}
}

func (s *SingleFileService) grant(path string) (SingleFile, error) {
	file, err := resolveSingleFile(path)
	if err != nil {
		return SingleFile{}, err
	}
	s.mu.Lock()
	s.grants[file.Path] = singleFileGrant{path: file.Path}
	s.mu.Unlock()
	return file, nil
}

// grantedPath returns the canonical path of an existing grant. A path that
// only names the same folder or a sibling is not accepted.
func (s *SingleFileService) grantedPath(path string) (string, error) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.grants[clean]; ok {
		return clean, nil
	}
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		if _, ok := s.grants[resolved]; ok {
			return resolved, nil
		}
	}
	return "", fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
}

// resolveSingleFile canonicalizes a user-chosen file and checks that it is a
// regular Markdown file. It does not allow folders, links to folders or files
// of other types.
func resolveSingleFile(path string) (SingleFile, error) {
	if !filepath.IsAbs(path) {
		return SingleFile{}, fmt.Errorf("single file: path must be absolute: %q", path)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return SingleFile{}, err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return SingleFile{}, err
	}
	if !info.Mode().IsRegular() {
		return SingleFile{}, fmt.Errorf("%w: %q", errNotRegular, path)
	}
	if !isMarkdownName(resolved) {
		return SingleFile{}, fmt.Errorf("%w: %q", errSingleFileNotMarkdown, path)
	}
	return SingleFile{Path: resolved, Name: filepath.Base(resolved)}, nil
}
