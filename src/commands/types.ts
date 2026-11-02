import type { EditorState, TransactionSpec } from "@codemirror/state";

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

/**
 * The part of an editor that commands need. `EditorView` satisfies it; the
 * slash menu can also run a command against a state with the trigger removed
 * before committing the combined transaction.
 */
export interface CommandTarget {
  readonly state: EditorState;
  dispatch(...specs: TransactionSpec[]): void;
}

export interface CommandContext {
  /** Null when an application command is invoked outside an editor. */
  view: CommandTarget | null;
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
