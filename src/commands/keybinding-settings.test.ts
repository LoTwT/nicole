import { afterEach, expect, it } from "vitest";
import {
  commandBindings,
  setCommandKeybindings,
  validateKeybinding,
} from "./keybinding-settings";
import { commandRegistry, commandShortcut } from "./registry";
import { matchCommand } from "./keybinding";
import { historyShortcutRows } from "./shortcuts";
afterEach(() => setCommandKeybindings({}));
it("shares customized bindings between execution, labels, and history help", () => {
  setCommandKeybindings({
    "format.bold": "Mod-Alt-b",
    "edit.undo": "Mod-Alt-z",
  });
  expect(commandShortcut("format.bold", "macos")).toBe("⌥⌘B");
  expect(
    matchCommand(
      new KeyboardEvent("keydown", { key: "b", metaKey: true, altKey: true }),
      "macos",
      commandRegistry,
      "editor",
    )?.id,
  ).toBe("format.bold");
  expect(
    matchCommand(
      new KeyboardEvent("keydown", { key: "b", metaKey: true }),
      "macos",
      commandRegistry,
      "editor",
    ),
  ).toBeNull();
  expect(historyShortcutRows("macos")[0]?.keys).toEqual(["⌥⌘Z"]);
});
it("rejects collisions and system text operations while allowing scoped defaults", () => {
  expect(
    validateKeybinding("format.bold", "Mod-i", {}, commandRegistry, "macos"),
  ).toContain("冲突");
  expect(
    validateKeybinding("format.bold", "Mod-v", {}, commandRegistry, "macos"),
  ).toContain("保留");
  expect(
    validateKeybinding(
      "app.settings",
      "Mod-Alt-i",
      {},
      commandRegistry,
      "macos",
    ),
  ).toContain("保留");
  expect(
    validateKeybinding("format.bold", "b", {}, commandRegistry, "macos"),
  ).not.toBeNull();
  expect(
    validateKeybinding(
      "format.bold",
      "Mod-Alt-b",
      {},
      commandRegistry,
      "macos",
    ),
  ).toBeNull();
  const command = commandRegistry.find((item) => item.id === "format.bold")!;
  setCommandKeybindings({ "format.bold": "" });
  expect(commandBindings(command)).toEqual([]);
});
