package main

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func writeSnippet(t *testing.T, root, name string, data []byte) string {
	t.Helper()
	target := filepath.Join(root, ".nicole", "snippets", filepath.FromSlash(name))
	mustWriteFile(t, target, data)
	return target
}

func listSnippets(t *testing.T, workspace *Workspace) WorkspaceSnippets {
	t.Helper()
	result, err := workspace.ListSnippets(currentGeneration(workspace))
	if err != nil {
		t.Fatalf("ListSnippets: %v", err)
	}
	return result
}

func TestListSnippetsReadsFixedDirectory(t *testing.T) {
	root := t.TempDir()
	writeSnippet(t, root, "bravo.MD", []byte("\xEF\xBB\xBF第二\r\n{{cursor}}行\r"))
	writeSnippet(t, root, "alpha.md", []byte("{{date}} 第一行\n{{cursor}}"))
	writeSnippet(t, root, "notes.txt", []byte("ignored"))
	writeSnippet(t, root, "nested/hidden.md", []byte("nested"))

	outside := t.TempDir()
	outsideFile := filepath.Join(outside, "outside.md")
	mustWriteFile(t, outsideFile, []byte("outside"))
	link := filepath.Join(root, ".nicole", "snippets", "link.md")
	linked := os.Symlink(outsideFile, link) == nil
	if !linked {
		t.Log("symlinks are unavailable; skipping the link candidate")
	}

	workspace := openTestWorkspace(t, root)
	result := listSnippets(t, workspace)

	if len(result.Snippets) != 2 {
		t.Fatalf("snippets = %#v, want two files", result.Snippets)
	}
	if result.Snippets[0] != (WorkspaceSnippet{
		ID:    "snippet:alpha.md",
		Label: "alpha",
		Body:  "{{date}} 第一行\n{{cursor}}",
	}) {
		t.Errorf("alpha = %#v", result.Snippets[0])
	}
	if result.Snippets[1] != (WorkspaceSnippet{
		ID:    "snippet:bravo.MD",
		Label: "bravo",
		Body:  "第二\n{{cursor}}行\n",
	}) {
		t.Errorf("bravo = %#v", result.Snippets[1])
	}
	if linked {
		if len(result.Warnings) != 1 ||
			!strings.Contains(result.Warnings[0], "link.md") ||
			!strings.Contains(result.Warnings[0], "已跳过") {
			t.Errorf("warnings = %#v, want link.md skipped", result.Warnings)
		}
	}
	if data, err := os.ReadFile(outsideFile); err != nil || string(data) != "outside" {
		t.Errorf("link target changed: %q, %v", data, err)
	}
}

func TestListSnippetsMissingDirectoryIsEmpty(t *testing.T) {
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)
	result := listSnippets(t, workspace)
	if len(result.Snippets) != 0 || len(result.Warnings) != 0 {
		t.Fatalf("snippets = %#v, warnings = %#v", result.Snippets, result.Warnings)
	}
	if _, err := os.Stat(filepath.Join(root, ".nicole")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf(".nicole was created or inaccessible: %v", err)
	}

	mustWriteFile(t, filepath.Join(root, ".nicole", "snippets", "one.md"), []byte("x"))
	if got := listSnippets(t, workspace); len(got.Snippets) != 1 {
		t.Fatalf("snippets after creating the folder = %#v", got.Snippets)
	}
}

