import type { NativeMenuItem } from "../services/mygo";

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
      return mac ? "⌘W" : "Ctrl+W";
    case "reopen-tab":
      return mac ? "⇧⌘T" : "Ctrl+Shift+T";
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
      { id: "close-other-tabs", label: "关闭其他", disabled: true },
      { id: "close-tabs-right", label: "关闭右侧", disabled: true },
      { id: "close-all-tabs", label: "关闭全部", disabled: true },
      { id: "", label: "", separator: true },
      { id: "reopen-tab", label: "重新打开关闭的标签页", accelerator: shortcutText("reopen-tab", platform), disabled: true },
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
