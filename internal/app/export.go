package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
)

const maxExportBytes = 48 * 1024 * 1024
const exportGrantLifetime = 10 * time.Minute

type ExportDestination struct {
	Token    string `json:"token"`
	Canceled bool   `json:"canceled"`
}

type exportGrant struct {
	path, format string
	created      time.Time
	started      bool
	cancel       context.CancelFunc
}

// DocumentExports writes only to one-time destinations chosen in a native
// save dialog. Paths supplied by page content never grant filesystem access.
type DocumentExports struct {
	mu        sync.Mutex
	grants    map[string]*exportGrant
	pick      func(format, name string) (string, error)
	printPDF  func(context.Context, string) ([]byte, error)
	writeFile func(string, []byte) error
	clipboard func(transfer.Data) error
	now       func() time.Time
}

func NewDocumentExports() *DocumentExports {
	return &DocumentExports{
		grants: make(map[string]*exportGrant),
		pick: func(format, name string) (string, error) {
			return mygo.Dialog.Save(mygo.SaveDialogOptions{
				Parent: mygo.FocusedWindow(), Title: "导出为 " + strings.ToUpper(format),
				DefaultPath: name, CreateDirectories: true,
				Filters: []mygo.FileFilter{{Name: strings.ToUpper(format), Extensions: []string{format}}},
			})
		},
		printPDF: printExportPDF, writeFile: writeFileAtomicAbs,
		clipboard: func(data transfer.Data) error { return mygo.Clipboard.Write(data) }, now: time.Now,
	}
}

func exportName(title, format string) string {
	name := strings.Map(func(r rune) rune {
		if r < 32 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '-'
		}
		return r
	}, title)
	name = strings.Trim(name, ". -\t\r\n")
	for _, extension := range []string{".markdown", ".md", ".html", ".pdf"} {
		if strings.HasSuffix(strings.ToLower(name), extension) {
			name = name[:len(name)-len(extension)]
			break
		}
	}
	runes := []rune(name)
	if len(runes) > 100 {
		name = string(runes[:100])
	}
	if name == "" {
		name = "未命名"
	}
	return name + "." + format
}

