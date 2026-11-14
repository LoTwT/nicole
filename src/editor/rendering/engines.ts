import { classHighlighter, highlightTree } from "@lezer/highlight";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  escapeHtml,
  normalizeCssForInspection,
  sanitizePreview,
  sanitizeSvg,
  throwIfAborted,
} from "./sanitize";

const MAX_FORMULA_LENGTH = 20_000;
const MAX_DIAGRAM_LENGTH = 30_000;
let diagramId = 0;
let mermaidEngine: Promise<typeof import("mermaid")["default"]> | null = null;

export async function renderMath(
  source: string,
  displayMode: boolean,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  if (source.length > MAX_FORMULA_LENGTH) {
    return '<code class="nicole-render-error">公式过长，保留源码</code>';
  }
  const [{ default: katex }] = await Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]);
  throwIfAborted(signal);
  try {
    return sanitizePreview(katex.renderToString(source, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: "error",
      maxExpand: 1000,
      maxSize: 20,
      output: "htmlAndMathml",
      macros: {},
    }));
  } catch {
    return '<code class="nicole-render-error" title="公式无法渲染">' +
      escapeHtml(source.slice(0, MAX_FORMULA_LENGTH)) + "</code>";
  }
}

function loadMermaid() {
  if (!mermaidEngine) {
    mermaidEngine = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "neutral",
        fontFamily: "system-ui, sans-serif",
        maxTextSize: MAX_DIAGRAM_LENGTH,
        maxEdges: 500,
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        secure: [
          "securityLevel", "startOnLoad", "suppressErrorRendering", "maxTextSize",
          "maxEdges", "theme", "themeCSS", "themeVariables", "fontFamily", "htmlLabels",
        ],
      });
      return mermaid;
    }).catch((error) => {
      mermaidEngine = null;
      throw error;
    });
  }
  return mermaidEngine;
}

export async function renderMermaid(
  source: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const inspected = source.length <= MAX_DIAGRAM_LENGTH
    ? normalizeCssForInspection(source)
    : "";
  // Document-controlled renderer configuration could load external styles or
  // weaken the host's policy. Diagram definitions use the fixed host config.
  if (
    source.length > MAX_DIAGRAM_LENGTH ||
    /%%\s*\{/.test(inspected) ||
    /(?:^|\n)\s*---(?:\r?\n|$)/.test(inspected) ||
    /(?:^|[;\n])\s*(?:style|classDef|linkStyle|UpdateElementStyle|UpdateRelStyle|UpdateLayoutConfig)\b/i.test(inspected) ||
    /\b(?:https?|file|ftp|data|javascript|nicole-image)\s*:/i.test(inspected) ||
    /url\s*\(|@import|!\[|<\s*(?:img|image|iframe|object|embed|foreignObject)\b|@\{/i.test(inspected)
  ) return '<pre class="nicole-render-error">图表过长或包含不支持的配置、样式或外部资源\n' +
    escapeHtml(source.slice(0, MAX_DIAGRAM_LENGTH)) + "</pre>";
  try {
    const mermaid = await loadMermaid();
    throwIfAborted(signal);
    const { svg } = await mermaid.render("nicole-diagram-" + ++diagramId, source);
    throwIfAborted(signal);
    return sanitizeSvg(svg);
  } catch (error) {
    throwIfAborted(signal);
    return '<pre class="nicole-render-error" title="图表无法渲染">' +
      escapeHtml(source.slice(0, MAX_DIAGRAM_LENGTH)) + "</pre>";
  }
}

export async function highlightCode(
  source: string,
  info: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const name = info.trim().split(/\s+/)[0] ?? "";
  if (!name || source.length > 200_000) return escapeHtml(source);
  const description = LanguageDescription.matchLanguageName(languages, name, true);
  if (!description) return escapeHtml(source);
  try {
    const support = await description.load();
    throwIfAborted(signal);
    let result = "";
    let end = 0;
    highlightTree(support.language.parser.parse(source), classHighlighter, (from, to, classes) => {
      result += escapeHtml(source.slice(end, from)) +
        '<span class="' + escapeHtml(classes) + '">' +
        escapeHtml(source.slice(from, to)) + "</span>";
      end = to;
    });
    return result + escapeHtml(source.slice(end));
  } catch {
    throwIfAborted(signal);
    return escapeHtml(source);
  }
}
