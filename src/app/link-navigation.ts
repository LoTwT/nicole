import { markdownLanguage } from "@codemirror/lang-markdown";

import type { DocumentHeading } from "../editor/headings";
import { parseMarkdownDestination } from "../image-url";

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const CHARACTER_REFERENCE =
  /^&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z][A-Za-z0-9]+));/;
const CONTROL = /[\u0000-\u001F\u007F]/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SKIP_HEADING_NODES = new Set([
  "HeaderMark",
  "LinkMark",
  "LinkTitle",
  "URL",
  "CodeMark",
  "EmphasisMark",
  "StrikethroughMark",
  "QuoteMark",
  "ListMark",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction",
]);

export interface LinkSource {
  kind: "workspace" | "single";
  /** Workspace-relative path for a workspace tab; absolute for a single file. */
  path: string;
  root: string | null;
}

export type LinkDestination =
  | { kind: "empty" }
  | { kind: "external"; url: string }
  | { kind: "fragment"; fragment: string }
  | { kind: "workspace"; path: string; fragment: string | null }
  | { kind: "unsupported"; message: string };

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function decodeCharacterReference(reference: string): string | null {
  const numeric = /^&#(?:([0-9]+)|[xX]([0-9A-Fa-f]+));$/.exec(reference);
  if (numeric !== null) {
    const code = Number.parseInt(numeric[1] ?? numeric[2]!, numeric[1] ? 10 : 16);
    if (
      !Number.isFinite(code) ||
      code === 0 ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff)
    ) {
      return null;
    }
    return String.fromCodePoint(code);
  }
  if (!/^&[A-Za-z][A-Za-z0-9]+;$/.test(reference)) return null;
  if (typeof document === "undefined") return null;
  // Attribute parsing keeps the full-name requirement: a legacy prefix such
  // as `&not` is not expanded when the next character is alphanumeric, so
  // `&notit;` stays literal while a complete reference such as `&notin;`
  // decodes. Text content parsing would wrongly accept the prefix.
  const container = document.createElement("div");
  container.innerHTML = `<span data-entity="${reference}"></span>`;
  const decoded = container.firstElementChild?.getAttribute("data-entity") ?? "";
  return decoded === reference ? null : decoded;
}

/**
 * Applies the one Markdown destination semantic pass used for navigation.
 * Backslash escapes and character references are interpreted exactly once;
 * percent escapes are left for the HTTP or local-path rules that follow.
 */
export function decodeLinkDestination(source: string): string {
  const value = parseMarkdownDestination(source);
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    if (
      character === "\\" &&
      index + 1 < value.length &&
      ASCII_PUNCTUATION.test(value[index + 1]!)
    ) {
      result += value[index + 1]!;
      index += 1;
      continue;
    }
    if (character === "&") {
      const match = CHARACTER_REFERENCE.exec(value.slice(index));
      if (match !== null) {
        const decoded = decodeCharacterReference(match[0]);
        if (decoded !== null) {
          result += decoded;
          index += match[0].length - 1;
          continue;
        }
      }
    }
    result += character;
  }
  return result;
}

function isHttpDestination(value: string): boolean {
  if (CONTROL.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.hostname !== ""
    );
  } catch {
    return false;
  }
}

