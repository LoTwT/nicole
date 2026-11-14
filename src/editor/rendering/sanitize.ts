import DOMPurify from "dompurify";

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  })[ch]!);
}

/** Inspection only: never use this canonical form as document/source output. */
export function normalizeCssForInspection(source: string): string {
  return source
    .replace(/\\(?:\r\n|[\n\r\f])/g, "")
    .replace(/\\([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    })
    .replace(/\\([^\n\r\f])/g, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function externalCssResource(source: string): boolean {
  const normalized = normalizeCssForInspection(source);
  if (/@import|@font-face/i.test(normalized)) return true;
  for (const match of normalized.matchAll(/\burl\s*\(([^)]*)\)/gi)) {
    const value = match[1]!.trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!/^#[a-z_][a-z0-9_.:-]*$/i.test(value)) return true;
  }
  return false;
}

/** No navigation or external resources may be introduced by a generated SVG. */
export function sanitizeSvg(source: string): string {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "image", "a", "script", "animate", "set"],
    FORBID_ATTR: ["href", "xlink:href", "onload"],
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        externalCssResource(attribute.value) ||
        /(?:javascript|vbscript|data):/i.test(attribute.value)
      ) element.removeAttribute(attribute.name);
    }
  }
  // Mermaid generates its own stylesheet. Imported URLs are never needed.
  for (const style of template.content.querySelectorAll("style")) {
    if (externalCssResource(style.textContent ?? "")) style.remove();
  }
  const svg = template.content.querySelector("svg");
  const id = svg?.getAttribute("id") ?? "";
  if (svg && /^nicole-diagram-[0-9]+$/.test(id)) {
    const theme = document.createElementNS("http://www.w3.org/2000/svg", "style");
    // The renderer's own ID-scoped stylesheet contains fixed colors. Host
    // variables make an existing diagram follow theme changes without parsing
    // the document again or accepting document-controlled theme CSS.
    const scope = "#" + id;
    theme.textContent = scope + " text," + scope + " .label{fill:var(--text-primary)!important;color:var(--text-primary)!important}" +
      scope + " .node rect," + scope + " .node polygon," + scope + " .node circle," + scope + " .node ellipse," + scope + " rect.actor{fill:var(--surface-subtle)!important;stroke:var(--border-strong)!important}" +
      scope + " .flowchart-link," + scope + " .edgePath path{stroke:var(--text-secondary)!important}" +
      scope + " .marker{fill:var(--text-secondary)!important;stroke:var(--text-secondary)!important}";
    svg.append(theme);
  }
  return template.innerHTML;
}

export function safeLink(source: string): boolean {
  const value = source.trim();
  if (/[\u0000-\u001f\u007f]/.test(value) || value.startsWith("//")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  return !scheme || /^(https?|mailto)$/i.test(scheme[1]!);
}

export function sanitizePreview(source: string): string {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
    ADD_ATTR: ["xmlns", "display", "aria-hidden", "data-source-line"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "style"],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|nicole-image):|data:image\/(?:png|jpe?g|gif|webp|avif)[;,]|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const anchor of template.content.querySelectorAll("a")) {
    if (!safeLink(anchor.getAttribute("href") ?? "")) anchor.removeAttribute("href");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.startsWith("on") ||
        externalCssResource(attribute.value)
      ) element.removeAttribute(attribute.name);
    }
  }
  return template.innerHTML;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Preview cancelled", "AbortError");
}
