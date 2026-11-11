import type { EditorState, TransactionSpec } from "@codemirror/state";

import type { CommandPaletteMode } from "../app/command-palette";
import type { TreeNode } from "../app/file-tree";
import type { AppPlatform } from "../app/platform";

export type CommandScope = "editor" | "app" | "file-tree";

/** Toolbar grouping; commands without a toolbar use `insert`, app commands use `app`. */
export type CommandGroup = "inline" | "paragraph" | "block" | "insert" | "app";

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

export type CommandEditorMode = "live" | "immersive" | "source";

/**
 * Application actions supplied by `App.vue`. Keeping them in the context
 * lets the static registry own the command definitions while reactive state
 * stays in the component.
 */
export interface AppCommandActions {
  chooseFolder(): void | Promise<void>;
  newFile(): void | Promise<void>;
  saveCurrent(): void | Promise<void>;
  toggleSidebar(): void | Promise<void>;
  toggleOutline(): void | Promise<void>;
  setMode(mode: CommandEditorMode): void | Promise<void>;
  toggleTheme(): void | Promise<void>;
  closeActiveTab(): void | Promise<void>;
  closeWorkspace(): void | Promise<void>;
  collapseAllFolders(): void | Promise<void>;
  revealWorkspace(): void | Promise<void>;
  reopenClosedTab(): void | Promise<void>;
  nextTab(): void | Promise<void>;
  previousTab(): void | Promise<void>;
  openCommandPalette(mode: CommandPaletteMode): void | Promise<void>;
}

/** The focused tree row and the actions a file-tree command can run. */
export interface FileTreeCommandContext {
  focusedNode: TreeNode | null;
  open(node: TreeNode): void | Promise<void>;
  rename(node: TreeNode): void | Promise<void>;
  trash(node: TreeNode): void | Promise<void>;
  /** Creates a folder next to the focused node; `null` means the root. */
  createFolder(node: TreeNode | null): void | Promise<void>;
}

export interface CommandContext {
  /** Null when an application command is invoked outside an editor. */
  view: CommandTarget | null;
  platform: AppPlatform;
  /** Present when `App.vue` dispatches an app command. */
  app?: AppCommandActions;
  /** Present when `FileTree.vue` dispatches a file-tree command. */
  fileTree?: FileTreeCommandContext;
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
  /**
   * False while the feature behind the command is not implemented. The
   * command stays registered so its shortcut has one definition, but key
   * dispatch and future menus skip it. Defaults to true.
   */
  available?: boolean;
  /**
   * True when the command needs an open workspace. The palette does not list
   * it and key dispatch does not run it while there is no root.
   */
  requiresWorkspace?: boolean;
  /**
   * True when the command needs at least one open tab. The palette does not
   * list it and key dispatch does not run it on the start page or when the
   * last tab was closed.
   */
  requiresOpenTab?: boolean;
  /**
   * True when the command needs the active tab to be a Markdown file. The
   * palette does not list it while a preview tab or the start page is active;
   * key dispatch does not run it in that state.
   */
  requiresActiveMarkdown?: boolean;
  /**
   * True when the command needs more than one open tab. The palette does not
   * list it with zero or one tab; key dispatch does not run it in that state.
   */
  requiresMultipleTabs?: boolean;
  /**
   * True when the command needs at least one tab in the closed history. The
   * palette does not list it while the history is empty; key dispatch does not
   * run it in that state.
   */
  requiresClosedTab?: boolean;
  run: (context: CommandContext) => boolean;
}