function normalizeLocalPath(
  rawPath: string,
  sourcePath: string,
): string | null {
  if (
    rawPath === "" ||
    rawPath.startsWith("//") ||
    rawPath.includes("\\") ||
    rawPath.includes("?") ||
    CONTROL.test(rawPath)
  ) {
    return null;
  }
  const rootRelative = rawPath.startsWith("/");
  const rawSegments = (rootRelative ? rawPath.slice(1) : rawPath).split("/");
  if (rawSegments.length === 0 || rawSegments.some((part) => part === "")) {
    return null;
  }
  const segments = rootRelative
    ? []
    : sourcePath.split("/").slice(0, -1).filter(Boolean);
  for (const part of rawSegments) {
    if (/%2f|%5c/i.test(part)) return null;
    const decoded = decodeOnce(part);
    if (
      decoded === null ||
      decoded === "" ||
      CONTROL.test(decoded) ||
      decoded.includes("\\") ||
      decoded.includes(":")
    ) {
      return null;
    }
    if (decoded === ".") continue;
    if (decoded === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(decoded);
  }
  return segments.length > 0 ? segments.join("/") : null;
}

/** Classifies a link destination without performing any navigation. */
export function classifyLinkDestination(
  source: string,
  sourceLink: LinkSource,
): LinkDestination {
  const value = decodeLinkDestination(source);
  if (value.trim() === "") return { kind: "empty" };

  if (isHttpDestination(value)) return { kind: "external", url: value };

  if (SCHEME.test(value)) {
    return {
      kind: "unsupported",
      message: "只支持 HTTP(S) 链接或工作区 Markdown 文件",
    };
  }

  if (value.startsWith("#")) {
    const fragment = decodeOnce(value.slice(1));
    return fragment === null
      ? { kind: "unsupported", message: "链接锚点编码无效" }
      : { kind: "fragment", fragment };
  }

  if (sourceLink.kind !== "workspace" || sourceLink.root === null) {
    return {
      kind: "unsupported",
      message: "单文件标签页只支持当前文档锚点和 HTTP(S) 链接",
    };
  }

  const fragmentAt = value.indexOf("#");
  const rawPath = fragmentAt === -1 ? value : value.slice(0, fragmentAt);
  const rawFragment = fragmentAt === -1 ? null : value.slice(fragmentAt + 1);
  const path = normalizeLocalPath(rawPath, sourceLink.path);
  if (path === null || !/\.md$/i.test(path)) {
    return {
      kind: "unsupported",
      message: "只支持工作区内的 Markdown 文件链接",
    };
  }
  const fragment = rawFragment === null ? null : decodeOnce(rawFragment);
  if (rawFragment !== null && fragment === null) {
    return { kind: "unsupported", message: "链接锚点编码无效" };
  }
  return { kind: "workspace", path, fragment };
}

function decodeHeadingEntity(source: string, node: {
  name: string;
  from: number;
  to: number;
}): string | null {
  if (node.name !== "Entity") return null;
  return decodeCharacterReference(source.slice(node.from, node.to));
}

/**
 * Visible text of a heading: formatting markers are syntax, link URLs and
 * titles are not visible, while code content, link labels and entity text
 * remain part of the heading.
 */
function visibleHeadingSource(source: string): string {
  const replacements: { from: number; to: number; text: string }[] = [];
  markdownLanguage.parser.parse(source).iterate({
    enter(node) {
      if (SKIP_HEADING_NODES.has(node.name)) {
        replacements.push({ from: node.from, to: node.to, text: "" });
        return false;
      }
      if (node.name === "Escape") {
        replacements.push({
          from: node.from,
          to: node.to,
          text: source.slice(node.from + 1, node.to),
        });
        return false;
      }
      if (node.name === "Entity") {
        replacements.push({
          from: node.from,
          to: node.to,
          text:
            decodeHeadingEntity(source, node) ?? source.slice(node.from, node.to),
        });
        return false;
      }
    },
  });
  replacements.sort((left, right) => left.from - right.from);
  let text = "";
  let position = 0;
  for (const replacement of replacements) {
    if (replacement.from < position) continue;
    text += source.slice(position, replacement.from);
    text += replacement.text;
    position = replacement.to;
  }
  text += source.slice(position);
  return text;
}

/** Visible heading text for display and exact-text fragment aliases. */
export function visibleHeadingText(source: string): string {
  return visibleHeadingSource(source).replace(/\s+/g, " ").trim();
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
}

/** GitHub-style ids in document order, with collision suffixes. */
export function headingAnchorIds(
  headings: readonly DocumentHeading[],
): string[] {
  const used = new Set<string>();
  return headings.map((heading) => {
    const base = slugifyHeading(visibleHeadingSource(heading.text));
    let id = base;
    let suffix = 1;
    while (used.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return id;
  });
}

/** Finds a generated id first, then an exact visible-text alias. */
export function findHeadingByFragment(
  headings: readonly DocumentHeading[],
  fragment: string,
): DocumentHeading | null {
  const ids = headingAnchorIds(headings);
  const index = ids.indexOf(fragment);
  if (index !== -1) return headings[index] ?? null;
  return (
    headings.find((heading) => visibleHeadingText(heading.text) === fragment) ??
    null
  );
}
