package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	// User templates live in one fixed folder below the open root. The page
	// never names a folder or a file, so this path is the only place the
	// service reads outside the normal workspace file rules.
	snippetsParentDir = ".nicole"
	snippetsDir       = "snippets"

	// The limits keep one menu load bounded. Candidates are the .md names the
	// directory reports, so a directory with too many of them is refused before
	// any file is read.
	snippetMaxFiles      = 100
	snippetMaxFileBytes  = 64 * 1024
	snippetMaxTotalBytes = 1024 * 1024

	// Template ids must not collide with registry ids such as editor.bold.
	snippetIDPrefix = "snippet:"
)

var (
	errSnippetNotDir  = errors.New("workspace: snippet directory is not a regular folder")
	errSnippetChanged = errors.New("workspace: snippet directory changed while reading")
	errSnippetTooMany = errors.New("workspace: too many snippet files")
)

// WorkspaceSnippet is one user template. Body keeps the variable markers as
// text; the page expands them when the command runs, so {{date}} uses the
// execution day rather than the snapshot day.
type WorkspaceSnippet struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Body  string `json:"body"`
}

// WorkspaceSnippets is one bounded snapshot of .nicole/snippets. Warnings are
// ready to show to the user and name every skipped file. A missing directory
// returns empty slices and no warnings; other failures still return the
// built-in commands to the page and explain themselves here.
type WorkspaceSnippets struct {
	Snippets []WorkspaceSnippet `json:"snippets"`
	Warnings []string           `json:"warnings"`
}

// ListSnippets reads the user templates of the open workspace. generation
// must still name the current root; the request names no path, so the page
// cannot read any other directory. The fixed folder is read only and is never
// created. Files are read through the same non-blocking, identity-checked
// primitive as workspace search, limited to 64 KiB per file and 1 MiB in
// total.
func (w *Workspace) ListSnippets(generation int) (WorkspaceSnippets, error) {
	root, err := w.currentRoot(generation)
	if err != nil {
		return WorkspaceSnippets{}, err
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		return WorkspaceSnippets{}, err
	}
	defer rootFS.Close()

	stop := func() bool {
		currentRoot, currentGeneration := w.state.snapshot()
		return currentRoot != root || currentGeneration != generation
	}
	snippets, warnings, err := listSnippetsFromRoot(rootFS, stop)
	if err != nil {
		return WorkspaceSnippets{}, err
	}
	if snippets == nil {
		snippets = []WorkspaceSnippet{}
	}
	if warnings == nil {
		warnings = []string{}
	}
	return WorkspaceSnippets{Snippets: snippets, Warnings: warnings}, nil
}

// listSnippetsFromRoot reads one snapshot below the workspace root. stop is
// checked while walking the directory and between files; a changed root or
// generation ends the read with errWorkspaceChange instead of returning a
// snapshot for another folder.
func listSnippetsFromRoot(root *os.Root, stop func() bool) ([]WorkspaceSnippet, []string, error) {
	parent, err := openSnippetDir(root, snippetsParentDir, stop)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil, nil
		}
		if errors.Is(err, errWorkspaceChange) {
			return nil, nil, err
		}
		return nil, []string{snippetDirWarning(err)}, nil
	}
	defer parent.Close()

	snippetsRoot, err := openSnippetDir(parent, snippetsDir, stop)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, nil, nil
		}
		if errors.Is(err, errWorkspaceChange) {
			return nil, nil, err
		}
		return nil, []string{snippetDirWarning(err)}, nil
	}
	defer snippetsRoot.Close()

	names, err := snippetFileNames(snippetsRoot, stop)
	if err != nil {
		if errors.Is(err, errWorkspaceChange) {
			return nil, nil, err
		}
		if errors.Is(err, errSnippetTooMany) {
			return nil, []string{fmt.Sprintf(
				"用户模板目录的 .md 文件超过 %d 个，未加载用户模板",
				snippetMaxFiles,
			)}, nil
		}
		return nil, []string{snippetDirWarning(err)}, nil
	}

	snippets := make([]WorkspaceSnippet, 0, len(names))
	warnings := make([]string, 0)
	total := 0
	for _, name := range names {
		if stop() {
			return nil, nil, errWorkspaceChange
		}
		data, err := readSnippetFile(snippetsRoot, name, stop)
		if err != nil {
			if errors.Is(err, errWorkspaceChange) {
				return nil, nil, err
			}
			warnings = append(warnings, snippetFileWarning(name, err))
			continue
		}
		data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF})
		if !utf8.Valid(data) {
			warnings = append(warnings, fmt.Sprintf("用户模板“%s”不是有效的 UTF-8 文本，已跳过", name))
			continue
		}
		// The editor always uses LF; the template's own line endings are not
		// written back anywhere, so normalize on the way in.
		body := normalizeSearchNewlines(string(data))
		if total+len(body) > snippetMaxTotalBytes {
			reason := fmt.Sprintf(
				"用户模板正文合计超过 %d MiB，未加载用户模板",
				snippetMaxTotalBytes/(1024*1024),
			)
			return nil, append([]string{reason}, warnings...), nil
		}
		total += len(body)
		label := strings.TrimSuffix(name, filepath.Ext(name))
		if label == "" {
			label = name
		}
		snippets = append(snippets, WorkspaceSnippet{
			ID:    snippetIDPrefix + name,
			Label: label,
			Body:  body,
		})
	}
	return snippets, warnings, nil
}

