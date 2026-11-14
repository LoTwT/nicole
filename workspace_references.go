package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const (
	maxReferenceFiles      = 2000
	maxReferenceFileBytes  = 2 * 1024 * 1024
	maxReferenceTotalBytes = 20 * 1024 * 1024
)

// WorkspaceReferenceDocument carries original bytes, including line endings.
type WorkspaceReferenceDocument struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type WorkspaceReferenceSnapshot struct {
	Files []WorkspaceReferenceDocument `json:"files"`
}

// Documents must be the complete original snapshot, not unsaved tab text.
// Updates contains only changed disk documents, under their original paths.
type WorkspaceReferenceRenameRequest struct {
	Source     string                       `json:"source"`
	Name       string                       `json:"name"`
	Generation int                          `json:"generation"`
	Documents  []WorkspaceReferenceDocument `json:"documents"`
	Updates    []WorkspaceReferenceDocument `json:"updates"`
}

type WorkspaceReferenceRenameResult struct {
	Path         string   `json:"path"`
	UpdatedFiles []string `json:"updatedFiles"`
}

// ReadReferenceSnapshot does not expand the ListFiles authorization boundary.
// Any skipped, invalid or oversized document rejects the complete operation.
func (w *Workspace) ReadReferenceSnapshot(generation int) (WorkspaceReferenceSnapshot, error) {
	w.state.mu.RLock()
	defer w.state.mu.RUnlock()
	if w.state.root == "" {
		return WorkspaceReferenceSnapshot{}, errNoWorkspace
	}
	if generation != w.state.generation {
		return WorkspaceReferenceSnapshot{}, errWorkspaceChange
	}
	root, err := os.OpenRoot(w.state.root)
	if err != nil {
		return WorkspaceReferenceSnapshot{}, err
	}
	defer root.Close()
	return readReferenceSnapshot(root)
}

func readReferenceSnapshot(root *os.Root) (WorkspaceReferenceSnapshot, error) {
	files, err := listMarkdownFiles(root)
	if err != nil {
		return WorkspaceReferenceSnapshot{}, err
	}
	if len(files) > maxReferenceFiles {
		return WorkspaceReferenceSnapshot{}, fmt.Errorf("工作区超过 %d 个 Markdown 文件，无法安全更新引用", maxReferenceFiles)
	}
	result := WorkspaceReferenceSnapshot{Files: make([]WorkspaceReferenceDocument, 0, len(files))}
	total := 0
	for _, file := range files {
		data, err := readRegularFile(root, file, maxReferenceFileBytes, func() bool { return false })
		if err != nil {
			return WorkspaceReferenceSnapshot{}, fmt.Errorf("无法检查引用文件 %s：%w", file, err)
		}
		if !utf8.Valid(data) {
			return WorkspaceReferenceSnapshot{}, fmt.Errorf("文件 %s 不是 UTF-8，重命名前请先处理编码", file)
		}
		total += len(data)
		if total > maxReferenceTotalBytes {
			return WorkspaceReferenceSnapshot{}, fmt.Errorf("Markdown 内容合计超过 20 MiB，无法安全更新引用")
		}
		result.Files = append(result.Files, WorkspaceReferenceDocument{Path: file, Content: string(data)})
	}
	return result, nil
}

type referenceBackupEntry struct {
	Path    string `json:"path"`
	NewPath string `json:"newPath"`
	Before  string `json:"before"`
	After   string `json:"after"`
}

type referenceBackupManifest struct {
	Version int                    `json:"version"`
	Source  string                 `json:"source"`
	Target  string                 `json:"target"`
	IsDir   bool                   `json:"isDir"`
	Files   []referenceBackupEntry `json:"files"`
}

func renamedWorkspaceReferencePath(file, source, target string, isDir bool) string {
	if file == source || isDir && strings.HasPrefix(file, source+"/") {
		return target + strings.TrimPrefix(file, source)
	}
	return file
}

func validateReferenceDocuments(documents []WorkspaceReferenceDocument) (map[string]string, error) {
	if len(documents) > maxReferenceFiles {
		return nil, fmt.Errorf("引用快照文件数超限")
	}
	result := make(map[string]string, len(documents))
	total := 0
	for _, document := range documents {
		if err := validateWorkspaceFile(document.Path); err != nil {
			return nil, err
		}
		if _, exists := result[document.Path]; exists {
			return nil, fmt.Errorf("引用快照有重复路径：%s", document.Path)
		}
		if len(document.Content) > maxReferenceFileBytes || !utf8.ValidString(document.Content) {
			return nil, fmt.Errorf("引用文件过大或编码无效：%s", document.Path)
		}
		total += len(document.Content)
		if total > maxReferenceTotalBytes {
			return nil, fmt.Errorf("引用快照内容超限")
		}
		result[document.Path] = document.Content
	}
	return result, nil
}

