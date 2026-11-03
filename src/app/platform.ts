export type AppPlatform = "macos" | "windows" | "linux";

export function appPlatform(os: string): AppPlatform {
  if (os === "darwin" || os === "macos") {
    return "macos";
  }
  if (os === "windows" || os === "win32") {
    return "windows";
  }
  return "linux";
}

export function isMac(platform: AppPlatform): boolean {
  return platform === "macos";
}

export function revealLabel(platform: AppPlatform): string {
  if (platform === "windows") {
    return "在资源管理器中显示";
  }
  if (platform === "linux") {
    return "在文件管理器中显示";
  }
  return "在 Finder 中显示";
}

export function trashLabel(platform: AppPlatform): string {
  return isMac(platform) ? "移到废纸篓" : "移到回收站";
}

const SHORTCUT_SYMBOLS = "⌘⇧⌃⌥⌫↑↓←→";

/** Split displayed shortcut text into one label per keycap. */
export function shortcutKeycaps(text: string): string[] {
  const value = text.trim();
  if (!value) {
    return [];
  }
  if (value.includes("+")) {
    return value
      .split("+")
      .map((key) => key.trim())
      .filter(Boolean);
  }
  const keys = Array.from(value);
  if (keys.length > 1 && SHORTCUT_SYMBOLS.includes(keys[0]!)) {
    const keycaps: string[] = [];
    while (
      keycaps.length < keys.length - 1 &&
      SHORTCUT_SYMBOLS.includes(keys[keycaps.length]!)
    ) {
      keycaps.push(keys[keycaps.length]!);
    }
    keycaps.push(keys.slice(keycaps.length).join(""));
    return keycaps;
  }
  return [value];
}
