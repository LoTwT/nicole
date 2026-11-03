package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	recoveryDirName = "recovery"

	recoveryVersion = 1

	// One copy and the whole recovery folder are bounded so a forgotten
	// session cannot fill the disk. Replacing a path does not count its own
	// old copy against the folder limit.
	maxRecoveryFileBytes  = 8 << 20
	maxRecoveryTotalBytes = 64 << 20
	// JSON escaping can double the size of a text full of quotes or
	// backslashes; anything much larger than that is not a copy this app wrote.
	recoveryFileOverhead = maxRecoveryFileBytes

	recoveryKindWorkspace = "workspace"
	recoveryKindSingle    = "single"

	recoveryStateSame    = "same"
	recoveryStateChanged = "changed"
	recoveryStateMissing = "missing"

	recoveryLineEndingLF   = "\n"
	recoveryLineEndingCRLF = "\r\n"
	recoveryLineEndingCR   = "\r"
)

var (
	errRecoveryGeneration   = errors.New("recovery: the workspace changed")
	errRecoveryNotAllowed   = errors.New("recovery: the path is not authorized")
	errRecoveryTooLarge     = errors.New("recovery: the copy is too large")
	errRecoveryFolderFull   = errors.New("recovery: the recovery folder is full")
	errRecoveryInvalidID    = errors.New("recovery: invalid copy id")
	errRecoveryNotSingle    = errors.New("recovery: not a single-file copy")
	errRecoveryUnrestorable = errors.New("recovery: the file cannot be restored")
	errRecoveryConsumed     = errors.New("recovery: the copy was already restored")
	errInvalidRecoveryEntry = errors.New("recovery: invalid copy")
)

// diskHashes remembers the SHA-256 of what Nicole last read from or wrote to a
// file, keyed by absolute path. It stores hashes only, never file contents, so
// writing a recovery copy does not read the disk again.
type diskHashes struct {
	mu     sync.Mutex
	hashes map[string]string
}

func newDiskHashes() *diskHashes {
	return &diskHashes{hashes: map[string]string{}}
}

func (h *diskHashes) record(absolute string, data []byte) {
	if h == nil || absolute == "" {
		return
	}
	sum := sha256.Sum256(data)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.hashes[filepath.Clean(absolute)] = hex.EncodeToString(sum[:])
}

func (h *diskHashes) lookup(absolute string) (string, bool) {
	if h == nil || absolute == "" {
		return "", false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	value, ok := h.hashes[filepath.Clean(absolute)]
	return value, ok
}

// clearUnder forgets every recorded path below root. Switching workspaces
// drops the old root's hashes so a new folder cannot reuse them.
func (h *diskHashes) clearUnder(root string) {
	if h == nil || root == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for candidate := range h.hashes {
		if withinRoot(root, candidate) {
			delete(h.hashes, candidate)
		}
	}
}

// RecoveryCopy is what the page asks Go to write for one dirty document. The
// page owns the text; Go fills savedAt and diskHash so the record reflects what
// Nicole last knew about the file.
type RecoveryCopy struct {
	Kind       string `json:"kind"`
	Root       string `json:"root"`
	Path       string `json:"path"`
	LineEnding string `json:"lineEnding"`
	Text       string `json:"text"`
}

// RecoveryItem is one copy listed for the page. DiskState is decided by Go
// from the diskHash recorded when the copy was written; the page never
// compares files itself. DiskText is the current disk content, empty when the
// file is missing or cannot be read.
type RecoveryItem struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Root       string `json:"root"`
	Path       string `json:"path"`
	Name       string `json:"name"`
	SavedAt    string `json:"savedAt"`
	LineEnding string `json:"lineEnding"`
	Text       string `json:"text"`
	DiskText   string `json:"diskText"`
	DiskState  string `json:"diskState"`
	Restorable bool   `json:"restorable"`
	Reason     string `json:"reason,omitempty"`
}

// RecoveryListing is the current workspace's copies plus the number of other
// workspace roots that also have copies. Their contents are not returned so a
// folder the user has not opened yet stays untouched.
type RecoveryListing struct {
	Items        []RecoveryItem `json:"items"`
	OtherFolders int            `json:"otherFolders"`
}

