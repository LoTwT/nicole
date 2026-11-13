import { isMac, type AppPlatform } from "../app/platform";
import { appCommands } from "./app";
import { findCommands } from "./find";
import { formatCommands } from "./format";
import type { CommandDefinition, CommandKeyBinding } from "./types";

/**
 * The only command registry. Slash commands, keymaps, context menus, hints and
 * the future command palette and formatting toolbar read from this list.
 */
export const commandRegistry: readonly CommandDefinition[] = [
  ...formatCommands,
  ...findCommands,
  ...appCommands,
];

const byId = new Map(commandRegistry.map((command) => [command.id, command]));

/**
 * Resolves an id against the static registry and one dynamic snapshot. The
 * page uses this for commands it saw in a menu; a static id wins, so a
 * workspace template can never replace a built-in command.
 */
export function getCommand(
  id: string,
  extra: readonly CommandDefinition[] = [],
): CommandDefinition | undefined {
  return byId.get(id) ?? extra.find((command) => command.id === id);
}

/** Commands that are implemented and dispatchable; placeholders are skipped. */
export function isCommandAvailable(command: CommandDefinition): boolean {
  return command.available !== false;
}

/**
 * Slash entries from the static registry plus the current workspace snapshot.
 * The caller passes the snapshot; the registry remains the only place that
 * decides which commands may appear in a menu.
 */
export function slashCommands(
  extra: readonly CommandDefinition[] = [],
): readonly CommandDefinition[] {
  return [...commandRegistry, ...extra].filter(
    (command) =>
      command.scope === "editor" &&
      command.inSlashMenu &&
      isCommandAvailable(command),
  );
}

export function resolveKeyBinding(
  binding: CommandKeyBinding,
  platform: AppPlatform,
): string | null {
  if (platform === "macos") return binding.mac ?? binding.key ?? null;
  if (platform === "windows") return binding.win ?? binding.key ?? null;
  return binding.linux ?? binding.key ?? null;
}

const MAC_MODIFIERS = {
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  mod: "⌘",
} as const;

const KEY_LABELS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  space: "Space",
};

const MAC_KEY_ORDER = ["ctrl", "alt", "shift", "mod"] as const;

type Modifier = (typeof MAC_KEY_ORDER)[number];

function canonicalModifier(part: string): Modifier | null {
  switch (part.toLowerCase()) {
    case "ctrl":
    case "control":
      return "ctrl";
    case "alt":
    case "option":
      return "alt";
    case "shift":
      return "shift";
    case "mod":
    case "cmd":
    case "meta":
      return "mod";
    default:
      return null;
  }
}

function displayKeyName(part: string, platform: AppPlatform): string {
  const known = KEY_LABELS[part.toLowerCase()];
  if (known) {
    if (part.toLowerCase() === "backspace" && isMac(platform)) return "⌫";
    return known;
  }
  if (part.length === 1) return part.toUpperCase();
  return part;
}

function parseBinding(
  binding: CommandKeyBinding,
  platform: AppPlatform,
): { modifiers: Set<Modifier>; base: string; key: string } | null {
  const key = resolveKeyBinding(binding, platform);
  if (!key) return null;
  const modifiers = new Set<Modifier>();
  let base = "";
  for (const part of key.split("-")) {
    const modifier = canonicalModifier(part);
    if (modifier) {
      modifiers.add(modifier);
    } else {
      base = part;
    }
  }
  return { modifiers, base, key };
}

/** Converts one CodeMirror key binding to platform shortcut text. */
export function formatKeyBinding(
  binding: CommandKeyBinding,
  platform: AppPlatform,
): string | null {
  const parsed = parseBinding(binding, platform);
  if (parsed === null) return null;
  const { modifiers, base, key } = parsed;

  const mac = isMac(platform);
  const parts: string[] = [];
  if (mac) {
    for (const modifier of MAC_KEY_ORDER) {
      if (modifiers.has(modifier)) parts.push(MAC_MODIFIERS[modifier]);
    }
  } else {
    // `Mod` is Ctrl on Windows and Linux, so it shares the first slot.
    if (modifiers.has("mod") || modifiers.has("ctrl")) parts.push("Ctrl");
    if (modifiers.has("alt")) parts.push("Alt");
    if (modifiers.has("shift")) parts.push("Shift");
  }
  parts.push(displayKeyName(base || key, platform));
  return mac ? parts.join("") : parts.join("+");
}

/** Shortcut text for the first binding that exists on the platform. */
export function formatCommandShortcut(
  command: CommandDefinition,
  platform: AppPlatform,
): string | null {
  for (const binding of command.keys ?? []) {
    const text = formatKeyBinding(binding, platform);
    if (text) return text;
  }
  return null;
}

const NATIVE_KEY_LABELS: Record<string, string> = {
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  enter: "Enter",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  space: "Space",
};

/**
 * Converts a registry binding to MyGo's native accelerator syntax. The native
 * application menu reads this value from the page, so it has no second key
 * table of its own.
 */
export function nativeAccelerator(
  command: CommandDefinition,
  platform: AppPlatform,
): string | null {
  for (const binding of command.keys ?? []) {
    const parsed = parseBinding(binding, platform);
    if (parsed === null) continue;
    const { modifiers, base, key } = parsed;
    const parts: string[] = [];
    if (modifiers.has("ctrl")) parts.push("Ctrl");
    if (modifiers.has("alt")) parts.push("Alt");
    if (modifiers.has("shift")) parts.push("Shift");
    if (modifiers.has("mod")) {
      parts.push(isMac(platform) ? "Cmd" : "CmdOrCtrl");
    }
    const label = NATIVE_KEY_LABELS[(base || key).toLowerCase()] ?? base;
    parts.push(label || key);
    return parts.join("+");
  }
  return null;
}

/**
 * Shortcut text for an entry in the registry. Callers use this instead of
 * spelling keys themselves, so hints, menus and tests share one formatter.
 */
export function commandShortcut(id: string, platform: AppPlatform): string {
  const command = byId.get(id);
  return command ? (formatCommandShortcut(command, platform) ?? "") : "";
}
