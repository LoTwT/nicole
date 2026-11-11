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

/**
 * Finds the editor range for a result. It first trusts the original UTF-16
 * offsets only when the same match text is still there. If the document moved,
 * it relocates the text inside the result's line; anything else is reported as
 * stale instead of selecting an unrelated occurrence.
 */
export function locateSearchMatch(
  docText: string,
  line: SearchResultLine,
  match: SearchMatch,
): { from: number; to: number } | null {
  const lineStart = lineStartOffset(docText, line.line);
  if (lineStart === null) return null;
  const newline = docText.indexOf("\n", lineStart);
  const lineEnd = newline === -1 ? docText.length : newline;
  const currentLine = docText.slice(lineStart, lineEnd);
  const fullLength = Math.max(0, Math.trunc(match.length));
  const text = match.text;

  if (text.length === 0 && fullLength === 0) {
    if (currentLine !== line.text) return null;
    const offset = Math.max(
      0,
      Math.min(currentLine.length, match.start - lineStart),
    );
    const from = lineStart + offset;
    return { from, to: from };
  }

  const accept = (from: number): { from: number; to: number } | null => {
    if (from < lineStart || from > lineEnd) return null;
    if (fullLength < text.length) return null;
    if (from + text.length > docText.length) return null;
    if (docText.slice(from, from + text.length) !== text) return null;
    if (from + fullLength > docText.length) return null;
    return { from, to: from + fullLength };
  };

  const exact = accept(match.start);
  if (exact !== null) return exact;

  const newlineInMatch = text.indexOf("\n");
  const searchText =
    newlineInMatch === -1 ? text : text.slice(0, newlineInMatch);
  if (searchText === "") return null;
  const expected = match.start - lineStart;
  let best: { from: number; to: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let at = currentLine.indexOf(searchText);
  while (at !== -1) {
    const candidate = accept(lineStart + at);
    const distance = Math.abs(at - expected);
    if (candidate !== null && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
    at = currentLine.indexOf(searchText, at + 1);
  }
  return best;
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