type storedRecovery struct {
	Version    int    `json:"version"`
	Kind       string `json:"kind"`
	Root       string `json:"root"`
	Path       string `json:"path"`
	SavedAt    string `json:"savedAt"`
	DiskHash   string `json:"diskHash"`
	LineEnding string `json:"lineEnding"`
	Text       string `json:"text"`
}

// Recovery writes, lists and removes unsaved-content copies. Workspace copies
// are only accepted for the open root and generation; single-file copies only
// for a path the user has authorized. Restoring a single-file copy grants that
// exact path again, which is the only exception to grants living in memory.
type Recovery struct {
	store       *recoveryStore
	singleFiles *SingleFileService
	hashes      *diskHashes
	currentRoot func() string
	generation  func() int

	consumedMu sync.Mutex
	consumed   map[string]bool
}

// NewRecovery returns the recovery service.
func NewRecovery(store *recoveryStore, singleFiles *SingleFileService, hashes *diskHashes) *Recovery {
	return &Recovery{
		store:       store,
		singleFiles: singleFiles,
		hashes:      hashes,
		consumed:    map[string]bool{},
	}
}

func (r *Recovery) useWorkspace(root func() string, generation func() int) {
	r.currentRoot = root
	r.generation = generation
}

func (r *Recovery) currentGeneration() int {
	if r.generation == nil {
		return 0
	}
	return r.generation()
}

func (r *Recovery) currentWorkspaceRoot() string {
	if r.currentRoot == nil {
		return ""
	}
	return filepath.Clean(r.currentRoot())
}

func (r *Recovery) requireGeneration(generation int) error {
	if generation != r.currentGeneration() {
		return fmt.Errorf("%w: %d is not %d", errRecoveryGeneration, generation, r.currentGeneration())
	}
	return nil
}

// Save writes or replaces the copy of one dirty document and returns its id.
// The page cannot name a workspace outside the open root or a single file the
// user did not authorize.
func (r *Recovery) Save(copy RecoveryCopy, generation int) (string, error) {
	entry, err := r.authorizeCopy(copy, generation)
	if err != nil {
		return "", err
	}
	id := recoveryID(entry.Kind, entry.Root, entry.Path)
	if entry.DiskHash == "" {
		// A previous copy already records the last disk version Nicole knew.
		// Keep that baseline instead of degrading a repeated copy to
		// "changed" just because nothing was read in this process.
		if previous, err := r.store.get(id); err == nil && previous.DiskHash != "" {
			entry.DiskHash = previous.DiskHash
		}
	}
	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return "", err
	}
	if err := r.store.save(id, entry.Text, append(data, '\n')); err != nil {
		return "", err
	}
	return id, nil
}

