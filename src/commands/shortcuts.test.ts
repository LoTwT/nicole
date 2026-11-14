import { describe, expect, it } from "vitest";

import type { AppPlatform } from "../app/platform";
import { commandRegistry, formatKeyBinding } from "./registry";
import { historyShortcutRows, shortcutSections } from "./shortcuts";

const platforms: AppPlatform[] = ["macos", "windows", "linux"];

describe("settings shortcut sections", () => {
  it("lists every platform binding without dropping second bindings", () => {
    for (const platform of platforms) {
      const sections = shortcutSections(commandRegistry, platform);
      const rendered = sections.flatMap((section) => section.entries);
      for (const command of commandRegistry) {
        const keys = (command.keys ?? [])
          .map((binding) => formatKeyBinding(binding, platform))
          .filter((key): key is string => key !== null);
        if (keys.length === 0) {
          expect(
            rendered.some((entry) => entry.id === command.id),
            `${platform} ${command.id} without keys`,
          ).toBe(false);
          continue;
        }
        const entry = rendered.find((item) => item.id === command.id);
        expect(entry, `${platform} ${command.id}`).toBeDefined();
        expect(entry!.label).toBe(command.label);
        expect(entry!.keys).toEqual(keys);
      }
    }
    const mac = shortcutSections(commandRegistry, "macos");
    expect(
      mac.find((section) => section.id === "tab")!.entries.find(
        (entry) => entry.id === "tab.next",
      )!.keys,
    ).toEqual(["⌃Tab", "⇧⌘]"]);
  });

  it("groups the settings command and does not duplicate an entry", () => {
    const sections = shortcutSections(commandRegistry, "macos");
    const ids = sections.flatMap((section) =>
      section.entries.map((entry) => entry.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("app.settings");
    expect(sections.map((section) => section.label)).toEqual([
      "文件",
      "导航",
      "文件树",
      "标签页",
      "模式",
      "查找",
      "格式",
      "段落",
    ]);
  });

  it("derives undo and redo rows from the editor's actual history keymap", () => {
    expect(historyShortcutRows("macos")).toEqual([
      { id: "editor.undo", label: "撤销", keys: ["⌘Z"] },
      { id: "editor.redo", label: "重做", keys: ["⇧⌘Z"] },
    ]);
    expect(historyShortcutRows("windows")).toEqual([
      { id: "editor.undo", label: "撤销", keys: ["Ctrl+Z"] },
      { id: "editor.redo", label: "重做", keys: ["Ctrl+Y"] },
    ]);
    expect(historyShortcutRows("linux")).toEqual([
      { id: "editor.undo", label: "撤销", keys: ["Ctrl+Z"] },
      { id: "editor.redo", label: "重做", keys: ["Ctrl+Y", "Ctrl+Shift+Z"] },
    ]);
  });
});