func TestListSnippetsSkipsInvalidUtf8AndOversizedFiles(t *testing.T) {
	root := t.TempDir()
	writeSnippet(t, root, "invalid.md", []byte{0xff, 0xfe})
	writeSnippet(t, root, "big.md", bytes.Repeat([]byte("a"), snippetMaxFileBytes+1))
	writeSnippet(t, root, "exact.md", bytes.Repeat([]byte("b"), snippetMaxFileBytes))
	writeSnippet(t, root, "small.md", []byte("ok"))

	workspace := openTestWorkspace(t, root)
	result := listSnippets(t, workspace)

	if len(result.Snippets) != 2 {
		t.Fatalf("snippets = %#v, want exact and small", result.Snippets)
	}
	if result.Snippets[0].Label != "exact" || result.Snippets[1].Label != "small" {
		t.Errorf("labels = %q", []string{
			result.Snippets[0].Label,
			result.Snippets[1].Label,
		})
	}
	if len(result.Warnings) != 2 {
		t.Fatalf("warnings = %#v", result.Warnings)
	}
	if !strings.Contains(result.Warnings[0], "big.md") ||
		!strings.Contains(result.Warnings[0], "64 KiB") {
		t.Errorf("big warning = %q", result.Warnings[0])
	}
	if !strings.Contains(result.Warnings[1], "invalid.md") ||
		!strings.Contains(result.Warnings[1], "UTF-8") {
		t.Errorf("invalid warning = %q", result.Warnings[1])
	}
}

