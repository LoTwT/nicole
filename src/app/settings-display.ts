import type { FileEntry } from "../services/mygo";

export type FontField = "ui" | "reading" | "code";
export type SlashMode = "live" | "immersive" | "source";

/**
 * Existing font stacks, in the same order as src/style.css. A custom family
 * is prepended, so a font that is not installed falls back to the same stack
 * the page used before the preference existed.
 */
export const UI_FONT_FALLBACK =
  'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
export const READING_FONT_FALLBACK = 'Georgia, "Songti SC", serif';
export const CODE_FONT_FALLBACK =
  "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Returns a CSS font-family value with the user's installed family first.
 * Null means the built-in stack. Quotes and declaration-breaking characters
 * are removed so a font name cannot leave the family value.
 */
export function customFontStack(
  name: string,
  fallback: string,
): string | null {
  const family = name
    .replace(/["\\;{}]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return family === "" ? null : `"${family}", ${fallback}`;
}

/** Tree and tab labels honour the .md preference; folders never change. */
export function fileDisplayName(
  entry: Pick<FileEntry, "name" | "isDir">,
  hideMarkdownExtension: boolean,
): string {
  if (entry.isDir || !hideMarkdownExtension) {
    return entry.name;
  }
  return entry.name.replace(/\.md$/i, "");
}

/** Only files are filtered; directories keep the lazy tree complete. */
export function visibleTreeEntry(
  entry: FileEntry,
  showAllFiles: boolean,
): boolean {
  return showAllFiles || entry.isDir || entry.isMarkdown;
}
