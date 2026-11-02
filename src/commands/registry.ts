import { isMac, type AppPlatform } from "../app/platform";
import { formatCommands } from "./format";
import type { CommandDefinition, CommandKeyBinding } from "./types";

/**
 * The only command registry. Slash commands, keymaps, the command palette and
 * the formatting toolbar read from this list.
 */
export const commandRegistry: readonly CommandDefinition[] = [...formatCommands];

const byId = new Map(commandRegistry.map((command) => [command.id, command]));

export function getCommand(id: string): CommandDefinition | undefined {
  return byId.get(id);
}

export function slashCommands(): readonly CommandDefinition[] {
  return commandRegistry.filter(
    (command) => command.scope === "editor" && command.inSlashMenu,
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
  control: "⌃",
  alt: "⌥",
  option: "⌥",
  shift: "⇧",
  mod: "⌘",
  cmd: "⌘",
  meta: "⌘",
} as const;

const OTHER_MODIFIERS = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  mod: "Ctrl",
  cmd: "Ctrl",
  meta: "Win",
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

const KEY_ORDER = ["ctrl", "alt", "shift", "mod"] as const;

type Modifier = (typeof KEY_ORDER)[number];

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

/** Converts one CodeMirror key binding to platform shortcut text. */
export function formatKeyBinding(
  binding: CommandKeyBinding,
  platform: AppPlatform,
): string | null {
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

  const mac = isMac(platform);
  const labels = mac ? MAC_MODIFIERS : OTHER_MODIFIERS;
  const parts: string[] = KEY_ORDER.filter((modifier) =>
    modifiers.has(modifier),
  ).map((modifier) => labels[modifier]);
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
