import { renderMarkdownPreview } from "../editor/rendering/preview";
import { escapeHtml, sanitizeSvg } from "../editor/rendering/sanitize";
import type { ImageResolver } from "../editor/types";
import { compileReadingCSS } from "./writing-preferences";
import readingCSS from "../editor/rendering/rendering.css?raw";
import katexCSS from "katex/dist/katex.css?raw";

const fontAssets = import.meta.glob<string>("../../node_modules/katex/dist/fonts/*.woff2", {
  eager: true, import: "default", query: "?url",
});
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 48 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 30_000;
const VARIABLE = /^--(?:reading-|text-|surface-|border-|color-syntax-|status-|radius-)[a-z0-9-]+$/;

export interface ExportReadingStyle {
  theme?: "light" | "dark";
  fontSize?: number;
  lineHeight?: number;
  contentWidth?: number;
  fontFamily?: string;
  codeFontFamily?: string;
  variables?: Readonly<Record<string, string>>;
  /** The same restricted, uncompiled CSS saved in writing preferences. */
  css?: string;
}

export interface DocumentExportOptions {
  source: string;
  title: string;
  resolveImage?: ImageResolver;
  style?: ExportReadingStyle;
  signal?: AbortSignal;
  isCurrent?: () => boolean;
  /** Print and rich clipboard output include the body of initially folded callouts. */
  expandCallouts?: boolean;
}

export interface PreparedDocumentExport {
  html: string;
  plainText: string;
  warnings: string[];
}

/** Snapshot resolved theme values so a standalone document needs no app CSS. */
export function captureExportReadingStyle(element: Element = document.documentElement): ExportReadingStyle {
  const computed = getComputedStyle(element);
  const variables: Record<string, string> = {};
  for (const name of computed) {
    if (VARIABLE.test(name)) variables[name] = computed.getPropertyValue(name).trim();
  }
  return {
    theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
    fontFamily: computed.getPropertyValue("--reading-font-body").trim(),
    codeFontFamily: computed.getPropertyValue("--reading-font-mono").trim(),
    variables,
  };
}

