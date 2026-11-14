import { markdownLanguage } from "@codemirror/lang-markdown";

import { decodeLinkDestination } from "./link-navigation";

export interface ReferenceDocument {
  path: string;
  content: string;
}

export interface ReferenceTextEdit {
  /** UTF-16 offsets into the unchanged source document. */
  from: number;
  to: number;
  before: string;
  after: string;
}

export interface ReferenceDocumentUpdate extends ReferenceDocument {
  newPath: string;
  edits: ReferenceTextEdit[];
  updatedContent: string;
}

export function renamedReferencePath(
  source: string,
  oldPath: string,
  newPath: string,
  isDir: boolean,
): string {
  return source === oldPath || (isDir && source.startsWith(`${oldPath}/`))
    ? newPath + source.slice(oldPath.length)
    : source;
}

/** A link path is URL data: separators stay literal, punctuation is encoded. */
export function encodeWorkspaceLinkPath(path: string): string {
  return path
    .split("/")
    .map((part) =>
      encodeURIComponent(part).replace(
        /[!'()*]/g,
        (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
}

export function relativeWorkspaceLinkPath(
  source: string,
  target: string,
): string {
  const parent = source.split("/").slice(0, -1);
  const destination = target.split("/");
  while (parent.length > 0 && parent[0] === destination[0]) {
    parent.shift();
    destination.shift();
  }
  return [...parent.map(() => ".."), ...destination].join("/");
}

/** Boundary scan only: never execute or interpret YAML, including an unfinished header. */
export function frontmatterEnd(source: string): number {
  const first = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(source);
  if (!first) return 0;
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gm;
  closing.lastIndex = first[0].length;
  const match = closing.exec(source);
  return match ? match.index + match[0].length : source.length;
}

function resolveLocalPath(destination: string, source: string): string | null {
  if (
    !destination ||
    destination.startsWith("//") ||
    /[\u0000-\u001F\u007F\\?:]/.test(destination)
  )
    return null;
  const result = destination.startsWith("/")
    ? []
    : source.split("/").slice(0, -1);
  for (const part of destination.replace(/^\//, "").split("/")) {
    if (!part || /%2f|%5c/i.test(part)) return null;
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (/[\u0000-\u001F\u007F\\/:]/.test(value)) return null;
    if (value === ".") continue;
    if (value === "..") {
      if (!result.length) return null;
      result.pop();
    } else result.push(value);
  }
  return result.length ? result.join("/") : null;
}

function rewriteDestination(
  raw: string,
  source: string,
  movedSource: string,
  oldPath: string,
  newPath: string,
  isDir: boolean,
): string | null {
  const decoded = decodeLinkDestination(raw);
  if (decoded.startsWith("#")) return null;
  const fragmentAt = decoded.indexOf("#");
  const destination = fragmentAt < 0 ? decoded : decoded.slice(0, fragmentAt);
  const target = resolveLocalPath(destination, source);
  if (!target) return null;
  const movedTarget = renamedReferencePath(target, oldPath, newPath, isDir);
  if (
    destination.startsWith("/")
      ? movedTarget === target
      : relativeWorkspaceLinkPath(source, target) ===
        relativeWorkspaceLinkPath(movedSource, movedTarget)
  )
    return null;
  const nextPath = destination.startsWith("/")
    ? `/${encodeWorkspaceLinkPath(movedTarget)}`
    : encodeWorkspaceLinkPath(
        relativeWorkspaceLinkPath(movedSource, movedTarget),
      );
  // Fragments are not paths. Preserve their exact escaping rather than
  // decoding/re-encoding heading text or changing unrelated source bytes.
  const shell = raw.startsWith("<") && raw.endsWith(">");
  const address = shell ? raw.slice(1, -1) : raw;
  let rawFragmentAt = -1;
  for (let index = 0; index < address.length; index++) {
    const token =
      address[index] === "\\"
        ? address.slice(index, index + 2)
        : address[index] === "&"
          ? /^&(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);/.exec(
              address.slice(index),
            )?.[0]
          : undefined;
    if (token) {
      if (decodeLinkDestination(token).includes("#")) {
        rawFragmentAt = index;
        break;
      }
      index += token.length - 1;
    } else if (address[index] === "#") {
      rawFragmentAt = index;
      break;
    }
  }
  const fragment = rawFragmentAt < 0 ? "" : address.slice(rawFragmentAt);
  const rewritten = nextPath + fragment;
  return shell ? `<${rewritten}>` : rewritten;
}

/**
 * Rewrite only parsed link/image destinations and reference definitions.
 * Labels, titles, whitespace, line endings and all unrelated source survive.
 * The same pure function accepts disk snapshots or unsaved tab overlays.
 */
export function planLinkReferenceUpdates(
  documents: readonly ReferenceDocument[],
  oldPath: string,
  newPath: string,
  isDir: boolean,
): ReferenceDocumentUpdate[] {
  const updates: ReferenceDocumentUpdate[] = [];
  for (const document of documents) {
    const movedSource = renamedReferencePath(
      document.path,
      oldPath,
      newPath,
      isDir,
    );
    const edits: ReferenceTextEdit[] = [];
    const metadataEnd = frontmatterEnd(document.content);
    markdownLanguage.parser.parse(document.content.slice(metadataEnd)).iterate({
      enter(node) {
        if (node.name !== "URL") return;
        if (
          !["Link", "Image", "LinkReference"].includes(
            node.node.parent?.name ?? "",
          )
        )
          return;
        const from = node.from + metadataEnd;
        const to = node.to + metadataEnd;
        const before = document.content.slice(from, to);
        const after = rewriteDestination(
          before,
          document.path,
          movedSource,
          oldPath,
          newPath,
          isDir,
        );
        if (after !== null && after !== before)
          edits.push({ from, to, before, after });
      },
    });
    if (!edits.length && movedSource === document.path) continue;
    let updatedContent = document.content;
    for (const edit of [...edits].reverse()) {
      updatedContent =
        updatedContent.slice(0, edit.from) +
        edit.after +
        updatedContent.slice(edit.to);
    }
    updates.push({ ...document, newPath: movedSource, edits, updatedContent });
  }
  return updates;
}
