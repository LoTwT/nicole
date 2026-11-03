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

  it("gives the root group only file, folder and reveal actions", () => {
    expect(
      ids(
        buildContextMenu({
          target: "root",
          platform: "macos",
          isMarkdown: false,
          inWorkspace: true,
        }),
      ),
    ).toEqual(["new-file", "new-folder", "reveal", "copy-path"]);
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
