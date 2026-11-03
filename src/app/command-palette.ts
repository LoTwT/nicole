import {
  normalizeSearchText,
  textMatchRank,
  type PinyinMatcher,
} from "../commands/search";
import type { DocumentHeading } from "../editor/headings";

export type CommandPaletteMode = "command" | "file" | "heading";

export const RECENT_FILES_LIMIT = 20;

export interface ParsedPaletteInput {
  mode: CommandPaletteMode;
  query: string;
}

/** The prefix at the start of the input selects the panel mode. */
export function parsePaletteInput(value: string): ParsedPaletteInput {
  if (value.startsWith(">")) {
    return { mode: "command", query: value.slice(1) };
  }
  if (value.startsWith("@")) {
    return { mode: "heading", query: value.slice(1) };
  }
  return { mode: "file", query: value };
}

export function initialPaletteInput(mode: CommandPaletteMode): string {
  switch (mode) {
    case "command":
      return ">";
    case "heading":
      return "@";
    case "file":
      return "";
  }
}

export function paletteModeLabel(mode: CommandPaletteMode): string {
  switch (mode) {
    case "command":
      return "命令";
    case "file":
      return "文件";
    case "heading":
      return "标题";
  }
}

/** Keeps recent workspace files unique, newest first and within the limit. */
export function rememberRecentFilePath(
  current: readonly string[],
  path: string,
  limit = RECENT_FILES_LIMIT,
): string[] {
  if (!path || path === ".") return [...current].slice(0, limit);
  return [path, ...current.filter((item) => item !== path)].slice(0, limit);
}

/** Drops malformed or stale duplicates without changing the recorded order. */
export function normalizeRecentFiles(
  paths: readonly string[] | null | undefined,
  limit = RECENT_FILES_LIMIT,
): string[] {
  if (!Array.isArray(paths)) return [];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      path === "" ||
      path === "." ||
      path.startsWith("/") ||
      path.startsWith("\\") ||
      path.includes("\\") ||
      path.includes(":") ||
      path.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      continue;
    }
    if (seen.has(path)) continue;
    seen.add(path);
    kept.push(path);
    if (kept.length === limit) break;
  }
  return kept;
}

const pathCollator = new Intl.Collator("zh-Hans-CN", {
  numeric: true,
  sensitivity: "base",
});

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export interface FilterPaletteFilesOptions {
  matcher?: PinyinMatcher | null;
  recentFiles?: readonly string[];
}

/**
 * Files match by name or path. With a query, match quality wins and recency
 * breaks ties; without one, recent files are first and the rest follow path
 * order.
 */
export function filterPaletteFiles(
  files: readonly string[],
  query: string,
  options: FilterPaletteFilesOptions = {},
): string[] {
  const normalized = normalizeSearchText(query);
  const recent = options.recentFiles ?? [];
  const recentIndex = new Map(recent.map((path, index) => [path, index]));
  if (!normalized) {
    return [...files].sort((left, right) => {
      const leftRecent = recentIndex.get(left);
      const rightRecent = recentIndex.get(right);
      if (leftRecent !== undefined || rightRecent !== undefined) {
        if (leftRecent === undefined) return 1;
        if (rightRecent === undefined) return -1;
        return leftRecent - rightRecent;
      }
      return pathCollator.compare(left, right);
    });
  }

  const matcher = options.matcher ?? null;
  return files
    .map((path, index) => {
      const nameRank = textMatchRank(baseName(path), normalized, matcher, 0);
      const pathRank = textMatchRank(path, normalized, matcher, 1);
      const rank =
        nameRank === null
          ? pathRank
          : pathRank === null
            ? nameRank
            : Math.min(nameRank, pathRank);
      return {
        path,
        index,
        rank,
        recent: recentIndex.get(path),
      };
    })
    .filter(
      (entry): entry is typeof entry & { rank: number } => entry.rank !== null,
    )
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.recent !== undefined || right.recent !== undefined) {
        if (left.recent === undefined) return 1;
        if (right.recent === undefined) return -1;
        if (left.recent !== right.recent) return left.recent - right.recent;
      }
      return pathCollator.compare(left.path, right.path) || left.index - right.index;
    })
    .map((entry) => entry.path);
}

export function filterPaletteHeadings(
  headings: readonly DocumentHeading[],
  query: string,
  matcher: PinyinMatcher | null = null,
): DocumentHeading[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [...headings];

  return headings
    .map((heading, index) => ({
      heading,
      index,
      rank: textMatchRank(heading.text, normalized, matcher, 0),
    }))
    .filter(
      (entry): entry is typeof entry & { rank: number } => entry.rank !== null,
    )
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.heading.position - right.heading.position ||
        left.index - right.index,
    )
    .map((entry) => entry.heading);
}
