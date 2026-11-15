package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/egoist/mygo/transfer"
)

func exportForTest(t *testing.T, format string) (*DocumentExports, ExportDestination, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "中文."+format)
	e := NewDocumentExports()
	e.pick = func(_, _ string) (string, error) { return path, nil }
	destination, err := e.Pick(context.Background(), format, "中文.md")
	if err != nil {
		t.Fatal(err)
	}
	return e, destination, path
}

func TestExportHTMLChosenDestinationIsSingleUse(t *testing.T) {
	e, destination, path := exportForTest(t, "html")
	const html = "<!doctype html><p>中文正文</p>"
	saved, err := e.SaveHTML(context.Background(), destination.Token, html)
	if err != nil || saved != path {
		t.Fatalf("save: %q, %v", saved, err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != html {
		t.Fatalf("content: %q, %v", got, err)
	}
	if _, err := e.SaveHTML(context.Background(), destination.Token, "replacement"); err == nil {
		t.Fatal("destination was reusable")
	}
}

func TestExportPickCancellationAndSourceExtension(t *testing.T) {
	e := NewDocumentExports()
	e.pick = func(_, name string) (string, error) {
		if name != "中文.html" {
			t.Errorf("default name: %q", name)
		}
		return "", nil
	}
	result, err := e.Pick(context.Background(), "html", "中文.md")
	if err != nil || !result.Canceled || result.Token != "" {
		t.Fatalf("cancel: %+v, %v", result, err)
	}
	e.pick = func(_, _ string) (string, error) { return filepath.Join(t.TempDir(), "source.md"), nil }
	if _, err := e.Pick(context.Background(), "html", "中文"); err == nil {
		t.Fatal("accepted Markdown as export target")
	}
	if len(e.grants) != 0 {
		t.Fatal("canceled or invalid choice granted a path")
	}
}

func TestExportPDFErrorPreservesExistingFile(t *testing.T) {
	e, destination, path := exportForTest(t, "pdf")
	if err := os.WriteFile(path, []byte("existing PDF"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.printPDF = func(context.Context, string) ([]byte, error) { return nil, errors.New("font failed") }
	if _, err := e.SavePDF(context.Background(), destination.Token, "<p>中文</p>"); err == nil {
		t.Fatal("ignored renderer error")
	}
	got, _ := os.ReadFile(path)
	if string(got) != "existing PDF" {
		t.Fatalf("overwrote existing target: %q", got)
	}
}

func TestExportCancelInFlightPDFRejectsLateResult(t *testing.T) {
	e, destination, path := exportForTest(t, "pdf")
	if err := os.WriteFile(path, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	e.printPDF = func(ctx context.Context, _ string) ([]byte, error) {
		close(started)
		<-ctx.Done()
		return []byte("%PDF-late result"), nil
	}
	done := make(chan error, 1)
	go func() { _, err := e.SavePDF(context.Background(), destination.Token, "<p>snapshot</p>"); done <- err }()
	<-started
	e.Cancel(destination.Token)
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("late result: %v", err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != "old" {
		t.Fatalf("wrote canceled PDF: %q", got)
	}
}

func TestExportPDFRequiresRealPDFBytes(t *testing.T) {
	e, destination, path := exportForTest(t, "pdf")
	e.printPDF = func(context.Context, string) ([]byte, error) { return []byte("<html>not a PDF</html>"), nil }
	if _, err := e.SavePDF(context.Background(), destination.Token, "<p>snapshot</p>"); err == nil {
		t.Fatal("saved non-PDF")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unexpected target: %v", err)
	}
}

func TestExportRefusesTargetReplacedWithSymlink(t *testing.T) {
	e, destination, path := exportForTest(t, "html")
	other := filepath.Join(filepath.Dir(path), "source.md")
	if err := os.WriteFile(other, []byte("source"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, path); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := e.SaveHTML(context.Background(), destination.Token, "<p>snapshot</p>"); err == nil {
		t.Fatal("followed changed target")
	}
	got, _ := os.ReadFile(other)
	if string(got) != "source" {
		t.Fatal("changed source")
	}
}

func TestExportClipboardOffersHTMLAndPlainTextTogether(t *testing.T) {
	e := NewDocumentExports()
	e.clipboard = func(data transfer.Data) error {
		if len(data.Items()) != 1 {
			t.Fatal("representations split into separate items")
		}
		html, _ := data.Read(transfer.HTML)
		plain, _ := data.Read(transfer.Text)
		if string(html) != "<p><strong>中文</strong></p>" || string(plain) != "中文" {
			t.Fatalf("clipboard: %q, %q", html, plain)
		}
		return errors.New("clipboard denied")
	}
	if err := e.CopyRichText("<p><strong>中文</strong></p>", "中文"); err == nil || !strings.Contains(err.Error(), "clipboard denied") {
		t.Fatalf("copy error: %v", err)
	}
}
