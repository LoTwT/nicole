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

/** The key as produced by the layout, after `keyName` normalization. */
function characterKey(event: KeyboardEvent): string {
  return canonicalKeyName(keyName(event));
}

/**
 * Physical-key fallbacks for layouts where `key` is not the US label of the
 * pressed key. CodeMirror only takes this path after the character lookup
 * fails, for events with a command modifier, and when the physical key differs
 * from the character.
 *
 * Differences from CodeMirror: printable ASCII input uses only `keyCode`
 * (assumed to follow the layout) and never `event.code`, so Dvorak ⌘+ and
 * ⇧⌘? cannot borrow the QWERTY bracket labels. Non-ASCII input, `Dead` and
 * `Unidentified` also use `event.code`, which CodeMirror ignores; this keeps
 * Cyrillic ⌘W working from the physical letter position. Pairs from the
 * `shift` table are considered only when Shift is held, and a candidate equal
 * to the produced character is skipped.
 */
function physicalKeys(event: KeyboardEvent): Set<string> {
  const keys = new Set<string>();
  const character = characterKey(event);
  // Single printable ASCII characters already identify the produced key.
  // Letters may not be derived from the physical position in that case.
  const allowLetters = !(
    character.length === 1 && character.charCodeAt(0) < 0x80
  );
  const add = (name: string | null | undefined) => {
    if (!name) return;
    const key = canonicalKeyName(name);
    if (!allowLetters && /^[a-z]$/.test(key)) return;
    if (key !== character) keys.add(key);
  };

  // `event.code` is physical, so it is only safe when the layout did not
  // produce a printable ASCII character of its own.
  if (allowLetters) add(keyFromCode(event.code));
  // keyCode is the same physical-key fallback CodeMirror uses.
  const fromKeyCode = event.keyCode;
  if (fromKeyCode) {
    add(base[fromKeyCode]);
    if (event.shiftKey) add(shift[fromKeyCode]);
  }
  return keys;
}

function allowsPhysicalFallback(
  event: KeyboardEvent,
  platform: AppPlatform,
): boolean {
  if (!(event.altKey || event.ctrlKey || event.metaKey)) return false;
  // Ctrl+Alt is AltGr on some Windows/Linux layouts.
  if (platform !== "macos" && event.ctrlKey && event.altKey) return false;
  // Option-only combinations type characters on macOS.
  if (platform === "macos" && event.altKey && !event.ctrlKey && !event.metaKey) {
    return false;
  }
  return true;
}

function modifiersMatch(
  event: KeyboardEvent,
  parsed: ParsedKeyBinding,
): boolean {
  return (
    event.metaKey === parsed.meta &&
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

/** Matches the character part of a binding without any physical fallback. */
function matchesCharacter(
  event: KeyboardEvent,
  parsed: ParsedKeyBinding,
): boolean {
  return modifiersMatch(event, parsed) && characterKey(event) === parsed.key;
}

/** Matches one binding through the physical fallback for this platform. */
function matchesPhysicalKey(
  event: KeyboardEvent,
  parsed: ParsedKeyBinding,
  platform: AppPlatform,
): boolean {
  if (!modifiersMatch(event, parsed)) return false;
  if (!allowsPhysicalFallback(event, platform)) return false;
  return physicalKeys(event).has(parsed.key);
}

/** Whether one CodeMirror-style binding matches this keyboard event. */
export function matchesKeyBinding(
  event: KeyboardEvent,
  binding: CommandKeyBinding,
  platform: AppPlatform,
): boolean {
  const parsed = parseKeyBinding(binding, platform);
  if (!parsed) return false;
  return (
    matchesCharacter(event, parsed) || matchesPhysicalKey(event, parsed, platform)
  );
}

/**
 * Finds the available command in `scope` bound to this event. The search is
 * two-pass so a character match always wins over a physical-key fallback,
 * regardless of registry order. Placeholders (`available: false`) never run,
 * but their bindings stay in the registry for display and for the feature that
 * will implement them.
 */
export function matchCommand(
  event: KeyboardEvent,
  platform: AppPlatform,
  commands: readonly CommandDefinition[],
  scope: CommandScope,
): CommandDefinition | null {
  // The IME owns every key while composing. Components also guard this, but
  // keeping the check here makes every registry consumer safe by default.
  if (event.isComposing || event.keyCode === 229) return null;

  const candidates: { command: CommandDefinition; parsed: ParsedKeyBinding }[] =
    [];
  for (const command of commands) {
    if (command.scope !== scope || !isCommandAvailable(command)) continue;
    for (const binding of command.keys ?? []) {
      const parsed = parseKeyBinding(binding, platform);
      if (parsed) candidates.push({ command, parsed });
    }
  }
  for (const { command, parsed } of candidates) {
    if (matchesCharacter(event, parsed)) return command;
  }
  for (const { command, parsed } of candidates) {
    if (matchesPhysicalKey(event, parsed, platform)) return command;
  }
  return null;
}
