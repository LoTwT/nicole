import { commandShortcut } from "../commands/registry";
import type { NativeMenuItem } from "../services/mygo";
import { revealLabel, trashLabel, type AppPlatform } from "./platform";

export type MenuTarget =
  | "file"
  | "folder"
  | "blank"
  | "tab"
  | "workspace-tools";

export interface ContextMenuOptions {
  target: MenuTarget;
  platform: AppPlatform;
  isMarkdown: boolean;
  /** The settings page is not a file; file actions stay disabled. */
  isSettings?: boolean;
  /** The tab belongs to the open workspace, so it can be revealed there. */
  inWorkspace: boolean;
  /** Tab menus: more than one tab is open, so "close others" applies. */
  hasOtherTabs?: boolean;
  /** Tab menus: at least one tab sits to the right of the clicked tab. */
  hasTabsRight?: boolean;
  /** Tab menus: a closed tab can be reopened. */
  canReopen?: boolean;
}

/** Menu accelerators always come from the shared registry. */
function accelerator(id: string, platform: AppPlatform): string {
  return commandShortcut(id, platform);
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
      {
        id: "close-tab",
        label: "关闭",
        accelerator: accelerator("tab.close", platform),
      },
      { id: "close-other-tabs", label: "关闭其他", disabled: !options.hasOtherTabs },
      { id: "close-tabs-right", label: "关闭右侧", disabled: !options.hasTabsRight },
      { id: "close-all-tabs", label: "关闭全部" },
      { id: "", label: "", separator: true },
      {
        id: "reopen-tab",
        label: "重新打开关闭的标签页",
        accelerator: accelerator("tab.reopen", platform),
        disabled: !options.canReopen,
      },
      { id: "", label: "", separator: true },
      {
        id: "reveal-in-tree",
        label: "在文件树中定位",
        disabled: !(options.inWorkspace && options.isSettings !== true),
      },
      {
        id: "reveal",
        label: revealLabel(platform),
        disabled: options.isSettings === true,
      },
      { id: "", label: "", separator: true },
      {
        id: "copy-path",
        label: "复制路径",
        disabled: options.isSettings === true,
      },
      {
        id: "copy-relative-path",
        label: "复制相对路径",
        disabled: !(options.inWorkspace && options.isSettings !== true),
      },
    ];
  }

  if (target === "blank") {
    return [
      {
        id: "new-file",
        label: "新建文件",
        accelerator: accelerator("app.new-file", platform),
      },
      {
        id: "new-folder",
        label: "新建文件夹",
        accelerator: accelerator("file-tree.new-folder", platform),
      },
      { id: "", label: "", separator: true },
      { id: "reveal", label: revealLabel(platform) },
      { id: "", label: "", separator: true },
      { id: "copy-path", label: "复制路径" },
      { id: "", label: "", separator: true },
      { id: "app.close-workspace", label: "关闭工作区" },
    ];
  }

  if (target === "workspace-tools") {
    return [
      { id: "app.reveal-workspace", label: revealLabel(platform) },
      { id: "copy-workspace-path", label: "复制路径" },
      { id: "", label: "", separator: true },
      { id: "app.close-workspace", label: "关闭工作区" },
    ];
  }

  const items: NativeMenuItem[] = [
    {
      id: "new-file",
      label: "新建文件",
      accelerator: accelerator("app.new-file", platform),
    },
    {
      id: "new-folder",
      label: "新建文件夹",
      accelerator: accelerator("file-tree.new-folder", platform),
    },
    {
      id: "rename",
      label: "重命名",
      accelerator: accelerator("file-tree.rename", platform),
    },
    {
      id: "trash",
      label: trashLabel(platform),
      accelerator: accelerator("file-tree.trash", platform),
    },
  ];
  items.push({ id: "", label: "", separator: true });
  if (target === "file" && !options.isMarkdown) {
    items.push({ id: "open-default-app", label: "用默认应用打开" });
  }
  items.push({ id: "reveal", label: revealLabel(platform) });
  items.push({ id: "", label: "", separator: true });
  items.push({ id: "copy-path", label: "复制路径" });
  items.push({ id: "copy-relative-path", label: "复制相对路径" });
  return items;
}
