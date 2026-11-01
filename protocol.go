package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
)

// imageScheme serves images of the open workspace to the editor. URLs carry
// the workspace generation, so an image request prepared for a folder that is
// no longer open is refused instead of reading the next folder's files.
const imageScheme = "nicole-image"

// imageContentTypes is the allowlist of extensions the scheme serves. The
// scheme serves nothing else, so a Markdown link to another file type cannot
// use it to read the workspace.
var imageContentTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
	".svg":  "image/svg+xml",
}

func imageContentType(name string) (string, bool) {
	contentType, ok := imageContentTypes[strings.ToLower(path.Ext(name))]
	return contentType, ok
}

// registerImageProtocol makes nicole-image://localhost/<generation>/<path>
// serve files of the current workspace. It is called once, before the window
// exists; switching folders only replaces the state the handler reads.
func registerImageProtocol(workspace *Workspace) error {
	return mygo.Protocol.Handle(imageScheme, newImageHandler(workspace.state))
}

func newImageHandler(state *workspaceState) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		generation, rel, ok := imageRequestPath(r.URL.Path)
		if !ok || !strings.EqualFold(r.Host, "localhost") {
			http.NotFound(w, r)
			return
		}
		root, current := state.snapshot()
		if root == "" || generation != current {
			http.NotFound(w, r)
			return
		}
		serveImage(w, r, root, rel)
	})
}

// imageRequestPath splits /<generation>/<path> into its generation and the
// workspace-relative image path.
func imageRequestPath(requestPath string) (generation int, rel string, ok bool) {
	trimmed := strings.TrimPrefix(requestPath, "/")
	if trimmed == requestPath {
		return 0, "", false
	}
	generationPart, rel, found := strings.Cut(trimmed, "/")
	if !found || rel == "" {
		return 0, "", false
	}
	generation, err := strconv.Atoi(generationPart)
	if err != nil || generation <= 0 {
		return 0, "", false
	}
	return generation, rel, true
}

func serveImage(w http.ResponseWriter, r *http.Request, root, rel string) {
	target, err := resolveExistingImage(root, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rootFS, err := os.OpenRoot(root)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer rootFS.Close()
	file, err := rootFS.Open(filepath.FromSlash(target))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	contentType, ok := imageContentType(target)
	if !ok {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// SVG can carry script. It is only ever shown through <img>, and this
	// policy also keeps a direct navigation from running anything.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; sandbox")
	// The URL contains the generation, so a newer folder never reads this
	// response; revalidation still picks up a changed file.
	w.Header().Set("Cache-Control", "private, no-cache")
	http.ServeContent(w, r, path.Base(target), info.ModTime(), file)
}

// blockImageNavigation keeps an image URL from becoming a trusted page by
// top-level navigation. Images are loaded through <img>; clicking or
// redirecting to nicole-image:// is cancelled.
func blockImageNavigation(page *mygo.Page) {
	if page == nil {
		return
	}
	page.OnWillNavigate(func(event *mygo.NavigateEvent) {
		if isImageURL(event.URL) {
			event.PreventDefault()
		}
	})
}

func isImageURL(rawURL string) bool {
	return strings.HasPrefix(strings.ToLower(rawURL), imageScheme+":")
}
