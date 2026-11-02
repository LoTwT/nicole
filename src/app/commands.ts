import type { AppPlatform } from "./platform";

/**
 * A keyboard shortcut in the shape the future command registry will accept.
 * `key` uses the browser's KeyboardEvent.key spelling; `meta` and `ctrl` are
 * kept separate so Windows and Linux bindings stay explicit.
 */
export interface CommandKeyBinding {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface AppCommandSpec {
  id: string;
  title: string;
  keybindings: Readonly<Record<AppPlatform, readonly CommandKeyBinding[]>>;
  run: () => void | Promise<void>;
}

export interface TabCommandActions {
  close: () => void | Promise<void>;
  reopen: () => void | Promise<void>;
  next: () => void | Promise<void>;
  previous: () => void | Promise<void>;
}

export const TAB_CLOSE_COMMAND = "tab.close";
export const TAB_REOPEN_COMMAND = "tab.reopen";
export const TAB_NEXT_COMMAND = "tab.next";
export const TAB_PREVIOUS_COMMAND = "tab.previous";

const BINDINGS = {
  [TAB_CLOSE_COMMAND]: {
    macos: [{ key: "w", meta: true }],
    windows: [{ key: "w", ctrl: true }],
    linux: [{ key: "w", ctrl: true }],
  },
  [TAB_REOPEN_COMMAND]: {
    macos: [{ key: "t", meta: true, shift: true }],
    windows: [{ key: "t", ctrl: true, shift: true }],
    linux: [{ key: "t", ctrl: true, shift: true }],
  },
  [TAB_NEXT_COMMAND]: {
    macos: [
      { key: "Tab", ctrl: true },
      { key: "]", meta: true, shift: true },
    ],
    windows: [
      { key: "Tab", ctrl: true },
      { key: "PageDown", ctrl: true },
    ],
    linux: [
      { key: "Tab", ctrl: true },
      { key: "PageDown", ctrl: true },
    ],
  },
  [TAB_PREVIOUS_COMMAND]: {
    macos: [
      { key: "Tab", ctrl: true, shift: true },
      { key: "[", meta: true, shift: true },
    ],
    windows: [
      { key: "Tab", ctrl: true, shift: true },
      { key: "PageUp", ctrl: true },
    ],
    linux: [
      { key: "Tab", ctrl: true, shift: true },
      { key: "PageUp", ctrl: true },
    ],
  },
} as const satisfies Record<string, Record<AppPlatform, readonly CommandKeyBinding[]>>;

const TITLES: Record<string, string> = {
  [TAB_CLOSE_COMMAND]: "关闭标签页",
  [TAB_REOPEN_COMMAND]: "重新打开关闭的标签页",
  [TAB_NEXT_COMMAND]: "下一个标签页",
  [TAB_PREVIOUS_COMMAND]: "上一个标签页",
};

const RUNNERS: Record<string, keyof TabCommandActions> = {
  [TAB_CLOSE_COMMAND]: "close",
  [TAB_REOPEN_COMMAND]: "reopen",
  [TAB_NEXT_COMMAND]: "next",
  [TAB_PREVIOUS_COMMAND]: "previous",
};

/**
 * Tab commands all live here so the bindings can move into the command
 * registry without touching TopBar or App.vue. The registry PR replaces the
 * runner with registry entries; ids, titles and bindings stay the same.
 */
export function createTabCommands(actions: TabCommandActions): AppCommandSpec[] {
  return Object.keys(TITLES).map((id) => ({
    id,
    title: TITLES[id]!,
    keybindings: BINDINGS[id as keyof typeof BINDINGS],
    run: () => actions[RUNNERS[id]!](),
  }));
}

function matches(event: KeyboardEvent, binding: CommandKeyBinding): boolean {
  if (event.key.toLowerCase() !== binding.key.toLowerCase()) {
    return false;
  }
  return (
    event.metaKey === Boolean(binding.meta) &&
    event.ctrlKey === Boolean(binding.ctrl) &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}

/** Finds the tab command bound to this key event, if any. */
export function matchCommand(
  event: KeyboardEvent,
  platform: AppPlatform,
  commands: readonly AppCommandSpec[],
): AppCommandSpec | null {
  for (const command of commands) {
    if (
      command.keybindings[platform].some((binding) => matches(event, binding))
    ) {
      return command;
    }
  }
  return null;
}

function keyLabel(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

function bindingText(binding: CommandKeyBinding, platform: AppPlatform): string {
  if (platform === "macos") {
    return `${binding.ctrl ? "⌃" : ""}${binding.alt ? "⌥" : ""}${
      binding.shift ? "⇧" : ""
    }${binding.meta ? "⌘" : ""}${keyLabel(binding.key)}`;
  }
  const parts = ["Ctrl"];
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  parts.push(keyLabel(binding.key));
  return parts.join("+");
}

/** The first displayed shortcut for a tab command, used by menus and hints. */
export function commandShortcut(id: string, platform: AppPlatform): string {
  const bindings = BINDINGS[id as keyof typeof BINDINGS];
  const binding = bindings?.[platform][0];
  return binding ? bindingText(binding, platform) : "";
}
