import { describe, expect, it } from "vitest";

import { appPlatform, buildContextMenu, revealLabel, trashLabel } from "./platform";

const ids = (items: ReturnType<typeof buildContextMenu>) =>
  items.filter((item) => !item.separator).map((item) => item.id);

describe("platform menus", () => {
  it("uses the platform wording", () => {
    expect(appPlatform("darwin")).toBe("macos");
    expect(revealLabel("windows")).toBe("在资源管理器中显示");
    expect(revealLabel("linux")).toBe("在文件管理器中显示");
    expect(trashLabel("macos")).toBe("移到废纸篓");
    expect(trashLabel("windows")).toBe("移到回收站");
  });

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
