import { describe, expect, it, vi } from "vitest";

import {
  commandShortcut,
  createTabCommands,
  matchCommand,
  TAB_CLOSE_COMMAND,
  TAB_NEXT_COMMAND,
  TAB_PREVIOUS_COMMAND,
  TAB_REOPEN_COMMAND,
} from "./commands";

function key(
  key: string,
  modifiers: {
    meta?: boolean;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
  } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    altKey: modifiers.alt ?? false,
  });
}

function commands() {
  return createTabCommands({
    close: vi.fn(),
    reopen: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
  });
}

describe("tab commands", () => {
  it("defines the tab titles and bindings in one place", () => {
    const ids = commands().map((command) => command.id);
    expect(ids).toEqual([
      TAB_CLOSE_COMMAND,
      TAB_REOPEN_COMMAND,
      TAB_NEXT_COMMAND,
      TAB_PREVIOUS_COMMAND,
    ]);
    expect(commandShortcut(TAB_CLOSE_COMMAND, "macos")).toBe("⌘W");
    expect(commandShortcut(TAB_CLOSE_COMMAND, "windows")).toBe("Ctrl+W");
    expect(commandShortcut(TAB_REOPEN_COMMAND, "macos")).toBe("⇧⌘T");
    expect(commandShortcut(TAB_NEXT_COMMAND, "macos")).toBe("⌃Tab");
    expect(commandShortcut(TAB_PREVIOUS_COMMAND, "windows")).toBe(
      "Ctrl+Shift+Tab",
    );
  });

  it("matches platform bindings exactly", () => {
    const list = commands();
    expect(matchCommand(key("w", { meta: true }), "macos", list)?.id).toBe(
      TAB_CLOSE_COMMAND,
    );
    expect(matchCommand(key("w", { ctrl: true }), "macos", list)).toBeNull();
    expect(matchCommand(key("w", { ctrl: true }), "windows", list)?.id).toBe(
      TAB_CLOSE_COMMAND,
    );
    expect(
      matchCommand(key("w", { meta: true, shift: true }), "macos", list),
    ).toBeNull();
  });

  it("supports both next and previous tab bindings", () => {
    const list = commands();
    expect(matchCommand(key("Tab", { ctrl: true }), "macos", list)?.id).toBe(
      TAB_NEXT_COMMAND,
    );
    expect(
      matchCommand(key("]", { meta: true, shift: true }), "macos", list)?.id,
    ).toBe(TAB_NEXT_COMMAND);
    expect(
      matchCommand(key("Tab", { ctrl: true, shift: true }), "macos", list)?.id,
    ).toBe(TAB_PREVIOUS_COMMAND);
    expect(
      matchCommand(key("PageDown", { ctrl: true }), "windows", list)?.id,
    ).toBe(TAB_NEXT_COMMAND);
    expect(
      matchCommand(key("PageUp", { ctrl: true }), "linux", list)?.id,
    ).toBe(TAB_PREVIOUS_COMMAND);
  });

  it("runs the action named by the command", async () => {
    const actions = {
      close: vi.fn(),
      reopen: vi.fn(),
      next: vi.fn(),
      previous: vi.fn(),
    };
    const list = createTabCommands(actions);
    for (const command of list) {
      await command.run();
    }
    expect(actions.close).toHaveBeenCalledOnce();
    expect(actions.reopen).toHaveBeenCalledOnce();
    expect(actions.next).toHaveBeenCalledOnce();
    expect(actions.previous).toHaveBeenCalledOnce();
  });
});