// openSnippetDir opens one fixed subdirectory without following a symlink and
// checks that it still names the same directory after opening. The caller
// closes the returned root.
func openSnippetDir(parent *os.Root, name string, stop func() bool) (*os.Root, error) {
	if stop() {
		return nil, errWorkspaceChange
	}
	before, err := parent.Lstat(name)
	if err != nil {
		return nil, err
	}
	if before.Mode()&fs.ModeSymlink != 0 || !before.IsDir() {
		return nil, errSnippetNotDir
	}
	dir, err := parent.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	opened, statErr := dir.Stat(".")
	after, afterErr := parent.Lstat(name)
	if statErr != nil || afterErr != nil ||
		after.Mode()&fs.ModeSymlink != 0 || !after.IsDir() ||
		!os.SameFile(before, opened) || !os.SameFile(opened, after) {
		_ = dir.Close()
		if statErr != nil {
			return nil, statErr
		}
		if afterErr != nil {
			return nil, afterErr
		}
		return nil, errSnippetChanged
	}
	if stop() {
		_ = dir.Close()
		return nil, errWorkspaceChange
	}
	return dir, nil
}

// snippetFileNames lists at most snippetMaxFiles .md candidates. ReadDir is
// called in bounded batches, and enumeration stops as soon as one more
// candidate exists, so a folder with many files is not collected in full.
func snippetFileNames(dir *os.Root, stop func() bool) ([]string, error) {
	file, err := dir.Open(".")
	if err != nil {
		return nil, err
	}
	defer file.Close()

	names := make([]string, 0, 16)
	for {
		if stop() {
			return nil, errWorkspaceChange
		}
		entries, readErr := file.ReadDir(64)
		for _, entry := range entries {
			if !isMarkdownName(entry.Name()) {
				continue
			}
			if len(names) == snippetMaxFiles {
				return nil, errSnippetTooMany
			}
			names = append(names, entry.Name())
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
	}
	sort.Strings(names)
	return names, nil
}

// readSnippetFile reuses the search reader's bounded, non-blocking and
// identity-checked file opening. The additional byte limit is checked before
// the buffer grows, so a large file is skipped without being read in full.
func readSnippetFile(dir *os.Root, name string, stop func() bool) ([]byte, error) {
	return readRegularFile(dir, name, snippetMaxFileBytes, stop)
}

func snippetDirWarning(err error) string {
	switch {
	case errors.Is(err, errSnippetNotDir):
		return fmt.Sprintf("用户模板目录 %s/%s 不是普通文件夹，已忽略", snippetsParentDir, snippetsDir)
	case errors.Is(err, errSnippetChanged):
		return fmt.Sprintf("用户模板目录 %s/%s 在读取期间发生变化，已忽略", snippetsParentDir, snippetsDir)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Sprintf("无法读取用户模板目录 %s/%s（没有读取权限）", snippetsParentDir, snippetsDir)
	default:
		return fmt.Sprintf("无法读取用户模板目录 %s/%s：%s", snippetsParentDir, snippetsDir, err)
	}
}

func snippetFileWarning(name string, err error) string {
	switch {
	case errors.Is(err, errFileReadLimit):
		return fmt.Sprintf(
			"用户模板“%s”超过 %d KiB，已跳过",
			name,
			snippetMaxFileBytes/1024,
		)
	case errors.Is(err, errSearchSkip):
		return fmt.Sprintf("用户模板“%s”是符号链接、不是普通文件或路径不安全，已跳过", name)
	case errors.Is(err, fs.ErrNotExist):
		return fmt.Sprintf("用户模板“%s”已不存在，已跳过", name)
	case errors.Is(err, fs.ErrPermission):
		return fmt.Sprintf("无法读取用户模板“%s”（没有读取权限），已跳过", name)
	default:
		return fmt.Sprintf("无法读取用户模板“%s”：%s", name, err)
	}
}
