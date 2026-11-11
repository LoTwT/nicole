import type { SearchMatch, SearchPart } from "../services/mygo";

export interface SearchSegment {
  text: string;
  highlighted: boolean;
  zeroWidth: boolean;
  /** Index in the line's matches array; null for plain text. */
  matchIndex: number | null;
}

/** One matching line, ready for display and for the editor jump. */
export interface SearchResultLine {
  path: string;
  line: number;
  text: string;
  /** Fingerprint of the full line, independent of the bounded snippet. */
  fingerprint: string;
  prefixTruncated: boolean;
  suffixTruncated: boolean;
  matches: SearchMatch[];
  segments: SearchSegment[];
}

/** A file in the sidebar, with its matching lines in stream order. */
export interface SearchFileGroup {
  path: string;
  name: string;
  folder: string;
  matchCount: number;
  lines: SearchResultLine[];
}

/** A result the page should open and select. */
export interface SearchOpenTarget {
  generation: number;
  line: SearchResultLine;
  match: SearchMatch;
}

/** Turns one streamed Go part into a display line; summary parts return null. */
export function searchLineFromPart(part: SearchPart): SearchResultLine | null {
  if (part.type !== "line") return null;
  const path = part.path ?? "";
  const line = part.line ?? 0;
  const matches = part.matches ?? [];
  if (path === "" || line < 1 || matches.length === 0) return null;
  const text = part.text ?? "";
  return {
    path,
    line,
    text,
    fingerprint: part.lineFingerprint ?? "",
    prefixTruncated: part.prefixTruncated === true,
    suffixTruncated: part.suffixTruncated === true,
    matches,
    segments: searchLineSegments(text, matches),
  };
}

/**
 * Adds a streamed line to its file group. Go sends paths in one walk, but a
 * group is looked up by path so a late or reordered part cannot create a
 * second file heading.
 */
export function addSearchLine(
  groups: readonly SearchFileGroup[],
  part: SearchPart,
): SearchFileGroup[] {
  const line = searchLineFromPart(part);
  if (line === null) return [...groups];
  const index = groups.findIndex((group) => group.path === line.path);
  if (index === -1) {
    return [
      ...groups,
      {
        path: line.path,
        ...splitSearchPath(line.path),
        matchCount: line.matches.length,
        lines: [line],
      },
    ];
  }
  const existing = groups[index]!;
  const updated: SearchFileGroup = {
    ...existing,
    matchCount: existing.matchCount + line.matches.length,
    lines: [...existing.lines, line],
  };
  return groups.map((group, current) => (current === index ? updated : group));
}

export function splitSearchPath(path: string): {
  name: string;
  folder: string;
} {
  const slash = path.lastIndexOf("/");
  return slash === -1
    ? { name: path, folder: "" }
    : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

export function formatSearchSummary(files: number, matches: number): string {
  return `${files} 个文件中有 ${matches} 处结果`;
}

/** Short Chinese text for a failed search; Go's raw detail stays readable. */
export function searchErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const invalid = "workspace: invalid search pattern: ";
  const invalidAt = text.indexOf(invalid);
  if (invalidAt !== -1) {
    const detail = text.slice(invalidAt + invalid.length).trim();
    return detail === "" ? "正则表达式无效" : `正则表达式无效：${detail}`;
  }
  if (text.includes("workspace: no folder is open")) {
    return "没有打开工作区";
  }
  if (text.includes("workspace: folder changed")) {
    return "工作区已切换，请重新搜索";
  }
  const detail = text.replace(/^workspace:\s*/, "").trim();
  return detail === "" ? "搜索失败" : `搜索失败：${detail}`;
}

/**
 * Highlights the ranges of every match visible in the bounded line snippet.
 * Matches outside the snippet keep their count but are not drawn.
 */
export function searchLineSegments(
  text: string,
  matches: readonly SearchMatch[],
): SearchSegment[] {
  const ranges = matches
    .map((match, index) => ({ match, index }))
    .filter(
      ({ match }) =>
        match.highlightStart >= 0 &&
        match.highlightEnd >= match.highlightStart,
    )
    .map(({ match, index }) => ({
      start: Math.min(text.length, match.highlightStart),
      end: Math.min(text.length, match.highlightEnd),
      index,
    }))
    .filter((range) => range.start <= range.end)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.end - right.end ||
        left.index - right.index,
    );

  const segments: SearchSegment[] = [];
  const zeroPositions = new Set<number>();
  let at = 0;
  for (const range of ranges) {
    if (range.end < at) continue;
    if (range.start < at) range.start = at;
    if (range.start > at) {
      segments.push({
        text: text.slice(at, range.start),
        highlighted: false,
        zeroWidth: false,
        matchIndex: null,
      });
    }
    if (range.end > range.start) {
      segments.push({
        text: text.slice(range.start, range.end),
        highlighted: true,
        zeroWidth: false,
        matchIndex: range.index,
      });
    } else if (!zeroPositions.has(range.start)) {
      zeroPositions.add(range.start);
      segments.push({
        text: "",
        highlighted: true,
        zeroWidth: true,
        matchIndex: range.index,
      });
    }
    at = Math.max(at, range.end);
  }
  if (at < text.length) {
    segments.push({
      text: text.slice(at),
      highlighted: false,
      zeroWidth: false,
      matchIndex: null,
    });
  }
  return segments;
}

