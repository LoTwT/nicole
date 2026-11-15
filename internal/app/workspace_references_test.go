package app

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func referenceRequest(t *testing.T, workspace *Workspace, source, name string, updates []WorkspaceReferenceDocument) WorkspaceReferenceRenameRequest {
	t.Helper()
	generation := currentGeneration(workspace)
	snapshot, err := workspace.ReadReferenceSnapshot(generation)
	if err != nil {
		t.Fatal(err)
	}
	return WorkspaceReferenceRenameRequest{Source: source, Name: name, Generation: generation, Documents: snapshot.Files, Updates: updates}
}

func TestReferenceRenamePreservesBytesAndRewritesMovedDocuments(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "notes"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWriteFile(t, filepath.Join(root, "notes", "a.md"), []byte("\xef\xbb\xbf[a](../outside.md)\r\n"))
	mustWriteFile(t, filepath.Join(root, "outside.md"), []byte("[a](notes/a.md#heading)\r\n"))
	if err := os.Chmod(filepath.Join(root, "outside.md"), 0o664); err != nil {
		t.Fatal(err)
	}
	workspace := openTestWorkspace(t, root)
	request := referenceRequest(t, workspace, "notes", "renamed", []WorkspaceReferenceDocument{{Path: "outside.md", Content: "[a](renamed/a.md#heading)\r\n"}})
	result, err := workspace.RenameEntryWithReferences(request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Path != "renamed" || len(result.UpdatedFiles) != 1 || result.UpdatedFiles[0] != "outside.md" {
		t.Fatalf("result = %#v", result)
	}
	data, err := os.ReadFile(filepath.Join(root, "renamed", "a.md"))
	if err != nil || string(data) != "\xef\xbb\xbf[a](../outside.md)\r\n" {
		t.Fatalf("moved bytes = %q, %v", data, err)
	}
	data, _ = os.ReadFile(filepath.Join(root, "outside.md"))
	if string(data) != request.Updates[0].Content {
		t.Fatalf("updated bytes = %q", data)
	}
	info, err := os.Stat(filepath.Join(root, "outside.md"))
	if err != nil || runtime.GOOS != "windows" && info.Mode().Perm() != 0o664 {
		t.Fatalf("updated mode = %v, %v", info, err)
	}
	backups, _ := filepath.Glob(filepath.Join(root, ".nicole-reference-backup-*"))
	if len(backups) != 0 {
		t.Fatalf("successful operation left backups: %v", backups)
	}
}

func TestReferenceRenameRejectsStaleSnapshotWithoutChangingFiles(t *testing.T) {
	for _, change := range []string{"content", "listing", "target", "generation", "readonly", "unknown update"} {
		t.Run(change, func(t *testing.T) {
			root := t.TempDir()
			mustWriteFile(t, filepath.Join(root, "a.md"), []byte("[a](a.md)"))
			workspace := openTestWorkspace(t, root)
			request := referenceRequest(t, workspace, "a.md", "b.md", []WorkspaceReferenceDocument{{Path: "a.md", Content: "[a](b.md)"}})
			switch change {
			case "content":
				mustWriteFile(t, filepath.Join(root, "a.md"), []byte("external"))
			case "listing":
				mustWriteFile(t, filepath.Join(root, "new.md"), []byte("external"))
			case "target":
				mustWriteFile(t, filepath.Join(root, "b.md"), []byte("external"))
			case "generation":
				request.Generation--
			case "readonly":
				if err := os.Chmod(filepath.Join(root, "a.md"), 0o444); err != nil {
					t.Fatal(err)
				}
			case "unknown update":
				request.Updates[0].Path = "other.md"
			}
			if _, err := workspace.RenameEntryWithReferences(request); err == nil {
				t.Fatal("stale/invalid rename succeeded")
			}
			data, err := os.ReadFile(filepath.Join(root, "a.md"))
			want := "[a](a.md)"
			if change == "content" {
				want = "external"
			}
			if err != nil || string(data) != want {
				t.Fatalf("source changed: %q, %v", data, err)
			}
		})
	}
}

func TestReferenceRenameRollsBackCompletedFilesAndKeepsRecoveryCopies(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("[b](b.md)"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("[b](b.md)"))
	workspace := openTestWorkspace(t, root)
	request := referenceRequest(t, workspace, "b.md", "renamed.md", []WorkspaceReferenceDocument{{Path: "a.md", Content: "[b](renamed.md)"}, {Path: "b.md", Content: "[b](renamed.md)"}})
	_, err := workspace.renameEntryWithReferences(request, func(index int, _ string) error {
		if index == 1 {
			return errors.New("injected write failure")
		}
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "manifest.json") {
		t.Fatalf("error = %v", err)
	}
	for _, file := range []string{"a.md", "b.md"} {
		data, readErr := os.ReadFile(filepath.Join(root, file))
		if readErr != nil || string(data) != "[b](b.md)" {
			t.Fatalf("rollback %s = %q, %v", file, data, readErr)
		}
	}
	backups, _ := filepath.Glob(filepath.Join(root, ".nicole-reference-backup-*", "manifest.json"))
	if len(backups) != 1 {
		t.Fatalf("missing recovery manifest: %v", backups)
	}
}

func TestReferenceRenameDoesNotOverwriteExternalChangeDuringRollback(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "a.md"), []byte("[b](b.md)"))
	mustWriteFile(t, filepath.Join(root, "b.md"), []byte("[b](b.md)"))
	workspace := openTestWorkspace(t, root)
	request := referenceRequest(t, workspace, "b.md", "renamed.md", []WorkspaceReferenceDocument{{Path: "a.md", Content: "[b](renamed.md)"}, {Path: "b.md", Content: "[b](renamed.md)"}})
	_, err := workspace.renameEntryWithReferences(request, func(index int, _ string) error {
		if index == 1 {
			mustWriteFile(t, filepath.Join(root, "a.md"), []byte("external after first write"))
			mustWriteFile(t, filepath.Join(root, "renamed.md"), []byte("external before second write"))
		}
		return nil
	})
	if err == nil {
		t.Fatal("external change was not rejected")
	}
	data, _ := os.ReadFile(filepath.Join(root, "a.md"))
	if string(data) != "external after first write" {
		t.Fatalf("external edit lost: %q", data)
	}
	data, readErr := os.ReadFile(filepath.Join(root, "b.md"))
	if readErr != nil || string(data) != "external before second write" {
		t.Fatalf("external source edit lost: %q, %v", data, readErr)
	}
}

func TestReferenceSnapshotRejectsInvalidUTF8AndOversizeWithoutPartialResults(t *testing.T) {
	for _, data := range [][]byte{{0xff}, []byte(strings.Repeat("x", maxReferenceFileBytes+1))} {
		root := t.TempDir()
		mustWriteFile(t, filepath.Join(root, "a.md"), []byte("small"))
		mustWriteFile(t, filepath.Join(root, "b.md"), data)
		workspace := openTestWorkspace(t, root)
		if result, err := workspace.ReadReferenceSnapshot(currentGeneration(workspace)); err == nil || len(result.Files) != 0 {
			t.Fatalf("snapshot = %#v, %v", result, err)
		}
	}
}
