import { describe, expect, it, vi } from "vitest";

import type { AppPlatform } from "../app/platform";
import { matchCommand, matchesKeyBinding } from "./keybinding";
import { commandRegistry, getCommand } from "./registry";
import type { CommandDefinition } from "./types";

interface KeyOptions {
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  code?: string;
}

function key(key: string, options: KeyOptions = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    code: options.code ?? "",
    metaKey: options.meta ?? false,
    ctrlKey: options.ctrl ?? false,
    altKey: options.alt ?? false,
    shiftKey: options.shift ?? false,
  });
}

function binding(id: string, platform: AppPlatform) {
  const command = getCommand(id);
  if (!command?.keys?.[0]) throw new Error(`missing binding ${id}`);
  return command.keys[0]!;
}

function idFor(event: KeyboardEvent, platform: AppPlatform = "macos") {
  return matchCommand(event, platform, commandRegistry, "app")?.id ?? null;
}

describe("keyboard matcher", () => {
  it("matches the platform modifier exactly", () => {
    expect(idFor(key("w", { meta: true }), "macos")).toBe("tab.close");
    expect(idFor(key("w", { ctrl: true }), "macos")).toBeNull();
    expect(idFor(key("w", { ctrl: true }), "windows")).toBe("tab.close");
    expect(idFor(key("w", { meta: true }), "windows")).toBeNull();
    expect(idFor(key("w", { meta: true, shift: true }), "macos")).toBeNull();
  });

  it("matches shift-bracket shortcuts from the physical key", () => {
    expect(idFor(key("}", { meta: true, shift: true, code: "BracketRight" }))).toBe(
      "tab.next",
    );
    expect(idFor(key("{", { meta: true, shift: true, code: "BracketLeft" }))).toBe(
      "tab.previous",
    );
    // Non-US layouts report a different character for the same physical key.
    expect(idFor(key("+", { meta: true, shift: true, code: "BracketRight" }))).toBe(
      "tab.next",
    );
    expect(
      matchesKeyBinding(
        key("}", { meta: true, shift: true }),
        binding("tab.next", "macos"),
        "macos",
      ),
    ).toBe(false);
  });

  it("matches page and tab keys on Windows and Linux", () => {
    expect(idFor(key("Tab", { ctrl: true }), "windows")).toBe("tab.next");
    expect(idFor(key("Tab", { ctrl: true, shift: true }), "linux")).toBe(
      "tab.previous",
    );
    expect(idFor(key("PageDown", { ctrl: true }), "windows")).toBe("tab.next");
    expect(idFor(key("PageUp", { ctrl: true }), "linux")).toBe("tab.previous");
    expect(idFor(key("Tab", { ctrl: true }), "macos")).toBe("tab.next");
  });

  it("does not treat Ctrl+Alt as a Ctrl shortcut on Windows", () => {
    expect(
      idFor(key("e", { ctrl: true, alt: true }), "windows"),
    ).toBeNull();
    expect(idFor(key("e", { ctrl: true, shift: true }), "windows")).toBe(
      "nav.toggle-sidebar",
    );
  });

  it("matches modes, file commands and file-tree keys", () => {
    expect(idFor(key("1", { ctrl: true, meta: true }), "macos")).toBe("mode.live");
    expect(idFor(key("3", { ctrl: true, shift: true }), "windows")).toBe(
      "mode.source",
    );
    expect(idFor(key("o", { meta: true }), "macos")).toBe("app.open-folder");
    expect(idFor(key("n", { meta: true }), "macos")).toBe("app.new-file");
    expect(idFor(key("s", { meta: true }), "macos")).toBe("app.save");

    const tree = (event: KeyboardEvent, platform: AppPlatform) =>
      matchCommand(event, platform, commandRegistry, "file-tree")?.id ?? null;
    expect(tree(key("ArrowDown", { meta: true }), "macos")).toBe("file-tree.open");
    expect(tree(key("Enter"), "windows")).toBe("file-tree.open");
    expect(tree(key("Enter"), "macos")).toBe("file-tree.rename");
    expect(tree(key("F2"), "linux")).toBe("file-tree.rename");
    expect(tree(key("Backspace", { meta: true }), "macos")).toBe(
      "file-tree.trash",
    );
    expect(tree(key("Delete"), "windows")).toBe("file-tree.trash");
    expect(tree(key("n", { meta: true, shift: true }), "macos")).toBe(
      "file-tree.new-folder",
    );
  });

  it("keeps scopes separate", () => {
    expect(
      matchCommand(key("b", { meta: true }), "macos", commandRegistry, "app"),
    ).toBeNull();
    expect(
      matchCommand(key("Enter"), "macos", commandRegistry, "app"),
    ).toBeNull();
  });

  it("skips unavailable commands while still registering their keys", () => {
    expect(getCommand("nav.search")?.available).toBe(false);
    expect(idFor(key("f", { meta: true, shift: true }), "macos")).toBeNull();
    expect(idFor(key("o", { meta: true, ctrl: true }), "macos")).toBeNull();
    expect(idFor(key(",", { meta: true }), "macos")).toBeNull();

    const placeholder: CommandDefinition = {
      id: "test.placeholder",
      label: "占位",
      group: "app",
      scope: "app",
      keys: [{ key: "Mod-u" }],
      available: false,
      run: vi.fn(() => true),
    };
    const available: CommandDefinition = {
      ...placeholder,
      id: "test.available",
      available: true,
      run: vi.fn(() => true),
    };
    expect(
      matchCommand(
        key("u", { meta: true }),
        "macos",
        [placeholder, available],
        "app",
      )?.id,
    ).toBe("test.available");
    expect(
      matchCommand(key("u", { meta: true }), "macos", [placeholder], "app"),
    ).toBeNull();
  });
});
