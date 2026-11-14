import { historyKeymap, redo, undo } from "@codemirror/commands";

import type { AppPlatform } from "../app/platform";
import { formatKeyBinding } from "./registry";
import type { CommandDefinition, CommandKeyBinding } from "./types";

export type ShortcutSectionID =
  | "file"
  | "navigation"
  | "file-tree"
  | "tab"
  | "mode"
  | "find"
  | "format"
  | "paragraph"
  | "insert";

export interface ShortcutEntry {
  id: string;
  label: string;
  /** Every binding that resolves on the current platform, in registry order. */
  keys: readonly string[];
}

export interface ShortcutSection {
  id: ShortcutSectionID;
  label: string;
  entries: readonly ShortcutEntry[];
}

export const SHORTCUT_SECTION_LABELS: Record<ShortcutSectionID, string> = {
  file: "文件",
  navigation: "导航",
  "file-tree": "文件树",
  tab: "标签页",
  mode: "模式",
  find: "查找",
  format: "格式",
  paragraph: "段落",
  insert: "插入",
};

const SECTION_ORDER: readonly ShortcutSectionID[] = [
  "file",
  "navigation",
  "file-tree",
  "tab",
  "mode",
  "find",
  "format",
  "paragraph",
  "insert",
];

/**
 * Presentation grouping only. Labels and keys stay in the registry; a command
 * with no default key never creates a row.
 */
export function shortcutSectionFor(
  command: CommandDefinition,
): ShortcutSectionID {
  if (command.id.startsWith("edit.find")) return "find";
  if (command.id.startsWith("format.")) {
    return command.group === "paragraph" ? "paragraph" : "format";
  }
  if (command.id.startsWith("insert.")) return "insert";
  if (command.id.startsWith("file-tree.")) return "file-tree";
  if (command.id.startsWith("tab.")) return "tab";
  if (command.id.startsWith("mode.")) return "mode";
  if (command.id.startsWith("nav.")) return "navigation";
  return "file";
}

/** Lists every current-platform binding, including second bindings. */
export function shortcutSections(
  commands: readonly CommandDefinition[],
  platform: AppPlatform,
): ShortcutSection[] {
  const grouped = new Map<ShortcutSectionID, ShortcutEntry[]>();
  for (const command of commands) {
    const keys = (command.keys ?? [])
      .map((binding) => formatKeyBinding(binding, platform))
      .filter((key): key is string => key !== null);
    if (keys.length === 0) continue;
    const section = shortcutSectionFor(command);
    const entries = grouped.get(section) ?? [];
    entries.push({ id: command.id, label: command.label, keys });
    grouped.set(section, entries);
  }
  return SECTION_ORDER.flatMap((id) => {
    const entries = grouped.get(id);
    return entries === undefined
      ? []
      : [{ id, label: SHORTCUT_SECTION_LABELS[id], entries }];
  });
}

/**
 * Undo/redo rows come from the same historyKeymap that basicSetup installs,
 * not from a hand-written key list. Esc is owned by the page's overlay order;
 * the row documents that single handler.
 */
export function historyShortcutRows(
  platform: AppPlatform,
): readonly ShortcutEntry[] {
  const bindingKeys = (wanted: typeof undo): string[] =>
    (historyKeymap as readonly (CommandKeyBinding & { run?: unknown })[])
      .filter((binding) => binding.run === wanted)
      .map((binding) => formatKeyBinding(binding, platform))
      .filter((key): key is string => key !== null);
  return [
    { id: "editor.undo", label: "撤销", keys: bindingKeys(undo) },
    { id: "editor.redo", label: "重做", keys: bindingKeys(redo) },
  ].filter((entry) => entry.keys.length > 0);
}