func (r *Recovery) authorizeCopy(copy RecoveryCopy, generation int) (storedRecovery, error) {
	entry := storedRecovery{
		Version:    recoveryVersion,
		Kind:       copy.Kind,
		LineEnding: copy.LineEnding,
		Text:       normalizeRecoveryText(copy.Text),
		SavedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	if !validRecoveryLineEnding(entry.LineEnding) {
		return storedRecovery{}, fmt.Errorf("%w: line ending %q", errInvalidRecoveryEntry, copy.LineEnding)
	}

	switch copy.Kind {
	case recoveryKindWorkspace:
		if err := r.requireGeneration(generation); err != nil {
			return storedRecovery{}, err
		}
		root := r.currentWorkspaceRoot()
		if root == "" {
			return storedRecovery{}, fmt.Errorf("%w: no workspace is open", errRecoveryNotAllowed)
		}
		if filepath.Clean(copy.Root) != root {
			return storedRecovery{}, fmt.Errorf("%w: %q is not the open workspace", errRecoveryNotAllowed, copy.Root)
		}
		if err := validateWorkspaceFile(copy.Path); err != nil {
			return storedRecovery{}, fmt.Errorf("%w: %v", errRecoveryNotAllowed, err)
		}
		entry.Root = root
		entry.Path = path.Clean(copy.Path)
		if hash, ok := r.hashes.lookup(filepath.Join(root, filepath.FromSlash(entry.Path))); ok {
			entry.DiskHash = hash
		}
	case recoveryKindSingle:
		if r.singleFiles == nil {
			return storedRecovery{}, fmt.Errorf("%w: single-file service unavailable", errRecoveryNotAllowed)
		}
		granted, err := r.singleFiles.grantedPath(copy.Path)
		if err != nil {
			return storedRecovery{}, fmt.Errorf("%w: %v", errRecoveryNotAllowed, err)
		}
		if !isMarkdownName(granted) {
			return storedRecovery{}, fmt.Errorf("%w: not a Markdown file", errRecoveryNotAllowed)
		}
		entry.Kind = recoveryKindSingle
		entry.Root = ""
		entry.Path = granted
		if hash, ok := r.hashes.lookup(granted); ok {
			entry.DiskHash = hash
		}
	default:
		return storedRecovery{}, fmt.Errorf("%w: kind %q", errInvalidRecoveryEntry, copy.Kind)
	}
	return entry, nil
}

// Delete removes one copy by id. Workspace copies may only be deleted while
// their root is open and generation matches, so a late page cannot remove
// another folder's copy; single-file copies are not tied to a workspace.
func (r *Recovery) Delete(id string, generation int) error {
	if !validRecoveryID(id) {
		return fmt.Errorf("%w: %q", errRecoveryInvalidID, id)
	}
	entry, err := r.store.get(id)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := r.allowDelete(entry, generation); err != nil {
		return err
	}
	return r.store.remove(id)
}

// Discard removes exactly the listed copies after the user chooses to throw
// the recovered content away. Entries that vanish between listing and this call
// are ignored.
func (r *Recovery) Discard(ids []string, generation int) error {
	seen := map[string]bool{}
	allowed := make([]string, 0, len(ids))
	for _, id := range ids {
		if !validRecoveryID(id) {
			return fmt.Errorf("%w: %q", errRecoveryInvalidID, id)
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		entry, err := r.store.get(id)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		if err := r.allowDelete(entry, generation); err != nil {
			return err
		}
		allowed = append(allowed, id)
	}
	for _, id := range allowed {
		if err := r.store.remove(id); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (r *Recovery) allowDelete(entry storedRecovery, generation int) error {
	if entry.Kind == recoveryKindWorkspace {
		if err := r.requireGeneration(generation); err != nil {
			return err
		}
		if entry.Root != r.currentWorkspaceRoot() {
			return fmt.Errorf("%w: %q is not the open workspace", errRecoveryNotAllowed, entry.Root)
		}
	}
	return nil
}

// List returns the copies of the open workspace and of single files, with
// each document's current disk state. Copies belonging to other workspace
// roots are only counted, never read into the page.
func (r *Recovery) List(generation int) (RecoveryListing, error) {
	if err := r.requireGeneration(generation); err != nil {
		return RecoveryListing{}, err
	}
	root := r.currentWorkspaceRoot()
	entries, err := r.store.list()
	if err != nil {
		return RecoveryListing{}, err
	}

	listing := RecoveryListing{Items: []RecoveryItem{}}
	otherRoots := map[string]bool{}
	for _, entry := range entries {
		switch entry.Kind {
		case recoveryKindWorkspace:
			if root == "" || entry.Root != root {
				otherRoots[entry.Root] = true
				continue
			}
		case recoveryKindSingle:
			// Single-file copies are independent of any workspace root.
		}
		item := r.itemFor(entry, root)
		listing.Items = append(listing.Items, item)
	}
	listing.OtherFolders = len(otherRoots)
	sort.SliceStable(listing.Items, func(i, j int) bool {
		if listing.Items[i].SavedAt != listing.Items[j].SavedAt {
			return listing.Items[i].SavedAt > listing.Items[j].SavedAt
		}
		return listing.Items[i].Path < listing.Items[j].Path
	})
	return listing, nil
}

func (r *Recovery) itemFor(entry storedRecovery, root string) RecoveryItem {
	item := RecoveryItem{
		ID:         recoveryID(entry.Kind, entry.Root, entry.Path),
		Kind:       entry.Kind,
		Root:       entry.Root,
		Path:       entry.Path,
		SavedAt:    entry.SavedAt,
		LineEnding: entry.LineEnding,
		Text:       entry.Text,
		Restorable: true,
	}
	if entry.Kind == recoveryKindWorkspace {
		item.Name = path.Base(entry.Path)
		item.DiskText, item.DiskState, item.Restorable, item.Reason = r.workspaceDiskState(entry, root)
		return item
	}
	item.Name = filepath.Base(entry.Path)
	item.DiskText, item.DiskState, item.Restorable, item.Reason = r.singleDiskState(entry)
	return item
}

func recoveryDiskState(entry storedRecovery, diskText string, readable bool) string {
	if entry.DiskHash == "" || !readable {
		return recoveryStateChanged
	}
	sum := sha256.Sum256([]byte(diskText))
	if hex.EncodeToString(sum[:]) != entry.DiskHash {
		return recoveryStateChanged
	}
	return recoveryStateSame
}

func (r *Recovery) workspaceDiskState(entry storedRecovery, root string) (string, string, bool, string) {
	if err := validateWorkspaceFile(entry.Path); err != nil {
		return "", recoveryStateChanged, false, "路径已不可用"
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return "", recoveryStateChanged, false, "无法读取文件夹"
	}
	defer rootFS.Close()
	info, err := rootFS.Lstat(filepath.FromSlash(entry.Path))
	if errors.Is(err, fs.ErrNotExist) {
		return "", recoveryStateMissing, true, ""
	}
	if err != nil {
		return "", recoveryStateChanged, false, "无法读取文件"
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		info, err = rootFS.Stat(filepath.FromSlash(entry.Path))
		if err != nil {
			return "", recoveryStateChanged, false, "符号链接无法读取"
		}
	}
	if !info.Mode().IsRegular() {
		return "", recoveryStateChanged, false, "不是普通文件"
	}
	data, err := rootFS.ReadFile(filepath.FromSlash(entry.Path))
	if err != nil {
		return "", recoveryStateChanged, false, "无法读取文件"
	}
	return string(data), recoveryDiskState(entry, string(data), true), true, ""
}

func (r *Recovery) singleDiskState(entry storedRecovery) (string, string, bool, string) {
	clean := filepath.Clean(entry.Path)
	if !filepath.IsAbs(clean) || !isMarkdownName(clean) {
		return "", recoveryStateChanged, false, "路径已不可用"
	}
	info, err := os.Lstat(clean)
	if errors.Is(err, fs.ErrNotExist) {
		return "", recoveryStateMissing, true, ""
	}
	if err != nil {
		return "", recoveryStateChanged, false, "无法读取文件"
	}
	if info.Mode()&fs.ModeSymlink != 0 {
		return "", recoveryStateChanged, false, "文件已变为符号链接"
	}
	if !info.Mode().IsRegular() {
		return "", recoveryStateChanged, false, "不是普通文件"
	}
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil || filepath.Clean(resolved) != clean {
		return "", recoveryStateChanged, false, "路径已改变"
	}
	data, err := os.ReadFile(clean)
	if err != nil {
		return "", recoveryStateChanged, true, ""
	}
	return string(data), recoveryDiskState(entry, string(data), true), true, ""
}

// RestoreSingleFile checks a single-file copy again and grants its canonical
// path to the page. This is the only way a grant survives a restart. A copy can
// only be restored once per process; rejecting an unknown id means the page
// cannot authorize a path of its own choosing.
func (r *Recovery) RestoreSingleFile(id string) (SingleFile, error) {
	if !validRecoveryID(id) {
		return SingleFile{}, fmt.Errorf("%w: %q", errRecoveryInvalidID, id)
	}
	r.consumedMu.Lock()
	consumed := r.consumed[id]
	r.consumedMu.Unlock()
	if consumed {
		return SingleFile{}, fmt.Errorf("%w: %q", errRecoveryConsumed, id)
	}
	entry, err := r.store.get(id)
	if err != nil {
		return SingleFile{}, err
	}
	if entry.Kind != recoveryKindSingle {
		return SingleFile{}, fmt.Errorf("%w: %q", errRecoveryNotSingle, id)
	}
	clean := filepath.Clean(entry.Path)
	if !filepath.IsAbs(clean) || !isMarkdownName(clean) {
		return SingleFile{}, fmt.Errorf("%w: %q", errRecoveryUnrestorable, entry.Path)
	}
	info, err := os.Lstat(clean)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return SingleFile{}, err
	}
	if err == nil {
		if info.Mode()&fs.ModeSymlink != 0 {
			return SingleFile{}, fmt.Errorf("%w: %q is a symbolic link", errRecoveryUnrestorable, clean)
		}
		if !info.Mode().IsRegular() {
			return SingleFile{}, fmt.Errorf("%w: %q is not a regular file", errRecoveryUnrestorable, clean)
		}
		resolved, evalErr := filepath.EvalSymlinks(clean)
		if evalErr != nil || filepath.Clean(resolved) != clean {
			return SingleFile{}, fmt.Errorf("%w: %q changed location", errRecoveryUnrestorable, clean)
		}
	} else if parent, evalErr := filepath.EvalSymlinks(filepath.Dir(clean)); evalErr == nil {
		// The file may be recreated at the authorized path, but a parent that
		// has become a symlink elsewhere must not redirect that write.
		if filepath.Clean(filepath.Join(parent, filepath.Base(clean))) != clean {
			return SingleFile{}, fmt.Errorf("%w: %q changed location", errRecoveryUnrestorable, clean)
		}
	}
	if r.singleFiles == nil {
		return SingleFile{}, fmt.Errorf("%w: single-file service unavailable", errRecoveryNotAllowed)
	}
	r.singleFiles.grantRecovered(clean)
	r.consumedMu.Lock()
	r.consumed[id] = true
	r.consumedMu.Unlock()
	return SingleFile{Path: clean, Name: filepath.Base(clean)}, nil
}

func normalizeRecoveryText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.ReplaceAll(text, "\r", "\n")
}

func validRecoveryLineEnding(value string) bool {
	return value == recoveryLineEndingLF || value == recoveryLineEndingCRLF || value == recoveryLineEndingCR
}

func validRecoveryID(id string) bool {
	if len(id) != 16 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

// recoveryID keys a copy by kind, root and path. NULs separate the parts so
// two different triples cannot collapse into the same string.
func recoveryID(kind, root, path string) string {
	sum := sha256.Sum256([]byte(kind + "\x00" + root + "\x00" + path))
	return hex.EncodeToString(sum[:])[:16]
}

// recoveryStore owns the recovery folder. Each copy is one JSON file replaced
// atomically; a file that cannot be parsed is renamed aside and skipped.
type recoveryStore struct {
	mu       sync.Mutex
	dir      string
	maxFile  int
	maxTotal int
}

func newRecoveryStore() (*recoveryStore, error) {
	dir, err := userDataDir()
	if err != nil {
		return nil, err
	}
	return newRecoveryStoreIn(filepath.Join(dir, recoveryDirName)), nil
}

func startupRecoveryStore() (*recoveryStore, error) {
	if generatingClient() {
		return newRecoveryStoreIn(filepath.Join(os.TempDir(), "nicole-generate", recoveryDirName)), nil
	}
	return newRecoveryStore()
}

func newRecoveryStoreIn(dir string) *recoveryStore {
	return &recoveryStore{
		dir:      dir,
		maxFile:  maxRecoveryFileBytes,
		maxTotal: maxRecoveryTotalBytes,
	}
}

func (s *recoveryStore) filePath(id string) string {
	return filepath.Join(s.dir, id+".json")
}

func (s *recoveryStore) save(id, text string, data []byte) error {
	if len(text) > s.maxFile {
		return fmt.Errorf("%w: %d bytes", errRecoveryTooLarge, len(text))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	target := s.filePath(id)
	total := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		full := filepath.Join(s.dir, entry.Name())
		if filepath.Clean(full) == filepath.Clean(target) {
			continue
		}
		total += int(info.Size())
	}
	if total+len(data) > s.maxTotal {
		return fmt.Errorf("%w: %d bytes", errRecoveryFolderFull, total+len(data))
	}
	return writeFileAtomicAbs(target, data)
}

func (s *recoveryStore) get(id string) (storedRecovery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLocked(id)
}

func (s *recoveryStore) readLocked(id string) (storedRecovery, error) {
	filePath := s.filePath(id)
	info, err := os.Stat(filePath)
	if err != nil {
		return storedRecovery{}, err
	}
	if info.IsDir() {
		return storedRecovery{}, fmt.Errorf("%w: %s is a folder", errInvalidRecoveryEntry, filePath)
	}
	if !info.Mode().IsRegular() || info.Size() > int64(s.maxFile+recoveryFileOverhead) {
		if err := s.backupCorruptLocked(filePath); err != nil {
			return storedRecovery{}, err
		}
		return storedRecovery{}, fs.ErrNotExist
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return storedRecovery{}, err
	}
	var entry storedRecovery
	if err := json.Unmarshal(data, &entry); err != nil {
		if backupErr := s.backupCorruptLocked(filePath); backupErr != nil {
			return storedRecovery{}, fmt.Errorf("recovery: cannot read %s: %w (backup failed: %v)", filePath, err, backupErr)
		}
		return storedRecovery{}, fs.ErrNotExist
	}
	if err := validateRecoveryEntry(entry); err != nil {
		if backupErr := s.backupCorruptLocked(filePath); backupErr != nil {
			return storedRecovery{}, fmt.Errorf("recovery: cannot use %s: %w (backup failed: %v)", filePath, err, backupErr)
		}
		return storedRecovery{}, fs.ErrNotExist
	}
	if len(entry.Text) > s.maxFile {
		if backupErr := s.backupCorruptLocked(filePath); backupErr != nil {
			return storedRecovery{}, fmt.Errorf("recovery: copy %s is too large (backup failed: %v)", filePath, backupErr)
		}
		return storedRecovery{}, fs.ErrNotExist
	}
	entry.Text = normalizeRecoveryText(entry.Text)
	return entry, nil
}

func (s *recoveryStore) remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	err := os.Remove(s.filePath(id))
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (s *recoveryStore) list() ([]storedRecovery, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []storedRecovery{}, nil
	}
	if err != nil {
		return nil, err
	}
	copies := make([]storedRecovery, 0, len(entries))
	for _, item := range entries {
		if item.IsDir() {
			continue
		}
		name := item.Name()
		if strings.Contains(name, ".corrupt-") {
			continue
		}
		if !strings.HasSuffix(name, ".json") {
			_ = s.backupCorruptLocked(filepath.Join(s.dir, name))
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if !validRecoveryID(id) {
			_ = s.backupCorruptLocked(filepath.Join(s.dir, name))
			continue
		}
		copy, err := s.readLocked(id)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		copies = append(copies, copy)
	}
	return copies, nil
}

func (s *recoveryStore) backupCorruptLocked(filePath string) error {
	backup := filePath + ".corrupt-" + time.Now().UTC().Format("20060102T150405.000000000Z")
	if err := os.Rename(filePath, backup); err != nil {
		return fmt.Errorf("rename to %s: %w", backup, err)
	}
	return nil
}

func validateRecoveryEntry(entry storedRecovery) error {
	if entry.Version != recoveryVersion {
		return fmt.Errorf("%w: version %d", errInvalidRecoveryEntry, entry.Version)
	}
	if !validRecoveryLineEnding(entry.LineEnding) {
		return fmt.Errorf("%w: line ending %q", errInvalidRecoveryEntry, entry.LineEnding)
	}
	if _, err := time.Parse(time.RFC3339Nano, entry.SavedAt); err != nil {
		return fmt.Errorf("%w: savedAt %q", errInvalidRecoveryEntry, entry.SavedAt)
	}
	switch entry.Kind {
	case recoveryKindWorkspace:
		if entry.Root == "" || !filepath.IsAbs(entry.Root) {
			return fmt.Errorf("%w: workspace root %q", errInvalidRecoveryEntry, entry.Root)
		}
		if err := validateWorkspaceFile(entry.Path); err != nil {
			return fmt.Errorf("%w: %v", errInvalidRecoveryEntry, err)
		}
	case recoveryKindSingle:
		if entry.Root != "" {
			return fmt.Errorf("%w: single-file root %q", errInvalidRecoveryEntry, entry.Root)
		}
		if !filepath.IsAbs(entry.Path) || !isMarkdownName(entry.Path) {
			return fmt.Errorf("%w: single-file path %q", errInvalidRecoveryEntry, entry.Path)
		}
	default:
		return fmt.Errorf("%w: kind %q", errInvalidRecoveryEntry, entry.Kind)
	}
	return nil
}
