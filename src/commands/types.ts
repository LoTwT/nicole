import type { EditorView } from "@codemirror/view";

import type { AppPlatform } from "../app/platform";

export type CommandScope = "editor" | "app";

/** Toolbar grouping; commands without a toolbar use `insert`. */
export type CommandGroup = "inline" | "paragraph" | "block" | "insert";

export interface CommandKeyBinding {
  /** CodeMirror key binding used when no platform-specific key is given. */
  key?: string;
  mac?: string;
  win?: string;
  linux?: string;
}

export interface CommandContext {
  /** Null when an application command is invoked outside an editor. */
  view: EditorView | null;
  platform: AppPlatform;
}

export interface CommandDefinition {
  /** Stable identifier shared by slash commands, keymaps, menus and toolbars. */
  id: string;
  label: string;
  /** Extra search text: pinyin without tones and English aliases. */
  pinyin?: string;
  /** Lucide icon name for the future formatting toolbar. */
  icon?: string;
  group: CommandGroup;
  scope: CommandScope;
  /** Compact 22px glyph shown in the slash menu, for example `H2`. */
  glyph?: string;
  /** At least one entry per visible shortcut; each entry may vary by platform. */
  keys?: readonly CommandKeyBinding[];
  /** Commands shown by the slash menu; shortcuts do not imply this. */
  inSlashMenu?: boolean;
  run: (context: CommandContext) => boolean;
}
