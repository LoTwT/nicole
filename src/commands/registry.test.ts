import { describe, expect, it } from "vitest";

import {
  commandRegistry,
  commandShortcut,
  formatCommandShortcut,
  formatKeyBinding,
  getCommand,
  isCommandAvailable,
  resolveKeyBinding,
  slashCommands,
} from "./registry";

/** Rows of the ui.md shortcut table implemented by this registry. */
const TABLE_SHORTCUTS: readonly [
  id: string,
  macos: string,
  windows: string,
  linux: string,
][] = [
  ["app.open-folder", "⌘O", "Ctrl+O", "Ctrl+O"],
  ["app.new-file", "⌘N", "Ctrl+N", "Ctrl+N"],
  ["app.save", "⌘S", "Ctrl+S", "Ctrl+S"],
  ["app.settings", "⌘,", "Ctrl+,", "Ctrl+,"],
  ["nav.quick-open", "⌘P", "Ctrl+P", "Ctrl+P"],
  ["nav.search", "⇧⌘F", "Ctrl+Shift+F", "Ctrl+Shift+F"],
  ["nav.toggle-sidebar", "⌃⌘S", "Ctrl+Shift+E", "Ctrl+Shift+E"],
  ["nav.toggle-outline", "⌃⌘O", "Ctrl+Shift+L", "Ctrl+Shift+L"],
  ["file-tree.open", "⌘↓", "Enter", "Enter"],
  ["file-tree.rename", "Enter", "F2", "F2"],
  ["file-tree.trash", "⌘⌫", "Delete", "Delete"],
  ["file-tree.new-folder", "⇧⌘N", "Ctrl+Shift+N", "Ctrl+Shift+N"],
  ["tab.close", "⌘W", "Ctrl+W", "Ctrl+W"],
  ["tab.reopen", "⇧⌘T", "Ctrl+Shift+T", "Ctrl+Shift+T"],
  ["tab.next", "⌃Tab", "Ctrl+Tab", "Ctrl+Tab"],
  ["tab.previous", "⌃⇧Tab", "Ctrl+Shift+Tab", "Ctrl+Shift+Tab"],
  ["mode.live", "⌃⌘1", "Ctrl+Shift+1", "Ctrl+Shift+1"],
  ["mode.immersive", "⌃⌘2", "Ctrl+Shift+2", "Ctrl+Shift+2"],
  ["mode.source", "⌃⌘3", "Ctrl+Shift+3", "Ctrl+Shift+3"],
  ["format.bold", "⌘B", "Ctrl+B", "Ctrl+B"],
  ["format.italic", "⌘I", "Ctrl+I", "Ctrl+I"],
  ["format.strikethrough", "⇧⌘X", "Ctrl+Shift+X", "Ctrl+Shift+X"],
  ["format.inline-code", "⌘E", "Ctrl+E", "Ctrl+E"],
  ["format.heading-1", "⌘1", "Ctrl+1", "Ctrl+1"],
  ["format.heading-2", "⌘2", "Ctrl+2", "Ctrl+2"],
  ["format.heading-3", "⌘3", "Ctrl+3", "Ctrl+3"],
  ["format.bullet-list", "⇧⌘8", "Ctrl+Shift+8", "Ctrl+Shift+8"],
  ["format.ordered-list", "⇧⌘7", "Ctrl+Shift+7", "Ctrl+Shift+7"],
  ["format.task-list", "⇧⌘9", "Ctrl+Shift+9", "Ctrl+Shift+9"],
  ["format.quote", "⇧⌘.", "Ctrl+Shift+.", "Ctrl+Shift+."],
  ["format.code-block", "⇧⌘C", "Ctrl+Shift+C", "Ctrl+Shift+C"],
];

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

  it("matches every implemented ui.md shortcut row", () => {
    for (const [id, macos, windows, linux] of TABLE_SHORTCUTS) {
      const command = getCommand(id);
      expect(command, id).toBeDefined();
      expect(commandShortcut(id, "macos"), id).toBe(macos);
      expect(commandShortcut(id, "windows"), id).toBe(windows);
      expect(commandShortcut(id, "linux"), id).toBe(linux);
    }
  });

  it("registers unavailable placeholders without dispatching them", () => {
    for (const id of ["app.settings", "nav.quick-open", "nav.search", "nav.toggle-outline"]) {
      const command = getCommand(id);
      expect(command, id).toBeDefined();
      expect(isCommandAvailable(command!), id).toBe(false);
      expect(formatCommandShortcut(command!, "macos"), id).not.toBeNull();
    }
    expect(getCommand("app.toggle-theme")?.keys).toBeUndefined();
    expect(commandShortcut("missing.command", "macos")).toBe("");
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
