import MarkdownIt, {
  type Env,
  type MarkdownIt as MarkdownItInstance,
} from "markdown-it";
import type { ImageResolver } from "../types";
import { highlightCode, renderMath, renderMermaid } from "./engines";
import { calloutHeading, inlineMathEnd } from "./syntax";
import { escapeHtml, safeLink, sanitizePreview, throwIfAborted } from "./sanitize";
import "./rendering.css";

export interface MarkdownPreviewOptions {
  resolveImage?: ImageResolver;
  signal?: AbortSignal;
  /** Host navigation metadata; omitted from exported HTML by default. */
  sourceLines?: boolean;
}

interface RenderJob {
  id: string;
  html: Promise<string>;
}

interface RenderEnvironment extends Env {
  options: MarkdownPreviewOptions;
  jobs: RenderJob[];
}

let previewId = 0;

function placeholder(env: RenderEnvironment, html: Promise<string>): string {
  const id = "nicole-preview-" + ++previewId;
  env.jobs.push({ id, html });
  return '<span id="' + id + '"></span>';
}

function sourceLine(env: RenderEnvironment, map: [number, number] | null): string {
  return env.options.sourceLines && map ? ' data-source-line="' + (map[0] + 1) + '"' : "";
}

function installFrontmatter(md: MarkdownItInstance, env: RenderEnvironment) {
  md.block.ruler.before("hr", "nicole_frontmatter", (state, start, end, silent) => {
    if (start !== 0 || state.src.slice(0, state.eMarks[0]).trim() !== "---") return false;
    let last = 1;
    for (; last < end; last++) {
      const line = state.src.slice(state.bMarks[last], state.eMarks[last]).trim();
      if (line === "---" || line === "...") break;
    }
    if (silent) return true;
    const token = state.push("nicole_frontmatter", "", 0);
    token.map = [0, Math.min(last + 1, end)];
    token.content = last < end ? "" : state.src;
    token.block = true;
    state.line = Math.min(last + 1, end);
    return true;
  });
  md.renderer.rules.nicole_frontmatter = (tokens, index) => {
    const token = tokens[index]!;
    return token.content ? '<pre class="nicole-frontmatter-source"' + sourceLine(env, token.map) + ">" +
      escapeHtml(token.content) + "</pre>\n" : "";
  };
}

function installMath(md: MarkdownItInstance, env: RenderEnvironment) {
  md.inline.ruler.after("escape", "nicole_math", (state, silent) => {
    const end = inlineMathEnd(state.src, state.pos);
    if (end === null || end > state.posMax) return false;
    if (!silent) {
      const token = state.push("nicole_math", "math", 0);
      token.content = state.src.slice(state.pos + 1, end - 1);
    }
    state.pos = end;
    return true;
  });
  md.block.ruler.before("fence", "nicole_math_block", (state, start, end, silent) => {
    if (state.sCount[start]! - state.blkIndent > 3) return false;
    const first = state.src.slice(
      state.bMarks[start]! + state.tShift[start]!,
      state.eMarks[start],
    );
    if (!first.startsWith("$$")) return false;
    let content = first.slice(2);
    let last = start;
    const sameLine = content.lastIndexOf("$$");
    if (sameLine >= 0 && content.slice(sameLine + 2).trim() === "") {
      content = content.slice(0, sameLine);
    } else {
      if (content.trim() !== "") return false;
      let closed = false;
      for (last = start + 1; last < end; last++) {
        if (state.sCount[last]! < state.blkIndent && state.src.slice(state.bMarks[last], state.eMarks[last]).trim()) break;
        if (state.sCount[last]! - state.blkIndent > 3) continue;
        const line = state.src.slice(
          state.bMarks[last]! + state.tShift[last]!,
          state.eMarks[last],
        );
        if (/^\$\$[ \t]*$/.test(line)) {
          content = state.getLines(start + 1, last, state.blkIndent, false);
          closed = true;
          break;
        }
      }
      if (!closed) return false;
    }
    if (silent) return true;
    const token = state.push("nicole_math_block", "math", 0);
    token.block = true;
    token.content = content.trim();
    token.map = [start, last + 1];
    state.line = last + 1;
    return true;
  });
  md.renderer.rules.nicole_math = (tokens, index) =>
    placeholder(env, renderMath(tokens[index]!.content, false, env.options.signal));
  md.renderer.rules.nicole_math_block = (tokens, index) =>
    '<div class="nicole-math-block"' + sourceLine(env, tokens[index]!.map) + ">" +
    placeholder(env, renderMath(tokens[index]!.content, true, env.options.signal)) +
    "</div>\n";
}

