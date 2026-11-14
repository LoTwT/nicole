import type { AppPlatform } from "../app/platform";
import type { CommandDefinition, CommandKeyBinding } from "./types";

let overrides: Readonly<Record<string, string>> = {};
let observe = () => {};

/** UI consumers can track changes without making the command layer depend on Vue. */
export function setCommandKeybindings(
  value: Readonly<Record<string, string>>,
  onRead: () => void = () => {},
) {
  overrides = { ...value };
  observe = onRead;
}
export function commandBindings(
  command: CommandDefinition,
): readonly CommandKeyBinding[] {
  observe();
  const value = overrides[command.id];
  return value === undefined
    ? (command.keys ?? [])
    : value === ""
      ? []
      : [{ key: value }];
}
const fixedCommands = new Set([
  "app.settings",
  "tab.close",
  "tab.next",
  "tab.previous",
]);
export function canonicalShortcut(
  value: string,
  platform: AppPlatform,
): string | null {
  const parts = value.trim().split(/-(?!$)/),
    key = parts.pop();
  if (
    !key ||
    !/^(?:[a-z0-9,./;='\[\]`\\-]|F(?:[1-9]|1[0-9]|2[0-4])|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Space|Enter|Tab|Backspace|Delete)$/i.test(
      key,
    )
  )
    return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const normalized = part.toLowerCase();
    if (normalized === "mod")
      modifiers.add(platform === "macos" ? "meta" : "ctrl");
    else if (["cmd", "meta"].includes(normalized)) modifiers.add("meta");
    else if (["ctrl", "control"].includes(normalized)) modifiers.add("ctrl");
    else if (["alt", "option"].includes(normalized)) modifiers.add("alt");
    else if (normalized === "shift") modifiers.add("shift");
    else return null;
  }
  if (
    !["meta", "ctrl", "alt"].some((modifier) => modifiers.has(modifier)) &&
    !/^F\d+$/i.test(key)
  )
    return null;
  return [
    ...["meta", "ctrl", "alt", "shift"].filter((modifier) =>
      modifiers.has(modifier),
    ),
    key.toLowerCase(),
  ].join("-");
}
function resolve(binding: CommandKeyBinding, platform: AppPlatform) {
  return (
    (platform === "macos"
      ? binding.mac
      : platform === "windows"
        ? binding.win
        : binding.linux) ?? binding.key
  );
}
export function validateKeybinding(
  id: string,
  value: string,
  values: Record<string, string>,
  commands: readonly CommandDefinition[],
  platform: AppPlatform,
): string | null {
  const command = commands.find((item) => item.id === id);
  if (!command) return "未知命令";
  if (fixedCommands.has(id)) return "设置入口与标签页导航保留默认快捷键";
  if (value.trim() === "") return null;
  const canonical = canonicalShortcut(value, platform);
  if (canonical === null) return "请输入带修饰键的快捷键，如 Mod-Alt-b";
  const primary = platform === "macos" ? "meta" : "ctrl";
  if (
    ["c", "x", "v", "a", "q", "h", "m", ","].some(
      (key) => canonical === `${primary}-${key}`,
    ) ||
    /^(?:alt|meta)-tab$/.test(canonical)
  )
    return "此快捷键由系统或基础文本操作保留";
  for (const other of commands) {
    if (
      other.id === id ||
      (other.scope !== command.scope &&
        other.scope !== "app" &&
        command.scope !== "app")
    )
      continue;
    const custom = values[other.id],
      bindings =
        custom === undefined
          ? (other.keys ?? [])
          : custom === ""
            ? []
            : [{ key: custom }];
    if (
      bindings.some(
        (binding) =>
          canonicalShortcut(resolve(binding, platform) ?? "", platform) ===
          canonical,
      )
    )
      return `与“${other.label}”冲突`;
  }
  return null;
}
export function validatedKeybindings(
  values: Record<string, string>,
  commands: readonly CommandDefinition[],
  platform: AppPlatform,
) {
  const valid: Record<string, string> = {};
  for (const [id, key] of Object.entries(values))
    if (validateKeybinding(id, key, values, commands, platform) === null)
      valid[id] = key.trim();
  return valid;
}
export function canCustomizeCommand(id: string) {
  return !fixedCommands.has(id);
}
