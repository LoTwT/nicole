import { base, keyName, shift } from "w3c-keyname";

import type { AppPlatform } from "../app/platform";
import { isCommandAvailable, resolveKeyBinding } from "./registry";
import type {
  CommandDefinition,
  CommandKeyBinding,
  CommandScope,
} from "./types";

interface ParsedKeyBinding {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

function canonicalKeyName(name: string): string {
  let value = name;
  if (value === "Space") value = " ";
  if (value === "Esc") value = "Escape";
  if (value === "Del") value = "Delete";
  if (value === "Left") value = "ArrowLeft";
  if (value === "Right") value = "ArrowRight";
  if (value === "Up") value = "ArrowUp";
  if (value === "Down") value = "ArrowDown";
  return value.toLowerCase();
}

/**
 * CodeMirror key names use `Mod` for the platform's primary modifier. The
 * platform-specific string is resolved first, so `mac`/`win`/`linux` entries
 * may spell the modifier explicitly.
 */
function parseKeyBinding(
  binding: CommandKeyBinding,
  platform: AppPlatform,
): ParsedKeyBinding | null {
  const name = resolveKeyBinding(binding, platform);
  if (!name) return null;

  const parts = name.split(/-(?!$)/);
  const key = parts.pop();
  if (!key) return null;

  const parsed: ParsedKeyBinding = {
    key: canonicalKeyName(key === "Space" ? " " : key),
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
  };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case "cmd":
      case "meta":
      case "m":
        parsed.meta = true;
        break;
      case "alt":
      case "option":
      case "a":
        parsed.alt = true;
        break;
      case "ctrl":
      case "control":
      case "c":
        parsed.ctrl = true;
        break;
      case "shift":
      case "s":
        parsed.shift = true;
        break;
      case "mod":
        if (platform === "macos") {
          parsed.meta = true;
        } else {
          parsed.ctrl = true;
        }
        break;
      default:
        return null;
    }
  }
  return parsed;
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  IntlBackslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Space: " ",
  Enter: "Enter",
  NumpadEnter: "Enter",
  Tab: "Tab",
  Backspace: "Backspace",
  Delete: "Delete",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Escape: "Escape",
};

function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] ?? null;
}

function eventKeyNames(event: KeyboardEvent): Set<string> {
  const names = new Set<string>();
  const add = (name: string | null | undefined) => {
    if (name) names.add(canonicalKeyName(name));
  };

  add(keyName(event));
  add(keyFromCode(event.code));
  // keyCode is a physical-key fallback for layouts where `key` differs from
  // the US layout. CodeMirror uses the same tables for its own keymaps.
  const fromKeyCode = event.keyCode;
  if (fromKeyCode) {
    add(base[fromKeyCode]);
    if (event.shiftKey) add(shift[fromKeyCode]);
  }
  return names;
}

/** Whether one CodeMirror-style binding matches this keyboard event. */
export function matchesKeyBinding(
  event: KeyboardEvent,
  binding: CommandKeyBinding,
  platform: AppPlatform,
): boolean {
  const parsed = parseKeyBinding(binding, platform);
  if (!parsed) return false;
  if (
    event.metaKey !== parsed.meta ||
    event.ctrlKey !== parsed.ctrl ||
    event.altKey !== parsed.alt ||
    event.shiftKey !== parsed.shift
  ) {
    return false;
  }
  return eventKeyNames(event).has(parsed.key);
}

/**
 * Finds the available command in `scope` bound to this event. Placeholders
 * (`available: false`) never run, but their bindings stay in the registry for
 * display and for the feature that will implement them.
 */
export function matchCommand(
  event: KeyboardEvent,
  platform: AppPlatform,
  commands: readonly CommandDefinition[],
  scope: CommandScope,
): CommandDefinition | null {
  for (const command of commands) {
    if (command.scope !== scope || !isCommandAvailable(command)) continue;
    for (const binding of command.keys ?? []) {
      if (matchesKeyBinding(event, binding, platform)) return command;
    }
  }
  return null;
}
