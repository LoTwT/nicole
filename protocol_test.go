package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func imageRequest(state *workspaceState, method, target string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, target, nil)
	recorder := httptest.NewRecorder()
	newImageHandler(state).ServeHTTP(recorder, request)
	return recorder
}

func imageURL(generation int, rel string) string {
	return fmt.Sprintf("nicole-image://localhost/%d/%s", generation, rel)
}

func TestImageProtocolServesAllowedExtensions(t *testing.T) {
	root := t.TempDir()
	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	for ext, want := range imageContentTypes {
		name := "assets/picture" + ext
		mustWriteFile(t, filepath.Join(root, filepath.FromSlash(name)), []byte("image"))
		response := imageRequest(workspace.state, http.MethodGet, imageURL(generation, name))
		if response.Code != http.StatusOK {
			t.Errorf("GET %s = %d, want %d", name, response.Code, http.StatusOK)
			continue
		}
		if got := response.Header().Get("Content-Type"); got != want {
			t.Errorf("Content-Type for %s = %q, want %q", name, got, want)
		}
		if got := response.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("X-Content-Type-Options for %s = %q, want nosniff", name, got)
		}
		policy := response.Header().Get("Content-Security-Policy")
		for _, directive := range []string{"default-src 'none'", "script-src 'none'", "sandbox"} {
			if !strings.Contains(policy, directive) {
				t.Errorf("Content-Security-Policy for %s = %q, want %q", name, policy, directive)
			}
		}
	}
}

func TestImageProtocolRejectsInvalidRequests(t *testing.T) {
	root := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "assets", "ok.png"), []byte("ok"))
	mustWriteFile(t, filepath.Join(root, "notes.md"), []byte("# notes"))
	mustWriteFile(t, filepath.Join(root, ".secret", "hidden.png"), []byte("hidden"))
	mustWriteFile(t, filepath.Join(root, "node_modules", "pkg", "icon.png"), []byte("dependency"))

	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)

	for _, rel := range []string{
		"../outside.png",
		"..%2Foutside.png",
		"/etc/passwd.png",
		`.secret/hidden.png`,
		"node_modules/pkg/icon.png",
		"notes.md",
		"assets/",
		"assets",
		"assets/missing.png",
	} {
		response := imageRequest(workspace.state, http.MethodGet, imageURL(generation, rel))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %q = %d, want %d", rel, response.Code, http.StatusNotFound)
		}
	}

	for _, target := range []string{
		fmt.Sprintf("nicole-image://localhost/%d/assets/ok.png", generation+1),
		fmt.Sprintf("nicole-image://elsewhere/%d/assets/ok.png", generation),
		"nicole-image://localhost/assets/ok.png",
		"nicole-image://localhost/0/assets/ok.png",
		"nicole-image://localhost/abc/assets/ok.png",
	} {
		if response := imageRequest(workspace.state, http.MethodGet, target); response.Code == http.StatusOK {
			t.Errorf("GET %q = 200, want a rejection", target)
		}
	}

	response := imageRequest(workspace.state, http.MethodPost, imageURL(generation, "assets/ok.png"))
	if response.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	head := imageRequest(workspace.state, http.MethodHead, imageURL(generation, "assets/ok.png"))
	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Errorf("HEAD = %d with %d body bytes, want 200 with no body", head.Code, head.Body.Len())
	}
}

func TestImageProtocolRejectsSymlinkEscapes(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	mustWriteFile(t, filepath.Join(root, "assets", "ok.png"), []byte("ok"))
	mustWriteFile(t, filepath.Join(outside, "outside.png"), []byte("outside"))
	if err := os.Symlink(filepath.Join(outside, "outside.png"), filepath.Join(root, "assets", "escape.png")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "assets", "escaped-dir")); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}

	workspace := openTestWorkspace(t, root)
	generation := currentGeneration(workspace)
	for _, rel := range []string{"assets/escape.png", "assets/escaped-dir/outside.png"} {
		response := imageRequest(workspace.state, http.MethodGet, imageURL(generation, rel))
		if response.Code != http.StatusNotFound {
			t.Errorf("GET %q = %d, want %d", rel, response.Code, http.StatusNotFound)
		}
	}
}

func TestImageProtocolRejectsOldGeneration(t *testing.T) {
	first := t.TempDir()
	mustWriteFile(t, filepath.Join(first, "assets", "image.png"), []byte("first"))
	workspace := openTestWorkspace(t, first)
	oldGeneration := currentGeneration(workspace)

	second := t.TempDir()
	mustWriteFile(t, filepath.Join(second, "assets", "image.png"), []byte("second"))
	if _, err := workspace.open(second); err != nil {
		t.Fatal(err)
	}
	newGeneration := currentGeneration(workspace)

	if response := imageRequest(workspace.state, http.MethodGet, imageURL(oldGeneration, "assets/image.png")); response.Code != http.StatusNotFound {
		t.Errorf("old generation = %d, want %d", response.Code, http.StatusNotFound)
	}
	response := imageRequest(workspace.state, http.MethodGet, imageURL(newGeneration, "assets/image.png"))
	if response.Code != http.StatusOK || response.Body.String() != "second" {
		t.Errorf("new generation = %d %q, want 200 %q", response.Code, response.Body.String(), "second")
	}
}

func TestImageProtocolWithoutWorkspace(t *testing.T) {
	response := imageRequest(&workspaceState{}, http.MethodGet, imageURL(1, "assets/image.png"))
	if response.Code != http.StatusNotFound {
		t.Errorf("request without workspace = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestIsImageURL(t *testing.T) {
	for _, test := range []struct {
		url  string
		want bool
	}{
		{"nicole-image://localhost/1/assets/a.png", true},
		{"NICOLE-IMAGE://localhost/1/assets/a.svg", true},
		{"mygo://localhost/", false},
		{"https://example.com/a.png", false},
		{"nicole-images://localhost/a.png", false},
	} {
		if got := isImageURL(test.url); got != test.want {
			t.Errorf("isImageURL(%q) = %v, want %v", test.url, got, test.want)
		}
	}
}