func TestListSnippetsBoundsCandidateCount(t *testing.T) {
	t.Run("exactly the limit", func(t *testing.T) {
		root := t.TempDir()
		for index := 0; index < snippetMaxFiles; index++ {
			writeSnippet(t, root, snippetCandidateName(index), []byte("x"))
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != snippetMaxFiles || len(result.Warnings) != 0 {
			t.Fatalf(
				"snippets = %d, warnings = %#v",
				len(result.Snippets),
				result.Warnings,
			)
		}
	})

	t.Run("one more is refused", func(t *testing.T) {
		root := t.TempDir()
		for index := 0; index <= snippetMaxFiles; index++ {
			writeSnippet(t, root, snippetCandidateName(index), []byte("x"))
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 {
			t.Fatalf("snippets = %#v, want none", result.Snippets)
		}
		if len(result.Warnings) != 1 ||
			!strings.Contains(result.Warnings[0], "100") ||
			!strings.Contains(result.Warnings[0], "未加载") {
			t.Fatalf("warnings = %#v", result.Warnings)
		}
	})
}

func TestListSnippetsBoundsTotalBody(t *testing.T) {
	t.Run("exactly the total", func(t *testing.T) {
		root := t.TempDir()
		for index := 0; index < snippetMaxTotalBytes/snippetMaxFileBytes; index++ {
			writeSnippet(t, root, snippetCandidateName(index), bytes.Repeat([]byte("a"), snippetMaxFileBytes))
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != snippetMaxTotalBytes/snippetMaxFileBytes ||
			len(result.Warnings) != 0 {
			t.Fatalf(
				"snippets = %d, warnings = %#v",
				len(result.Snippets),
				result.Warnings,
			)
		}
	})

	t.Run("one more is refused", func(t *testing.T) {
		root := t.TempDir()
		for index := 0; index <= snippetMaxTotalBytes/snippetMaxFileBytes; index++ {
			writeSnippet(t, root, snippetCandidateName(index), bytes.Repeat([]byte("a"), snippetMaxFileBytes))
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 {
			t.Fatalf("snippets = %d, want none", len(result.Snippets))
		}
		if len(result.Warnings) != 1 ||
			!strings.Contains(result.Warnings[0], "1 MiB") ||
			!strings.Contains(result.Warnings[0], "未加载") {
			t.Fatalf("warnings = %#v", result.Warnings)
		}
	})
}

func TestListSnippetsRejectsLinkedDirectories(t *testing.T) {
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(outside, "outside.md"), []byte("outside"))

	t.Run("parent", func(t *testing.T) {
		root := t.TempDir()
		if err := os.Symlink(outside, filepath.Join(root, ".nicole")); err != nil {
			t.Skipf("symlinks are unavailable: %v", err)
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 || len(result.Warnings) != 1 ||
			!strings.Contains(result.Warnings[0], ".nicole/snippets") {
			t.Fatalf("snippets = %#v, warnings = %#v", result.Snippets, result.Warnings)
		}
	})

	t.Run("snippets", func(t *testing.T) {
		root := t.TempDir()
		mustWriteFile(t, filepath.Join(root, ".nicole", "keep.txt"), []byte("x"))
		if err := os.Symlink(outside, filepath.Join(root, ".nicole", "snippets")); err != nil {
			t.Skipf("symlinks are unavailable: %v", err)
		}
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 || len(result.Warnings) != 1 {
			t.Fatalf("snippets = %#v, warnings = %#v", result.Snippets, result.Warnings)
		}
	})

	t.Run("regular file", func(t *testing.T) {
		root := t.TempDir()
		mustWriteFile(t, filepath.Join(root, ".nicole"), []byte("not a directory"))
		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 || len(result.Warnings) != 1 {
			t.Fatalf("snippets = %#v, warnings = %#v", result.Snippets, result.Warnings)
		}
	})
}

func TestListSnippetsNeedsWorkspaceAndCurrentGeneration(t *testing.T) {
	empty := NewWorkspace()
	if _, err := empty.ListSnippets(1); !errors.Is(err, errNoWorkspace) {
		t.Fatalf("ListSnippets without workspace = %v", err)
	}

	root := t.TempDir()
	writeSnippet(t, root, "one.md", []byte("x"))
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	if _, err := workspace.ListSnippets(generation + 1); !errors.Is(err, errWorkspaceChange) {
		t.Fatalf("stale generation = %v", err)
	}
	if err := workspace.CloseWorkspace(); err != nil {
		t.Fatal(err)
	}
	if _, err := workspace.ListSnippets(generation); !errors.Is(err, errNoWorkspace) {
		t.Fatalf("closed workspace = %v", err)
	}
}

func TestListSnippetsStopsWhenWorkspaceChanges(t *testing.T) {
	root := t.TempDir()
	writeSnippet(t, root, "one.md", []byte("x"))
	writeSnippet(t, root, "two.md", []byte("y"))
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		t.Fatal(err)
	}
	defer rootFS.Close()

	calls := 0
	_, _, err = listSnippetsFromRoot(rootFS, func() bool {
		calls++
		return calls > 3
	})
	if !errors.Is(err, errWorkspaceChange) {
		t.Fatalf("stop error = %v, want workspace change", err)
	}
}

func TestListSnippetsReportsPermissionErrors(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not enforce these permission bits")
	}
	if os.Geteuid() == 0 {
		t.Skip("root can read mode 0 directories")
	}

	t.Run("directory", func(t *testing.T) {
		root := t.TempDir()
		writeSnippet(t, root, "one.md", []byte("x"))
		dir := filepath.Join(root, ".nicole", "snippets")
		if err := os.Chmod(dir, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(dir, 0o755) })

		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 0 || len(result.Warnings) != 1 ||
			!strings.Contains(result.Warnings[0], "没有读取权限") {
			t.Fatalf("snippets = %#v, warnings = %#v", result.Snippets, result.Warnings)
		}
	})

	t.Run("file", func(t *testing.T) {
		root := t.TempDir()
		blocked := writeSnippet(t, root, "blocked.md", []byte("x"))
		writeSnippet(t, root, "open.md", []byte("y"))
		if err := os.Chmod(blocked, 0); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.Chmod(blocked, 0o644) })

		result := listSnippets(t, openTestWorkspace(t, root))
		if len(result.Snippets) != 1 || result.Snippets[0].Label != "open" {
			t.Fatalf("snippets = %#v", result.Snippets)
		}
		if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "blocked.md") {
			t.Fatalf("warnings = %#v", result.Warnings)
		}
	})
}

func TestListSnippetsDoesNotReuseWorkspaceFileRules(t *testing.T) {
	root := t.TempDir()
	writeSnippet(t, root, ".draft.md", []byte("hidden file is still a template"))
	writeSnippet(t, root, "daily.md", []byte("visible"))

	result := listSnippets(t, openTestWorkspace(t, root))
	labels := make([]string, 0, len(result.Snippets))
	for _, snippet := range result.Snippets {
		labels = append(labels, snippet.Label)
	}
	if !reflect.DeepEqual(labels, []string{".draft", "daily"}) {
		t.Fatalf("labels = %#v", labels)
	}
}

func snippetCandidateName(index int) string {
	return fmt.Sprintf("template-%03d.md", index)
}
