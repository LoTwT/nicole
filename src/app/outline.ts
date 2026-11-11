import type { DocumentHeading } from "../editor/headings";

/** Content width at or above which the outline occupies layout on the right. */
export const OUTLINE_FIXED_MIN_WIDTH = 840;
export const OUTLINE_PANEL_WIDTH = 220;
/** Space between the visible top of the editor and a jumped-to heading. */
export const OUTLINE_JUMP_MARGIN = 24;
/** Updates wait this long after the last document change. */
export const OUTLINE_UPDATE_DELAY_MS = 300;

export type OutlinePlacement = "fixed" | "floating";

/**
 * The threshold uses the editor-side content width, not the window width.
 * The sidebar has its own breakpoint, so the content-area width keeps the
 * outline and the reading column in the same coordinate system.
 */
export function outlinePlacement(contentWidth: number): OutlinePlacement {
  return contentWidth >= OUTLINE_FIXED_MIN_WIDTH ? "fixed" : "floating";
}

interface FrontmatterInfo {
  /** 1-based line of the closing delimiter; null when there is none. */
  endLine: number | null;
  /** Offset just after the closing delimiter, or 0 without frontmatter. */
  bodyStart: number;
  /** 1-based line that contains bodyStart, or 0 at the document start. */
  bodyStartLine: number;
}

interface LineBounds {
  end: number;
  next: number;
}

function lineBounds(doc: string, start: number): LineBounds {
  const end = doc.indexOf("\n", start);
  return end === -1
    ? { end: doc.length, next: doc.length }
    : { end, next: end + 1 };
}

/**
 * Scans only the opening lines. A whole-document split would allocate a
 * string per line before the bounded syntax-tree pass even starts.
 */
function frontmatterInfo(doc: string): FrontmatterInfo {
  const first = lineBounds(doc, 0);
  const opening = doc.slice(0, first.end).replace(/^\uFEFF/, "").trimEnd();
  if (opening !== "---") {
    return { endLine: null, bodyStart: 0, bodyStartLine: 0 };
  }
  let line = 1;
  let position = first.next;
  while (position <= doc.length) {
    const bounds = lineBounds(doc, position);
    const text = doc.slice(position, bounds.end).trimEnd();
    line += 1;
    if (text === "---" || text === "...") {
      return {
        endLine: line,
        bodyStart: bounds.next,
        bodyStartLine: line,
      };
    }
    if (bounds.end >= doc.length) {
      break;
    }
    position = bounds.next;
  }
  return { endLine: null, bodyStart: 0, bodyStartLine: 0 };
}

function firstNonEmptyBodyLine(
  doc: string,
  bodyStart: number,
  bodyStartLine: number,
): number | null {
  let line = bodyStartLine;
  let position = bodyStart;
  while (position <= doc.length) {
    const bounds = lineBounds(doc, position);
    const text = doc.slice(position, bounds.end);
    line += 1;
    if (text.trim() !== "") {
      return line;
    }
    if (bounds.end >= doc.length) {
      break;
    }
    position = bounds.next;
  }
  return null;
}

/**
 * Headings shown in the outline: H1–H3, without frontmatter lines and without
 * the document's single leading H1 when that H1 is the article title. The
 * title rule follows the specification: the first non-empty line after
 * frontmatter is an H1 and no other H1 exists in the body.
 */
export function outlineHeadings(
  doc: string,
  headings: readonly DocumentHeading[],
): DocumentHeading[] {
  const frontmatter = frontmatterInfo(doc);
  const frontmatterEnd = frontmatter.endLine;
  const firstBodyLine = firstNonEmptyBodyLine(
    doc,
    frontmatter.bodyStart,
    frontmatter.bodyStartLine,
  );
  const visible = headings.filter(
    (heading) =>
      heading.level <= 3 &&
      (frontmatterEnd === null || heading.line > frontmatterEnd),
  );
  if (firstBodyLine === null) {
    return visible;
  }
  const levelOne = visible.filter((heading) => heading.level === 1);
  if (levelOne.length !== 1 || levelOne[0]!.line !== firstBodyLine) {
    return visible;
  }
  return visible.filter((heading) => heading !== levelOne[0]);
}

/**
 * Index of the heading that contains the line at the top of the viewport.
 * A line before the first heading has no active section.
 */
export function activeOutlineHeadingIndex(
  headings: readonly DocumentHeading[],
  topLine: number,
): number | null {
  let active: number | null = null;
  for (let index = 0; index < headings.length; index += 1) {
    if (headings[index]!.line > topLine) {
      break;
    }
    active = index;
  }
  return active;
}
