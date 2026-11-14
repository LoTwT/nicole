package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
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
	mu        sync.Mutex
	grants    map[string]singleFileGrant
	offered   map[string]string
	nextOffer uint64
	hashes    *diskHashes
}

// NewSingleFileService returns a service with no grants.
func NewSingleFileService() *SingleFileService {
	return &SingleFileService{
		grants:  map[string]singleFileGrant{},
		offered: map[string]string{},
	}
}

// useDiskHashes lets the service remember what it last read or wrote so a
// recovery copy can record the disk version without another read.
func (s *SingleFileService) useDiskHashes(hashes *diskHashes) {
	s.hashes = hashes
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
func (s *SingleFileService) AcceptSingleFile(path, offerID string) (SingleFile, error) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return SingleFile{}, fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	key := clean
	if s.offered[key] != offerID {
		if resolved, err := filepath.EvalSymlinks(clean); err == nil {
			key = resolved
		}
	}
	if offerID == "" || s.offered[key] != offerID {
		return SingleFile{}, fmt.Errorf("%w: %q", errSingleFileNotGranted, path)
	}
	file, err := resolveSingleFile(key)
	if err != nil {
		return SingleFile{}, err
	}
	s.grants[file.Path] = singleFileGrant{path: file.Path}
	s.deleteOfferID(offerID)
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
	s.hashes.record(granted, data)
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
	if err := writeFileAtomicAbs(granted, []byte(content)); err != nil {
		return err
	}
	s.hashes.record(granted, []byte(content))
	return nil
}

// RevealSingleFile shows a granted file in the desktop's file manager. It
// accepts only an existing grant, like the read and write methods.
func (s *SingleFileService) RevealSingleFile(path string) error {
	granted, err := s.grantedPath(path)
	if err != nil {
		return err
	}
	revealWorkspaceItem(granted)
	return nil
}

// ReleaseSingleFile forgets a grant, such as when its tab closes. A pending
// system offer is a separate occurrence and is not consumed here.
func (s *SingleFileService) ReleaseSingleFile(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	clean := filepath.Clean(path)
	delete(s.grants, clean)
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		delete(s.grants, resolved)
	}
}

// offer remembers a file the system asked Nicole to open and returns the
// identity of this occurrence. It grants nothing: the page must confirm that
// exact offer with AcceptSingleFile.
func (s *SingleFileService) offer(path string) string {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextOffer++
	offerID := strconv.FormatUint(s.nextOffer, 10)
	resolved := clean
	if target, err := filepath.EvalSymlinks(clean); err == nil {
		resolved = target
	}
	s.offered[clean] = offerID
	s.offered[resolved] = offerID
	// A new offer through another alias supersedes all older aliases of the
	// same resolved file, so an old confirmation cannot consume it.
	for existing := range s.offered {
		if existing == clean || existing == resolved {
			continue
		}
		if target, err := filepath.EvalSymlinks(existing); err == nil &&
			target == resolved {
			s.offered[existing] = offerID
		}
	}
	return offerID
}

// DismissOfferedFile forgets the exact offer the page handled. A newer offer
// for the same path keeps its own identity and remains available. It only
// removes an offer; it never grants access.
func (s *SingleFileService) DismissOfferedFile(path, offerID string) {
	clean := filepath.Clean(path)
	if !filepath.IsAbs(clean) || offerID == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := clean
	if s.offered[key] != offerID {
		if resolved, err := filepath.EvalSymlinks(clean); err == nil {
			key = resolved
		}
	}
	if s.offered[key] != offerID {
		return
	}
	s.deleteOfferID(offerID)
}

// deleteOfferID removes every alias of one offer occurrence. The caller holds
// s.mu.
func (s *SingleFileService) deleteOfferID(offerID string) {
	for path, offeredID := range s.offered {
		if offeredID == offerID {
			delete(s.offered, path)
		}
	}
}

// takeOfferedFolder removes every offer whose file is directly inside folder.
// OpenFolder calls it after a successful switch, so opening the parent once
// consumes the grant instead of leaving a permanent directory authorization.
func (s *SingleFileService) takeOfferedFolder(folder string) bool {
	clean := filepath.Clean(folder)
	resolvedFolder := clean
	if resolved, err := filepath.EvalSymlinks(clean); err == nil {
		resolvedFolder = filepath.Clean(resolved)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	matched := false
	for path := range s.offered {
		parent := filepath.Dir(path)
		if parent == clean || parent == resolvedFolder {
			delete(s.offered, path)
			matched = true
		}
	}
	return matched
}

// offeredPaths returns the absolute files the system handed to the app. The
// workspace uses their parent folders to allow opening a recent file's folder
// without granting the page arbitrary paths.
func (s *SingleFileService) offeredPaths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	paths := make([]string, 0, len(s.offered))
	for path := range s.offered {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
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

// grantedPaths reports the canonical paths of all active grants. The workspace
// uses it to preserve their disk hashes when another root is opened.
func (s *SingleFileService) grantedPaths() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	paths := make([]string, 0, len(s.grants))
	for path := range s.grants {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

// grantRecovered grants a canonical path that Recovery already checked. It is
// deliberately not exported beyond the package and never accepts a path the
// page supplied without a recovery entry behind it.
func (s *SingleFileService) grantRecovered(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.grants[path] = singleFileGrant{path: path}
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
