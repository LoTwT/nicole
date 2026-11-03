import type { NativeMenuItem } from "../services/mygo";
import {
  commandShortcut,
  TAB_CLOSE_COMMAND,
  TAB_REOPEN_COMMAND,
} from "./commands";

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

/** Shortcut text for a native menu; bindings themselves live in the keymap. */
export function shortcutText(
  command:
    | "open-folder"
    | "new-file"
    | "new-folder"
    | "search"
    | "rename"
    | "trash"
    | "open"
    | "close-tab"
    | "reopen-tab"
    | "save"
    | "sidebar"
    | "outline"
    | "mode-live"
    | "mode-immersive"
    | "mode-source",
  platform: AppPlatform,
): string {
  const mac = isMac(platform);
  switch (command) {
    case "open-folder":
      return mac ? "⌘O" : "Ctrl+O";
    case "new-file":
      return mac ? "⌘N" : "Ctrl+N";
    case "new-folder":
      return mac ? "⇧⌘N" : "Ctrl+Shift+N";
    case "search":
      return mac ? "⇧⌘F" : "Ctrl+Shift+F";
    case "rename":
      return mac ? "Enter" : "F2";
    case "trash":
      return mac ? "⌘⌫" : "Delete";
    case "open":
      return mac ? "⌘↓" : "Enter";
    case "close-tab":
      return commandShortcut(TAB_CLOSE_COMMAND, platform);
    case "reopen-tab":
      return commandShortcut(TAB_REOPEN_COMMAND, platform);
    case "save":
      return mac ? "⌘S" : "Ctrl+S";
    case "sidebar":
      return mac ? "⌃⌘S" : "Ctrl+Shift+E";
    case "outline":
      return mac ? "⌃⌘O" : "Ctrl+Shift+L";
    case "mode-live":
      return mac ? "⌃⌘1" : "Ctrl+Shift+1";
    case "mode-immersive":
      return mac ? "⌃⌘2" : "Ctrl+Shift+2";
    case "mode-source":
      return mac ? "⌃⌘3" : "Ctrl+Shift+3";
  }
}

export type MenuTarget = "file" | "folder" | "blank" | "root" | "tab";

export interface ContextMenuOptions {
  target: MenuTarget;
  platform: AppPlatform;
  isMarkdown: boolean;
  /** The tab belongs to the open workspace, so it can be revealed there. */
  inWorkspace: boolean;
  /** Tab menus: more than one tab is open, so "close others" applies. */
  hasOtherTabs?: boolean;
  /** Tab menus: at least one tab sits to the right of the clicked tab. */
  hasTabsRight?: boolean;
  /** Tab menus: a closed tab can be reopened. */
  canReopen?: boolean;
}

/**
 * Builds the file-tree, root and tab context menus. IDs are stable so the
 * caller can dispatch the chosen command; labels come from the interface,
 * never from file contents.
 */
export function buildContextMenu(
  options: ContextMenuOptions,
): NativeMenuItem[] {
  const { target, platform } = options;
  if (target === "tab") {
    return [
      { id: "close-tab", label: "关闭", accelerator: shortcutText("close-tab", platform) },
      { id: "close-other-tabs", label: "关闭其他", disabled: !options.hasOtherTabs },
      { id: "close-tabs-right", label: "关闭右侧", disabled: !options.hasTabsRight },
      { id: "close-all-tabs", label: "关闭全部" },
      { id: "", label: "", separator: true },
      { id: "reopen-tab", label: "重新打开关闭的标签页", accelerator: shortcutText("reopen-tab", platform), disabled: !options.canReopen },
      { id: "", label: "", separator: true },
      { id: "reveal-in-tree", label: "在文件树中定位", disabled: !options.inWorkspace },
      { id: "reveal", label: revealLabel(platform) },
      { id: "", label: "", separator: true },
      { id: "copy-path", label: "复制路径" },
      { id: "copy-relative-path", label: "复制相对路径", disabled: !options.inWorkspace },
    ];
  }

  if (target === "blank") {
    return [
      { id: "new-file", label: "新建文件", accelerator: shortcutText("new-file", platform) },
      { id: "new-folder", label: "新建文件夹", accelerator: shortcutText("new-folder", platform) },
    ];
  }

  const items: NativeMenuItem[] = [
    { id: "new-file", label: "新建文件", accelerator: shortcutText("new-file", platform) },
    { id: "new-folder", label: "新建文件夹", accelerator: shortcutText("new-folder", platform) },
  ];
  if (target !== "root") {
    items.push(
      { id: "rename", label: "重命名", accelerator: shortcutText("rename", platform) },
      { id: "trash", label: trashLabel(platform), accelerator: shortcutText("trash", platform) },
    );
  }
  items.push({ id: "", label: "", separator: true });
  if (target === "file" && !options.isMarkdown) {
    items.push({ id: "open-default-app", label: "用默认应用打开" });
  }
  items.push({ id: "reveal", label: revealLabel(platform) });
  items.push({ id: "", label: "", separator: true });
  items.push({ id: "copy-path", label: "复制路径" });
  if (target !== "root") {
    items.push({ id: "copy-relative-path", label: "复制相对路径" });
  }
  return items;
}
