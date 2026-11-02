import type { CommandDefinition } from "./types";

export interface PinyinMatcher {
  /** Full pinyin of the Chinese text, without tones or spaces. */
  full(text: string): string;
  /** First letters of each syllable. */
  initials(text: string): string;
}

export type CommandStorage = Pick<Storage, "getItem" | "setItem">;

export const RECENT_COMMANDS_KEY = "nicole:commands:recent";
const RECENT_COMMAND_LIMIT = 8;

function browserStorage(): CommandStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRecentCommandIds(
  storage: CommandStorage | null | undefined = browserStorage(),
): string[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(RECENT_COMMANDS_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((id): id is string => typeof id === "string")
      .slice(0, RECENT_COMMAND_LIMIT);
  } catch {
    return [];
  }
}

/** Records a command at the front and returns the new recency list. */
export function rememberRecentCommandId(
  id: string,
  storage: CommandStorage | null | undefined = browserStorage(),
): string[] {
  const current = readRecentCommandIds(storage);
  const next = [id, ...current.filter((item) => item !== id)].slice(
    0,
    RECENT_COMMAND_LIMIT,
  );
  if (storage) {
    try {
      storage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(next));
    } catch {
      // A full or disabled storage area must not break command execution.
    }
  }
  return next;
}

let pinyinMatcher: Promise<PinyinMatcher> | null = null;

/** Loads pinyin-pro on the first menu open; it stays out of the idle bundle. */
export function loadPinyinMatcher(): Promise<PinyinMatcher> {
  pinyinMatcher ??= import("pinyin-pro").then(({ pinyin }) => ({
    full: (text) =>
      pinyin(text, {
        toneType: "none",
        type: "array",
        nonZh: "consecutive",
      }).join(""),
    initials: (text) =>
      pinyin(text, {
        pattern: "first",
        toneType: "none",
        type: "array",
        nonZh: "consecutive",
      }).join(""),
  }));
  return pinyinMatcher;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, "");
}

function isSubsequence(value: string, query: string): boolean {
  let cursor = 0;
  for (const character of value) {
    if (character === query[cursor]) cursor++;
    if (cursor === query.length) return true;
  }
  return query.length === 0;
}

function rank(value: string, query: string, base: number): number | null {
  if (!value) return null;
  if (value.startsWith(query)) return base;
  if (value.includes(query)) return base + 1;
  if (isSubsequence(value, query)) return base + 2;
  return null;
}

function matchRank(
  command: CommandDefinition,
  query: string,
  matcher: PinyinMatcher | null,
): number | null {
  const label = normalize(command.label);
  const extra = normalize(command.pinyin ?? "");
  const ranks = [rank(label, query, 0), rank(extra, query, 6)];
  if (matcher) {
    const full = normalize(matcher.full(command.label));
    const initials = normalize(matcher.initials(command.label));
    ranks.push(rank(full, query, 2), rank(initials, query, 4));
  }
  const available = ranks.filter((value): value is number => value !== null);
  return available.length === 0 ? null : Math.min(...available);
}

export interface FilterCommandsOptions {
  matcher?: PinyinMatcher | null;
  recentIds?: readonly string[];
}

/**
 * Filters by label, pinyin, initials and aliases. Recently used commands stay
 * in front while their own order keeps the most recent first.
 */
export function filterCommands(
  commands: readonly CommandDefinition[],
  query: string,
  options: FilterCommandsOptions = {},
): CommandDefinition[] {
  const normalized = normalize(query);
  const recentIds = options.recentIds ?? [];
  const matcher = options.matcher ?? null;
  if (!normalized) {
    return [...commands].sort((left, right) => {
      const leftIndex = recentIds.indexOf(left.id);
      const rightIndex = recentIds.indexOf(right.id);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      return 0;
    });
  }

  return commands
    .map((command, index) => ({
      command,
      index,
      rank: matchRank(command, normalized, matcher),
      recent: recentIds.indexOf(command.id),
    }))
    .filter(
      (entry): entry is typeof entry & { rank: number } => entry.rank !== null,
    )
    .sort((left, right) => {
      if (left.recent !== -1 || right.recent !== -1) {
        if (left.recent === -1) return 1;
        if (right.recent === -1) return -1;
        if (left.recent !== right.recent) return left.recent - right.recent;
      }
      return left.rank - right.rank || left.index - right.index;
    })
    .map((entry) => entry.command);
}
