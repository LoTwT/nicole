//go:build unix

package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
)

func TestPasteImageFallsBackWhenHardLinksAreUnsupported(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "chapter.md"), []byte("# Chapter"))
	existing := []byte("existing image")
	existingPath := filepath.Join(root, "assets", "image-20261101-120000.png")
	mustWriteFile(t, existingPath, existing)
	workspace := openTestWorkspace(t, root)

	assets := testAssets(workspace, fakeClipboard{image: testPNG()})
	assets.write = func(root *os.Root, target string, data []byte, mode fs.FileMode) error {
		return writeNewWorkspaceFileWith(root, target, data, mode, func(*os.Root, string, string) error {
			return syscall.ENOTSUP
		})
	}

	images, err := assets.PasteImage("chapter.md", currentGeneration(workspace))
	if err != nil {
		t.Fatal(err)
	}
	if len(images) != 1 || images[0].Path != "assets/image-20261101-120000-2.png" {
		t.Fatalf("PasteImage() = %+v, want the next suffix", images)
	}

	data, err := os.ReadFile(existingPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, existing) {
		t.Errorf("existing image = %q, want %q", data, existing)
	}
	data, err = os.ReadFile(filepath.Join(root, "assets", "image-20261101-120000-2.png"))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(data, testPNG()) {
		t.Errorf("fallback image = %q, want %q", data, testPNG())
	}

	entries, err := os.ReadDir(filepath.Join(root, "assets"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), tempFilePrefix) {
			t.Errorf("fallback left temporary file %q", entry.Name())
		}
	}
}

func TestHardLinkUnsupportedErrors(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		want bool
	}{
		{"not supported", syscall.ENOTSUP, true},
		{"operation not supported", syscall.EOPNOTSUPP, true},
		{"cross device", syscall.EXDEV, true},
		{"permission", syscall.EPERM, true},
		{"other", errors.New("not a link error"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := hardLinkUnsupported(test.err); got != test.want {
				t.Errorf("hardLinkUnsupported(%v) = %v, want %v", test.err, got, test.want)
			}
		})
	}
}
