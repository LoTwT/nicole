import { describe, expect, it } from "vitest";

import { commandShortcut } from "../commands/registry";
import { buildContextMenu } from "./context-menu";

const ids = (items: ReturnType<typeof buildContextMenu>) =>
  items.filter((item) => !item.separator).map((item) => item.id);

describe("context menus", () => {
  it("builds the file menu with launcher actions for non-Markdown files", () => {
    expect(
      ids(
        buildContextMenu({
          target: "file",
          platform: "macos",
          isMarkdown: false,
          inWorkspace: true,
        }),
      ),
    ).toEqual([
      "new-file",
      "new-folder",
      "rename",
      "trash",
      "open-default-app",
      "reveal",
      "copy-path",
      "copy-relative-path",
    ]);
  });

  it("omits the launcher action for Markdown and folders", () => {
    const markdown = ids(
      buildContextMenu({
        target: "file",
        platform: "macos",
        isMarkdown: true,
        inWorkspace: true,
      }),
    );
    const folder = ids(
      buildContextMenu({
        target: "folder",
        platform: "macos",
        isMarkdown: false,
        inWorkspace: true,
      }),
    );
    expect(markdown).not.toContain("open-default-app");
    expect(folder).not.toContain("open-default-app");
  });

  it("keeps the old root actions on the blank tree menu", () => {
    expect(
      ids(
        buildContextMenu({
          target: "blank",
          platform: "macos",
          isMarkdown: false,
          inWorkspace: true,
        }),
      ),
    ).toEqual([
      "new-file",
      "new-folder",
      "reveal",
      "copy-path",
      "app.close-workspace",
    ]);
  });

  it("builds the workspace tools menu from commands", () => {
    const items = buildContextMenu({
      target: "workspace-tools",
      platform: "windows",
      isMarkdown: false,
      inWorkspace: true,
    });
    expect(items.map((item) => item.label)).toEqual([
      "在资源管理器中显示",
      "复制路径",
      "",
      "关闭工作区",
    ]);
    expect(items.find((item) => item.label === "复制路径")?.id).toBe(
      "copy-workspace-path",
    );
  });

  it("uses the Linux reveal label", () => {
    expect(
      buildContextMenu({
        target: "workspace-tools",
        platform: "linux",
        isMarkdown: false,
        inWorkspace: true,
      })[0]?.label,
    ).toBe("在文件管理器中显示");
  });

  it("leaves the multi-tab actions disabled for the single tab", () => {
    const items = buildContextMenu({
      target: "tab",
      platform: "macos",
      isMarkdown: true,
      inWorkspace: true,
    });
    expect(items.find((item) => item.id === "close-tab")?.disabled).toBeUndefined();
    expect(items.find((item) => item.id === "close-other-tabs")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "reveal-in-tree")?.disabled).toBe(false);
  });

  it("disables file actions on the settings tab but keeps close actions", () => {
    const items = buildContextMenu({
      target: "tab",
      platform: "macos",
      isMarkdown: false,
      isSettings: true,
      inWorkspace: false,
      hasOtherTabs: true,
      hasTabsRight: true,
    });
    for (const id of [
      "reveal-in-tree",
      "reveal",
      "copy-path",
      "copy-relative-path",
    ]) {
      expect(items.find((item) => item.id === id)?.disabled).toBe(true);
    }
    for (const id of [
      "close-tab",
      "close-other-tabs",
      "close-tabs-right",
      "close-all-tabs",
    ]) {
      expect(items.find((item) => item.id === id)?.disabled).not.toBe(true);
    }
  });

  it("enables the multi-tab actions when they apply", () => {
    const items = buildContextMenu({
      target: "tab",
      platform: "macos",
      isMarkdown: true,
      inWorkspace: true,
      hasOtherTabs: true,
      hasTabsRight: true,
      canReopen: true,
    });
    expect(items.find((item) => item.id === "close-other-tabs")?.disabled).toBe(
      false,
    );
    expect(items.find((item) => item.id === "close-tabs-right")?.disabled).toBe(
      false,
    );
    expect(items.find((item) => item.id === "reopen-tab")?.disabled).toBe(false);
    expect(
      items.find((item) => item.id === "reopen-tab")?.accelerator,
    ).toBe("⇧⌘T");
  });

  it("takes every accelerator from the command registry", () => {
    const file = buildContextMenu({
      target: "file",
      platform: "macos",
      isMarkdown: true,
      inWorkspace: true,
    });
    const byId = (id: string) => file.find((item) => item.id === id)?.accelerator;
    expect(byId("new-file")).toBe(commandShortcut("app.new-file", "macos"));
    expect(byId("new-folder")).toBe(commandShortcut("file-tree.new-folder", "macos"));
    expect(byId("rename")).toBe(commandShortcut("file-tree.rename", "macos"));
    expect(byId("trash")).toBe(commandShortcut("file-tree.trash", "macos"));
    expect(byId("rename")).toBe("Enter");
    expect(byId("trash")).toBe("⌘⌫");

    const windows = buildContextMenu({
      target: "folder",
      platform: "windows",
      isMarkdown: false,
      inWorkspace: true,
    });
    const windowsById = (id: string) =>
      windows.find((item) => item.id === id)?.accelerator;
    expect(windowsById("new-folder")).toBe("Ctrl+Shift+N");
    expect(windowsById("rename")).toBe("F2");
    expect(windowsById("trash")).toBe("Delete");
  });

  it("limits the tab menu of a single file to path actions", () => {
    const items = buildContextMenu({
      target: "tab",
      platform: "windows",
      isMarkdown: true,
      inWorkspace: false,
      hasOtherTabs: false,
      hasTabsRight: false,
      canReopen: false,
    });
    expect(
      items.find((item) => item.id === "reveal-in-tree")?.disabled,
    ).toBe(true);
    expect(
      items.find((item) => item.id === "copy-relative-path")?.disabled,
    ).toBe(true);
    expect(items.find((item) => item.id === "reveal")?.label).toBe(
      "在资源管理器中显示",
    );
    expect(items.find((item) => item.id === "close-tab")?.accelerator).toBe(
      "Ctrl+W",
    );
  });
});
