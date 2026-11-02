import { describe, expect, it } from "vitest";

import {
  commandRegistry,
  formatCommandShortcut,
  formatKeyBinding,
  getCommand,
  resolveKeyBinding,
  slashCommands,
} from "./registry";

describe("command registry", () => {
  it("has one unique entry per command", () => {
    const ids = commandRegistry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getCommand("format.bold")?.label).toBe("加粗");
    expect(getCommand("format.bold")?.keys).toEqual([{ key: "Mod-b" }]);
  });

  it("separates slash commands from toolbar-only commands", () => {
    const ids = slashCommands().map((command) => command.id);
    expect(ids).toContain("format.heading-2");
    expect(ids).toContain("insert.table");
    expect(ids).not.toContain("format.bold");
    expect(ids).not.toContain("format.italic");
  });

  it("supports platform-specific and multiple key bindings", () => {
    const binding = {
      key: "Mod-Shift-x",
      mac: "Shift-Cmd-X",
      win: "Ctrl-Shift-X",
      linux: "Ctrl-Shift-X",
    };
    expect(resolveKeyBinding(binding, "macos")).toBe("Shift-Cmd-X");
    expect(resolveKeyBinding(binding, "windows")).toBe("Ctrl-Shift-X");
    expect(formatKeyBinding(binding, "macos")).toBe("⇧⌘X");
    expect(formatKeyBinding(binding, "windows")).toBe("Ctrl+Shift+X");
    expect(formatKeyBinding(binding, "linux")).toBe("Ctrl+Shift+X");
    expect(formatKeyBinding({ key: "Shift-Mod-8" }, "windows")).toBe(
      "Ctrl+Shift+8",
    );
    expect(formatKeyBinding({ key: "Shift-Mod-8" }, "linux")).toBe(
      "Ctrl+Shift+8",
    );

    const command = {
      ...getCommand("format.bold")!,
      keys: [{ key: "Mod-b" }, { mac: "Cmd-b", win: "Ctrl-b" }],
    };
    expect(formatCommandShortcut(command, "macos")).toBe("⌘B");
    expect(formatCommandShortcut(command, "windows")).toBe("Ctrl+B");
  });

  it("formats punctuation and navigation keys for both platforms", () => {
    expect(formatKeyBinding({ key: "Shift-Mod-." }, "macos")).toBe("⇧⌘.");
    expect(formatKeyBinding({ key: "Mod-," }, "windows")).toBe("Ctrl+,");
    expect(formatKeyBinding({ key: "Mod-ArrowDown" }, "macos")).toBe("⌘↓");
    expect(formatKeyBinding({ key: "Shift-Ctrl-Tab" }, "linux")).toBe(
      "Ctrl+Shift+Tab",
    );
  });
});