function aborted(): DOMException { return new DOMException("导出已取消或来源文档已变化", "AbortError"); }

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? aborted());
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function safeStyleValue(value: string): boolean {
  return !/[;{}<>\\\u0000-\u001f]|url\s*\(|@|expression\s*\(/i.test(value);
}

function exportStyle(style: ExportReadingStyle): string {
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  const variables = Object.entries(style.variables ?? {}).filter(([key, value]) => VARIABLE.test(key) && safeStyleValue(value));
  const family = style.fontFamily && safeStyleValue(style.fontFamily) ? style.fontFamily : 'Georgia,"Songti SC","Noto Serif CJK SC",serif';
  const code = style.codeFontFamily && safeStyleValue(style.codeFontFamily) ? style.codeFontFamily : 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  const custom = compileReadingCSS(style.css ?? "");
  if (custom.error) throw new Error(custom.error);
  return `:root{color-scheme:${style.theme === "dark" ? "dark" : "light"};--text-primary:#242128;--text-secondary:#625b68;--text-muted:#77717d;--text-accent:#7955a3;--surface-canvas:#fff;--surface-subtle:#f4f1f6;--border-default:#d9d3df;--border-strong:#afa5ba;--status-info-fg:#526eaa;--status-warning-fg:#976311;--status-danger-fg:#b3424b;--status-success-fg:#39734f;${variables.map(([key, value]) => `${key}:${value}`).join(";")};--reading-font-body:${family};--reading-font-mono:${code};--reading-font-size:${bounded(style.fontSize, 18, 12, 36)}px;--reading-line-height:${bounded(style.lineHeight, 1.7, 1.2, 2.4)}}
html{background:var(--surface-canvas);color:var(--text-primary)}body{margin:0;padding:32px 24px}main{max-width:${bounded(style.contentWidth, 65, 40, 100)}ch;margin:auto}.nicole-reading-preview .nicole-export-missing-image{font-style:italic;color:var(--text-muted)}
${readingCSS}
${custom.css}
@page{size:A4}@media print{body{padding:0}main{max-width:100%}.nicole-reading-preview pre{white-space:pre-wrap;overflow-wrap:anywhere}.nicole-reading-preview table{display:table;width:100%;overflow:visible}.nicole-reading-preview th,.nicole-reading-preview td{min-width:0;overflow-wrap:anywhere}.nicole-reading-preview thead{display:table-header-group}.nicole-reading-preview tr,.nicole-reading-preview img,.nicole-mermaid{break-inside:avoid}.nicole-reading-preview h1,.nicole-reading-preview h2,.nicole-reading-preview h3{break-after:avoid}.nicole-reading-preview *{print-color-adjust:exact;-webkit-print-color-adjust:exact}.nicole-math-block,.nicole-mermaid{overflow:visible}}
`;
}

function dataURL(buffer: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x4000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Semantic plain text, with table separators and a single math representation. */
export function documentExportPlainText(root: DocumentFragment): string {
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return [...node.childNodes].map(walk).join("");
    if (node.matches("style,script")) return "";
    if (node.classList.contains("katex")) {
      const math = node.querySelector("math");
      // The shared sanitizer may unwrap MathML annotation tags. Its TeX
      // remains direct math text; never concatenate both accessible and
      // visual KaTeX branches into the clipboard's plain representation.
      const source = node.querySelector("annotation")?.textContent ??
        [...(math?.childNodes ?? [])].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join("").trim();
      return source || node.querySelector(".katex-html")?.textContent || node.textContent || "";
    }
    if (node.tagName === "IMG") return node.getAttribute("alt") ?? "";
    if (node.tagName === "BR") return "\n";
    if (node.tagName === "TR") return [...node.children].map(walk).join("\t") + "\n";
    if (node.matches("thead,tbody,tfoot")) return [...node.children].map(walk).join("");
    if (node.tagName === "TABLE") return [...node.children].map(walk).join("") + "\n\n";
    const text = [...node.childNodes].map(walk).join("");
    if (node.matches("p,h1,h2,h3,h4,h5,h6,pre,blockquote,ul,ol,div,section")) return text + "\n\n";
    if (node.tagName === "LI") return text + "\n";
    return text;
  };
  return walk(root).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Render an immutable snapshot; no file, clipboard or source-document writes. */
export async function prepareDocumentExport(options: DocumentExportOptions): Promise<PreparedDocumentExport> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new DOMException("导出准备超过 30 秒，请重试", "TimeoutError")), EXPORT_TIMEOUT_MS);
  const signal = controller.signal;
  const check = () => {
    if (signal.aborted) throw signal.reason ?? aborted();
    if (options.isCurrent?.() === false) throw aborted();
  };
  const readingStyle = options.style ?? captureExportReadingStyle();
  let consumed = 0;
  const warnings = new Set<string>();
  const load = async (url: string, mime: string): Promise<string> => {
    check();
    const response = await abortable(fetch(url, { signal, credentials: "omit", redirect: "error" }), signal);
    if (!response.ok) throw new Error("无法读取导出资源");
    const length = Number(response.headers.get("content-length"));
    if (length > MAX_RESOURCE_BYTES) throw new Error("单个导出资源不能超过 16 MB");
    const bytes = await abortable(response.arrayBuffer(), signal);
    check();
    consumed += bytes.byteLength;
    if (bytes.byteLength > MAX_RESOURCE_BYTES || consumed > MAX_DOCUMENT_BYTES) throw new Error("导出资源过大");
    if (mime === "image/svg+xml") {
      const safe = sanitizeSvg(new TextDecoder().decode(bytes));
      return dataURL(new TextEncoder().encode(safe).buffer, mime);
    }
    return dataURL(bytes, mime);
  };
  const imageResolver: ImageResolver = (source) => {
    const resolved = options.resolveImage ? options.resolveImage(source) : source;
    if (resolved && /^(?:https?:)?\/\//i.test(resolved)) {
      warnings.add("远程图片未嵌入，已保留替代文本");
      return null;
    }
    if (resolved && (/^nicole-image:\/\/localhost\/[1-9][0-9]*\//.test(resolved) || /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i.test(resolved))) return resolved;
    warnings.add("部分图片无法在当前授权范围内读取，已保留替代文本");
    return null;
  };
  try {
    check();
    const rendered = await abortable(renderMarkdownPreview(options.source, { resolveImage: imageResolver, signal }), signal);
    check();
    const fragment = document.createElement("template");
    fragment.innerHTML = rendered;
    // Sequential loading bounds live resource buffers and makes cancellation
    // deterministic; the output still contains independent image data URLs.
    const images = new Map<string, string>();
    for (const image of fragment.content.querySelectorAll("img")) {
      check();
      const url = image.getAttribute("src") ?? "";
      image.removeAttribute("loading");
      if (url.startsWith("data:")) continue;
      if (!/^nicole-image:\/\/localhost\/[1-9][0-9]*\//.test(url)) throw new Error("导出图片没有有效的本地授权");
      try {
        let embedded = images.get(url);
        if (!embedded) {
          const extension = new URL(url).pathname.split(".").at(-1)?.toLowerCase();
          const mime = ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" } as Record<string, string>)[extension ?? ""];
          if (!mime) throw new Error("不支持的图片类型");
          embedded = await load(url, mime);
          images.set(url, embedded);
        }
        image.setAttribute("src", embedded);
      } catch (error) {
        check();
        throw new Error(`本地图片无法嵌入，导出未保存：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    let mathCSS = "";
    if (fragment.content.querySelector(".katex")) {
      const fonts = new Map<string, string>();
      for (const match of katexCSS.matchAll(/src:\s*url\(fonts\/([^()]+\.woff2)\)[^;]*;/g)) {
        const name = match[1]!;
        const url = Object.entries(fontAssets).find(([path]) => path.endsWith("/" + name))?.[1];
        if (!url) throw new Error("公式字体不完整，导出未保存");
        fonts.set(name, await load(url, "font/woff2"));
      }
      mathCSS = katexCSS.replace(/src:\s*url\(fonts\/([^()]+\.woff2)\)[^;]*;/g, (_match, name: string) => `src:url("${fonts.get(name)}") format("woff2");`);
      if (/url\((?!["']?data:)/i.test(mathCSS)) throw new Error("公式样式包含未嵌入资源");
    }
    check();
    if (options.expandCallouts) fragment.content.querySelectorAll("details").forEach((element) => { element.open = true; });
    const style = exportStyle(readingStyle);
    const html = `<!doctype html>\n<html lang="zh-CN"${readingStyle.theme === "dark" ? ' class="dark"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escapeHtml(options.title)}</title><style>${style}\n${mathCSS}</style></head><body data-nicole-reading><main class="nicole-reading-preview">${fragment.innerHTML}</main></body></html>`;
    if (new TextEncoder().encode(html).byteLength > MAX_DOCUMENT_BYTES) throw new Error("导出文档不能超过 48 MB");
    return { html, plainText: documentExportPlainText(fragment.content), warnings: [...warnings] };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