func verifyReferenceSnapshot(root *os.Root, expected map[string]string) error {
	current, err := readReferenceSnapshot(root)
	if err != nil {
		return err
	}
	if len(current.Files) != len(expected) {
		return fmt.Errorf("工作区文件清单已变化，请重新重命名")
	}
	for _, file := range current.Files {
		before, exists := expected[file.Path]
		if !exists || file.Content != before {
			return fmt.Errorf("文件 %s 已被外部修改，重命名已取消", file.Path)
		}
	}
	return nil
}

// RenameEntryWithReferences stages every result and a durable recovery copy
// before touching source files. This is a recoverable batch, not an OS-wide
// multi-file transaction. The frontend serializes its own saves and keeps all
// dirty overlays in memory; this method accepts disk snapshot bytes only.
func (w *Workspace) RenameEntryWithReferences(request WorkspaceReferenceRenameRequest) (WorkspaceReferenceRenameResult, error) {
	return w.renameEntryWithReferences(request, nil)
}

func (w *Workspace) renameEntryWithReferences(request WorkspaceReferenceRenameRequest, beforeReplace func(int, string) error) (WorkspaceReferenceRenameResult, error) {
	w.referenceMu.Lock()
	defer w.referenceMu.Unlock()
	// Pin the generation until the operation finishes, including rollback.
	w.state.mu.RLock()
	defer w.state.mu.RUnlock()
	if w.state.root == "" {
		return WorkspaceReferenceRenameResult{}, errNoWorkspace
	}
	if request.Generation != w.state.generation {
		return WorkspaceReferenceRenameResult{}, errWorkspaceChange
	}
	rootPath := w.state.root
	source, sourceInfo, err := resolveTreeEntry(rootPath, request.Source)
	if err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	if source != request.Source {
		return WorkspaceReferenceRenameResult{}, fmt.Errorf("重命名来源路径已变化，请刷新文件树")
	}
	if err := validateTreeName(request.Name); err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	target := path.Join(path.Dir(source), request.Name)
	if err := validateTreePath(target); err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	if source == target {
		return WorkspaceReferenceRenameResult{Path: target, UpdatedFiles: []string{}}, nil
	}
	expected, err := validateReferenceDocuments(request.Documents)
	if err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	updates, err := validateReferenceDocuments(request.Updates)
	if err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	for file := range updates {
		if _, exists := expected[file]; !exists {
			return WorkspaceReferenceRenameResult{}, fmt.Errorf("更新路径不在引用快照内：%s", file)
		}
	}
	root, err := os.OpenRoot(rootPath)
	if err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	defer root.Close()
	if err := referenceTargetAbsent(root, target); err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := verifyReferenceSnapshot(root, expected); err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	files := make([]string, 0, len(updates))
	for file, content := range updates {
		if expected[file] == content {
			continue
		}
		info, err := root.Lstat(filepath.FromSlash(file))
		if err != nil {
			return WorkspaceReferenceRenameResult{}, err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o222 == 0 {
			return WorkspaceReferenceRenameResult{}, fmt.Errorf("无法更新只读或非常规文件：%s", file)
		}
		files = append(files, file)
	}
	sort.Strings(files)
	backupName, err := newTempFileName()
	if err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	// Deliberately not an auto-cleaned .nicole-*.tmp: crash evidence survives.
	backup := ".nicole-reference-backup-" + strings.TrimSuffix(strings.TrimPrefix(backupName, tempFilePrefix), tempFileSuffix)
	if err := root.Mkdir(backup, 0o700); err != nil {
		return WorkspaceReferenceRenameResult{}, err
	}
	manifest := referenceBackupManifest{Version: 1, Source: source, Target: target, IsDir: sourceInfo.IsDir(), Files: []referenceBackupEntry{}}
	cleanStage := func() { _ = root.RemoveAll(backup) }
	for index, file := range files {
		beforeName, afterName := fmt.Sprintf("%d.before", index), fmt.Sprintf("%d.after", index)
		info, err := root.Lstat(filepath.FromSlash(file))
		if err != nil {
			cleanStage()
			return WorkspaceReferenceRenameResult{}, err
		}
		for _, item := range []struct {
			name, content string
			mode          fs.FileMode
		}{{beforeName, expected[file], 0o600}, {afterName, updates[file], info.Mode().Perm()}} {
			if err := writeReferenceStage(root, path.Join(backup, item.name), []byte(item.content), item.mode); err != nil {
				cleanStage()
				return WorkspaceReferenceRenameResult{}, err
			}
		}
		manifest.Files = append(manifest.Files, referenceBackupEntry{Path: file, NewPath: renamedWorkspaceReferencePath(file, source, target, sourceInfo.IsDir()), Before: beforeName, After: afterName})
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := writeReferenceStage(root, path.Join(backup, "manifest.json"), data, 0o600); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := writeReferenceStage(root, path.Join(backup, "README.txt"), []byte("这是 Nicole 重命名/引用更新的恢复副本。\nmanifest.json 记录原路径、重命名目标和各文件的修改前副本（*.before）。\n若操作失败或应用中断，请先关闭 Nicole，再核对现有文件与副本；不要直接覆盖包含外部更新的文件。\n确认后可按 manifest 手动恢复原文件内容及名称。此目录不会被临时文件清理自动删除。\n"), 0o600); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := syncRootDirectory(root, backup); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := syncRootDirectory(root, "."); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := verifyReferenceSnapshot(root, expected); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	currentSource, err := root.Lstat(filepath.FromSlash(source))
	if err != nil || !os.SameFile(sourceInfo, currentSource) {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, fmt.Errorf("重命名来源已变化，操作已取消")
	}
	if err := referenceTargetAbsent(root, target); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	if err := retryRename(func() error { return root.Rename(filepath.FromSlash(source), filepath.FromSlash(target)) }); err != nil {
		cleanStage()
		return WorkspaceReferenceRenameResult{}, err
	}
	completed := make([]referenceBackupEntry, 0, len(manifest.Files))
	fail := func(cause error) (WorkspaceReferenceRenameResult, error) {
		rollbackErr := w.rollbackReferenceRename(root, rootPath, source, target, sourceInfo, completed, expected, updates)
		rollbackMessage := "已恢复原名称及已写文件，外部更新保留"
		if rollbackErr != nil {
			rollbackMessage = "部分内容未恢复：" + rollbackErr.Error()
		}
		return WorkspaceReferenceRenameResult{}, fmt.Errorf("重命名或引用更新失败：%v；恢复副本保留在 %s（manifest.json 记录原路径）。回滚结果：%s", cause, filepath.Join(rootPath, backup), rollbackMessage)
	}
	for index, entry := range manifest.Files {
		if beforeReplace != nil {
			if err := beforeReplace(index, entry.NewPath); err != nil {
				return fail(err)
			}
		}
		current, _, err := readReferenceBytes(root, entry.NewPath)
		if err != nil || string(current) != expected[entry.Path] {
			return fail(fmt.Errorf("文件 %s 已变化，未覆盖该文件", entry.NewPath))
		}
		w.writes.record(entry.NewPath, []byte(updates[entry.Path]))
		if err := retryRename(func() error {
			return root.Rename(filepath.FromSlash(path.Join(backup, entry.After)), filepath.FromSlash(entry.NewPath))
		}); err != nil {
			w.writes.forget(entry.NewPath)
			return fail(err)
		}
		completed = append(completed, entry)
		w.recordDiskHash(rootPath, entry.NewPath, entry.NewPath, []byte(updates[entry.Path]))
		if err := syncRootDirectory(root, path.Dir(entry.NewPath)); err != nil {
			return fail(err)
		}
	}
	if err := syncRootDirectory(root, path.Dir(target)); err != nil {
		return fail(err)
	}
	for file, content := range expected {
		moved := renamedWorkspaceReferencePath(file, source, target, sourceInfo.IsDir())
		if updated, exists := updates[file]; exists {
			content = updated
		}
		if moved != file {
			w.recordDiskHash(rootPath, moved, moved, []byte(content))
		}
	}
	if err := root.RemoveAll(backup); err != nil {
		// All writes succeeded. A leftover backup is harmless and recoverable;
		// reporting this as a failed rename would leave frontend tab paths stale.
		return WorkspaceReferenceRenameResult{Path: target, UpdatedFiles: referenceUpdatedPaths(manifest)}, nil
	}
	return WorkspaceReferenceRenameResult{Path: target, UpdatedFiles: referenceUpdatedPaths(manifest)}, nil
}

func referenceUpdatedPaths(manifest referenceBackupManifest) []string {
	result := make([]string, 0, len(manifest.Files))
	for _, file := range manifest.Files {
		result = append(result, file.NewPath)
	}
	return result
}

func referenceTargetAbsent(root *os.Root, target string) error {
	if _, err := root.Lstat(filepath.FromSlash(target)); err == nil {
		return fmt.Errorf("%w: %s", errTargetExists, target)
	} else if !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

func writeReferenceStage(root *os.Root, name string, data []byte, mode fs.FileMode) error {
	file, err := root.OpenFile(filepath.FromSlash(name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, writeErr := file.Write(data)
	chmodErr := file.Chmod(mode.Perm())
	syncErr := file.Sync()
	closeErr := file.Close()
	return errors.Join(writeErr, chmodErr, syncErr, closeErr)
}

// This reader also accepts a renamed document whose extension changed. All
// callers first prove its original path was in the Markdown snapshot.
func readReferenceBytes(root *os.Root, rel string) ([]byte, fs.FileInfo, error) {
	if err := validateTreePath(rel); err != nil {
		return nil, nil, err
	}
	current := root
	var opened []*os.Root
	defer func() {
		for _, directory := range opened {
			_ = directory.Close()
		}
	}()
	parts := strings.Split(rel, "/")
	for _, part := range parts[:len(parts)-1] {
		before, err := current.Lstat(part)
		if err != nil {
			return nil, nil, err
		}
		if !before.IsDir() || before.Mode()&fs.ModeSymlink != 0 {
			return nil, nil, errSymlinkEntry
		}
		next, err := current.OpenRoot(part)
		if err != nil {
			return nil, nil, err
		}
		opened = append(opened, next)
		after, err := next.Stat(".")
		if err != nil || !os.SameFile(before, after) {
			return nil, nil, errOpenChanged
		}
		current = next
	}
	name := parts[len(parts)-1]
	before, err := current.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, nil, errNotRegular
	}
	file, err := openSearchFile(current, name)
	if err != nil {
		return nil, nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !os.SameFile(before, info) {
		return nil, nil, errOpenChanged
	}
	data, err := io.ReadAll(io.LimitReader(file, maxReferenceFileBytes+1))
	if err != nil {
		return nil, nil, err
	}
	if len(data) > maxReferenceFileBytes {
		return nil, nil, fmt.Errorf("文件过大：%s", rel)
	}
	after, err := current.Lstat(name)
	if err != nil || !os.SameFile(info, after) {
		return nil, nil, errOpenChanged
	}
	return data, info, nil
}

func (w *Workspace) rollbackReferenceRename(root *os.Root, rootPath, source, target string, sourceInfo fs.FileInfo, completed []referenceBackupEntry, expected, updates map[string]string) error {
	var failures []error
	for index := len(completed) - 1; index >= 0; index-- {
		entry := completed[index]
		current, info, err := readReferenceBytes(root, entry.NewPath)
		if err != nil || !bytes.Equal(current, []byte(updates[entry.Path])) {
			failures = append(failures, fmt.Errorf("%s 有更新，未覆盖", entry.NewPath))
			continue
		}
		original := []byte(expected[entry.Path])
		w.writes.record(entry.NewPath, original)
		if err := writeWorkspaceFile(root, entry.NewPath, original, info.Mode().Perm()); err != nil {
			w.writes.forget(entry.NewPath)
			failures = append(failures, err)
		} else {
			w.recordDiskHash(rootPath, entry.NewPath, entry.NewPath, original)
		}
	}
	if err := referenceTargetAbsent(root, source); err != nil {
		failures = append(failures, err)
	} else {
		current, err := root.Lstat(filepath.FromSlash(target))
		// Updating the renamed source replaces its inode; unchanged content is
		// still safe to move, while an unrelated replacement is left in place.
		safe := err == nil && os.SameFile(sourceInfo, current)
		if !safe && !sourceInfo.IsDir() {
			data, _, readErr := readReferenceBytes(root, target)
			original, tracked := expected[source]
			safe = tracked && readErr == nil && string(data) == original
		}
		if !safe {
			failures = append(failures, fmt.Errorf("%s 已变化，未反向改名", target))
		} else if err := root.Rename(filepath.FromSlash(target), filepath.FromSlash(source)); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