function installCallouts(md: MarkdownItInstance) {
  md.core.ruler.after("inline", "nicole_callouts", (state) => {
    for (let index = 0; index < state.tokens.length; index++) {
      const open = state.tokens[index]!;
      if (open.type !== "blockquote_open") continue;
      const paragraph = state.tokens[index + 1];
      const inline = state.tokens[index + 2];
      if (paragraph?.type !== "paragraph_open" || inline?.type !== "inline") continue;
      const firstLine = inline.content.split("\n")[0]!;
      const heading = calloutHeading(firstLine);
      if (!heading) continue;
      open.attrJoin("class", "nicole-callout nicole-callout-" + heading.type);
      paragraph.attrJoin("class", "nicole-callout-title");
      if (heading.fold !== null) {
        open.tag = "details";
        if (heading.fold === "+") open.attrSet("open", "");
        paragraph.tag = "summary";
        const paragraphClose = state.tokens[index + 3];
        if (paragraphClose?.type === "paragraph_close") paragraphClose.tag = "summary";
        let depth = 1;
        for (let close = index + 1; close < state.tokens.length; close++) {
          const candidate = state.tokens[close]!;
          if (candidate.type === "blockquote_open") depth++;
          if (candidate.type === "blockquote_close" && --depth === 0) { candidate.tag = "details"; break; }
        }
      }
      const remainder = inline.content.slice(firstLine.length).replace(/^\n/, "");
      inline.content = heading.title || heading.label;
      inline.children = [];
      md.inline.parse(inline.content, md, state.env, inline.children);
      if (remainder && state.tokens[index + 3]?.type === "paragraph_close") {
        const bodyOpen = new state.Token("paragraph_open", "p", 1);
        const body = new state.Token("inline", "", 0);
        const bodyClose = new state.Token("paragraph_close", "p", -1);
        bodyOpen.block = bodyClose.block = true;
        if (inline.map) bodyOpen.map = [inline.map[0] + 1, inline.map[1]];
        body.content = remainder;
        body.children = [];
        md.inline.parse(remainder, md, state.env, body.children);
        state.tokens.splice(index + 4, 0, bodyOpen, body, bodyClose);
      }
    }
  });
  md.core.ruler.after("nicole_callouts", "nicole_tasks", (state) => {
    for (let index = 2; index < state.tokens.length; index++) {
      const inline = state.tokens[index]!;
      if (
        inline.type !== "inline" ||
        state.tokens[index - 1]?.type !== "paragraph_open" ||
        state.tokens[index - 2]?.type !== "list_item_open"
      ) continue;
      const first = inline.children?.[0];
      const match = first?.type === "text" && /^\[([ xX])\]\s+/.exec(first.content);
      if (!match || !first) continue;
      first.content = first.content.slice(match[0].length);
      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = '<input type="checkbox" disabled' +
        (match[1]!.toLowerCase() === "x" ? " checked" : "") + "> ";
      inline.children!.unshift(checkbox);
    }
  });
}

function previewParser(options: MarkdownPreviewOptions, env: RenderEnvironment) {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });
  const validate = md.validateLink.bind(md);
  md.validateLink = (url) => (
    safeLink(url) || /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i.test(url)
  ) && validate(url);
  installFrontmatter(md, env);
  installMath(md, env);
  installCallouts(md);
  const renderToken = md.renderer.renderToken.bind(md.renderer);
  md.renderer.renderToken = (tokens, index, rendererOptions) => {
    const token = tokens[index]!;
    if (options.sourceLines && token.block && token.nesting !== -1 && token.map) {
      token.attrSet("data-source-line", String(token.map[0] + 1));
    }
    return renderToken(tokens, index, rendererOptions);
  };
  md.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]!;
    const info = token.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (info === "mermaid") {
      return '<div class="nicole-mermaid"' + sourceLine(env, token.map) + ">" +
        placeholder(env, renderMermaid(token.content, env.options.signal)) + "</div>\n";
    }
    return "<pre" + sourceLine(env, token.map) + '><code class="language-' + escapeHtml(info) + '">' +
      placeholder(env, highlightCode(token.content, info, env.options.signal)) +
      "</code></pre>\n";
  };
  md.renderer.rules.image = (tokens, index, rendererOptions, env, renderer) => {
    const token = tokens[index]!;
    const raw = String(token.attrGet("src") ?? "");
    const src = options.resolveImage ? options.resolveImage(raw) : raw;
    const alt = renderer.renderInlineAsText(token.children ?? [], rendererOptions, env);
    const allowed = src && (
      /^(https?:|data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,])/i.test(src) ||
      options.resolveImage && /^nicole-image:\/\/localhost\/[1-9][0-9]*\//.test(src) ||
      !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")
    );
    return allowed
      ? '<img loading="lazy" src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '">'
      : '<span class="nicole-image-unavailable">' + escapeHtml(alt || "图片不可用") + "</span>";
  };
  return md;
}

async function render(
  source: string,
  options: MarkdownPreviewOptions,
  inline: boolean,
): Promise<string> {
  throwIfAborted(options.signal);
  const env: RenderEnvironment = { options, jobs: [] };
  const md = previewParser(options, env);
  const html = inline ? md.renderInline(source, env) : md.render(source, env);
  const template = document.createElement("template");
  // User Markdown is sanitized before trusted, individually sanitized math/
  // SVG/code fragments replace these host-generated placeholder elements.
  template.innerHTML = sanitizePreview(html);
  const fragments = await Promise.all(env.jobs.map(async (job) => ({
    id: job.id,
    html: await job.html,
  })));
  throwIfAborted(options.signal);
  for (const fragment of fragments) {
    const target = template.content.getElementById(fragment.id);
    if (target) target.outerHTML = fragment.html;
  }
  return template.innerHTML;
}

/** Safe read-only HTML; links are inert until the host handles navigation. */
export function renderMarkdownPreview(
  source: string,
  options: MarkdownPreviewOptions = {},
): Promise<string> {
  return render(source, options, false);
}

/** The same rendering policy for a table cell or another inline-only surface. */
export function renderInlineMarkdownPreview(
  source: string,
  options: MarkdownPreviewOptions = {},
): Promise<string> {
  return render(source, options, true);
}