func (e *DocumentExports) Pick(ctx context.Context, format, title string) (ExportDestination, error) {
	if format != "html" && format != "pdf" {
		return ExportDestination{}, errors.New("不支持的导出格式")
	}
	if err := ctx.Err(); err != nil {
		return ExportDestination{}, err
	}
	path, err := e.pick(format, exportName(title, format))
	if err != nil {
		return ExportDestination{}, err
	}
	if path == "" {
		return ExportDestination{Canceled: true}, nil
	}
	if err := ctx.Err(); err != nil {
		return ExportDestination{}, err
	}
	if filepath.Ext(path) == "" {
		path += "." + format
	}
	if !filepath.IsAbs(path) || !strings.EqualFold(filepath.Ext(path), "."+format) {
		return ExportDestination{}, fmt.Errorf("请选择 .%s 文件，源文档不会被覆盖", format)
	}
	if info, err := os.Lstat(path); err == nil {
		if !info.Mode().IsRegular() {
			return ExportDestination{}, errors.New("导出目标必须是普通文件，不能是符号链接或目录")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return ExportDestination{}, err
	}
	var random [24]byte
	if _, err := rand.Read(random[:]); err != nil {
		return ExportDestination{}, err
	}
	token := hex.EncodeToString(random[:])
	e.mu.Lock()
	defer e.mu.Unlock()
	for key, grant := range e.grants {
		if e.now().Sub(grant.created) > exportGrantLifetime {
			if grant.cancel != nil {
				grant.cancel()
			}
			delete(e.grants, key)
		}
	}
	if len(e.grants) >= 8 {
		return ExportDestination{}, errors.New("有过多未完成的导出，请取消后重试")
	}
	e.grants[token] = &exportGrant{path: path, format: format, created: e.now()}
	return ExportDestination{Token: token}, nil
}

// Cancel revokes an unused destination or cancels its in-progress PDF job.
func (e *DocumentExports) Cancel(token string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if grant := e.grants[token]; grant != nil {
		if grant.cancel != nil {
			grant.cancel()
		}
		delete(e.grants, token)
	}
}

func validateExportHTML(html string) error {
	if !utf8.ValidString(html) || html == "" || len(html) > maxExportBytes {
		return errors.New("导出文档为空、编码无效或超过 48 MB")
	}
	return nil
}

func (e *DocumentExports) begin(ctx context.Context, token, format string) (*exportGrant, context.Context, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	grant := e.grants[token]
	if grant == nil || grant.started || grant.format != format || e.now().Sub(grant.created) > exportGrantLifetime {
		return nil, nil, errors.New("导出位置已失效，请重新选择")
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	job, cancel := context.WithTimeout(ctx, 30*time.Second)
	grant.started, grant.cancel = true, cancel
	return grant, job, nil
}

func (e *DocumentExports) finish(token string, grant *exportGrant, ctx context.Context, data []byte) (string, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.grants[token] != grant {
		return "", context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if info, err := os.Lstat(grant.path); err == nil {
		if !info.Mode().IsRegular() {
			return "", errors.New("导出目标已变化，请重新选择")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := e.writeFile(grant.path, data); err != nil {
		return "", err
	}
	return grant.path, nil
}

func (e *DocumentExports) SaveHTML(ctx context.Context, token, html string) (string, error) {
	if err := validateExportHTML(html); err != nil {
		return "", err
	}
	grant, job, err := e.begin(ctx, token, "html")
	if err != nil {
		return "", err
	}
	defer e.Cancel(token)
	return e.finish(token, grant, job, []byte(html))
}

func (e *DocumentExports) SavePDF(ctx context.Context, token, html string) (string, error) {
	if err := validateExportHTML(html); err != nil {
		return "", err
	}
	grant, job, err := e.begin(ctx, token, "pdf")
	if err != nil {
		return "", err
	}
	defer e.Cancel(token)
	pdf, err := e.printPDF(job, html)
	if err != nil {
		return "", err
	}
	if len(pdf) == 0 || !strings.HasPrefix(string(pdf[:min(len(pdf), 5)]), "%PDF-") {
		return "", errors.New("原生 PDF 生成失败，目标文件未写入")
	}
	return e.finish(token, grant, job, pdf)
}

func (e *DocumentExports) CopyRichText(html, plainText string) error {
	if err := validateExportHTML(html); err != nil {
		return err
	}
	if !utf8.ValidString(plainText) || len(plainText) > maxExportBytes {
		return errors.New("复制文本编码无效或过大")
	}
	return e.clipboard(transfer.New(transfer.NewItem(
		transfer.Bytes(transfer.HTML, []byte(html)), transfer.Bytes(transfer.Text, []byte(plainText)),
	)))
}

// The first CSP is mandatory even if a future caller accidentally supplies
// weaker markup. Host Eval is not subject to CSP; document scripts are.
const exportPrintPolicy = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">`

const exportPrintReady = `if (!document.querySelector("[data-nicole-reading]")) throw new Error("导出页面尚未加载");
document.body.getBoundingClientRect();
await document.fonts.ready;
await Promise.all([...document.images].map(async image => {
  if (image.decode) await image.decode();
  else if (!image.complete) await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=reject; });
  if (!image.naturalWidth) throw new Error("导出图片加载失败");
}));
document.body.getBoundingClientRect();
if ([...document.fonts].some(font => font.status === "error")) throw new Error("导出字体加载失败");
return true;`

func printExportPDF(ctx context.Context, html string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	window := mygo.NewWindow(mygo.WindowOptions{
		Title: "Nicole PDF Export", Hidden: true, SkipTaskbar: true, Width: 794, Height: 1123,
		Page: mygo.PageOptions{Session: mygo.NewEphemeralSession()},
	})
	defer window.Destroy()
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			window.Destroy()
		case <-done:
		}
	}()
	page := window.Page()
	page.OnWillNavigate(func(event *mygo.NavigateEvent) {
		if event.URL != "about:blank" {
			event.PreventDefault()
		}
	})
	page.SetWindowOpenHandler(func(mygo.WindowOpenRequest) *mygo.WindowOptions { return nil })
	loaded := make(chan error, 1)
	offLoad := page.OnDidFinishLoad(func() {
		select {
		case loaded <- nil:
		default:
		}
	})
	defer offLoad()
	offError := page.OnDidFailLoad(func(err *mygo.LoadError) {
		select {
		case loaded <- fmt.Errorf("导出页面加载失败: %v", err):
		default:
		}
	})
	defer offError()
	page.LoadHTML(exportPrintPolicy+html, "about:blank")
	select {
	case err := <-loaded:
		if err != nil {
			return nil, err
		}
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if _, err := page.EvalContext(ctx, exportPrintReady); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return page.PrintToPDF(mygo.PDFOptions{PageSize: mygo.PageA4, Background: true, Margins: &mygo.Margins{Top: .5, Right: .5, Bottom: .5, Left: .5}})
}