/** A result-open target captured after the asynchronous tab switch. */
export interface SearchTargetSnapshot {
  root: string;
  generation: number;
  tabId: number;
  text: string;
  view: unknown;
  doc: unknown;
}

/**
 * Checks that the tab, view and document captured for a search result are
 * still the current ones. An async open must use this before dispatching a
 * selection so a newer workspace or tab cannot receive an old result.
 */
export function searchTargetStillCurrent(
  snapshot: SearchTargetSnapshot,
  current: SearchTargetSnapshot | null,
): boolean {
  return (
    current !== null &&
    current.root === snapshot.root &&
    current.generation === snapshot.generation &&
    current.tabId === snapshot.tabId &&
    current.text === snapshot.text &&
    current.view === snapshot.view &&
    current.doc === snapshot.doc
  );
}

/**
 * Fingerprint of normalized UTF-16 code units: FNV-1a/64 and FNV-1/64 over
 * little-endian UTF-16 bytes, concatenated. Go computes the same value. It
 * proves full line and match content without sending an unbounded line over
 * IPC; it is a staleness check, not a password hash.
 */
const FNV_OFFSET_BASIS = 14695981039346656037n;
const FNV_PRIME = 1099511628211n;
const FNV_MASK = (1n << 64n) - 1n;

export function searchFingerprint(text: string): string {
  let first = FNV_OFFSET_BASIS;
  let second = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const low = BigInt(unit & 0xff);
    const high = BigInt((unit >> 8) & 0xff);
    first = ((first ^ low) * FNV_PRIME) & FNV_MASK;
    first = ((first ^ high) * FNV_PRIME) & FNV_MASK;
    second = (second * FNV_PRIME) & FNV_MASK;
    second ^= low;
    second = (second * FNV_PRIME) & FNV_MASK;
    second ^= high;
  }
  return `${hex64(first)}${hex64(second)}`;
}

function hex64(value: bigint): string {
  return value.toString(16).padStart(16, "0");
}

/**
 * Finds the editor range for a result from the stable line number and UTF-16
 * column. The complete target line and the complete match must still have their
 * original fingerprints; any change to either is stale, and a duplicate on the
 * same line is never substituted. Earlier lines may change length without
 * moving the column of an unchanged target line.
 */
export function locateSearchMatch(
  docText: string,
  line: SearchResultLine,
  match: SearchMatch,
): { from: number; to: number } | null {
  if (line.fingerprint === "" || match.fingerprint === "") return null;
  const lineStart = lineStartOffset(docText, line.line);
  if (lineStart === null) return null;
  const newline = docText.indexOf("\n", lineStart);
  const lineEnd = newline === -1 ? docText.length : newline;
  const currentLine = docText.slice(lineStart, lineEnd);
  if (searchFingerprint(currentLine) !== line.fingerprint) return null;

  const column = Math.max(0, Math.trunc(match.column));
  const length = Math.max(0, Math.trunc(match.length));
  if (column > currentLine.length) return null;
  const from = lineStart + column;
  const to = from + length;
  if (to > docText.length) return null;
  if (
    (match.startsAtDocumentStart && from !== 0) ||
    (match.startsAtLineStart && from !== lineStart)
  ) {
    return null;
  }
  if (searchFingerprint(docText.slice(from, to)) !== match.fingerprint) {
    return null;
  }

  const endLineStart = lineStartOffset(docText, match.endLine);
  if (endLineStart === null || endLineStart < lineStart) return null;
  const endNewline = docText.indexOf("\n", endLineStart);
  const endLineEnd =
    endNewline === -1 ? docText.length : endNewline;
  const endLine = docText.slice(endLineStart, endLineEnd);
  if (searchFingerprint(endLine) !== match.endLineFingerprint) return null;
  if (to < endLineStart || to > endLineEnd) return null;
  if (match.endsAtDocumentEnd && to !== docText.length) return null;
  if (match.endsAtLineEnd && to !== endLineEnd) return null;
  return { from, to };
}

function lineStartOffset(text: string, line: number): number | null {
  if (line < 1) return null;
  let start = 0;
  for (let current = 1; current < line; current += 1) {
    const newline = text.indexOf("\n", start);
    if (newline === -1) return null;
    start = newline + 1;
  }
  return start;
}
