import { describe, expect, it } from "vitest";

import { commandRegistry } from "./registry";
import {
  filterCommands,
  loadPinyinMatcher,
  readRecentCommandIds,
  RECENT_COMMANDS_KEY,
  rememberRecentCommandId,
  type CommandStorage,
} from "./search";

function fakeStorage(initial: Record<string, string> = {}): CommandStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("command search", () => {
  it("matches full pinyin, initials, labels and aliases", async () => {
    const matcher = await loadPinyinMatcher();

    const full = filterCommands(commandRegistry, "biaoti", { matcher }).map(
      (command) => command.id,
    );
    expect(full).toEqual(
      expect.arrayContaining([
        "format.heading-1",
        "format.heading-2",
        "format.heading-3",
      ]),
    );

    const initials = filterCommands(commandRegistry, "bt", { matcher }).map(
      (command) => command.id,
    );
    expect(initials).toContain("format.heading-1");

    const alias = filterCommands(commandRegistry, "bold", { matcher }).map(
      (command) => command.id,
    );
    expect(alias).toContain("format.bold");

    const chinese = filterCommands(commandRegistry, "表格", { matcher }).map(
      (command) => command.id,
    );
    expect(chinese).toContain("insert.table");
  });

  it("keeps recently used commands in front while filtering", () => {
    const commands = commandRegistry.filter(
      (command) =>
        command.id === "format.bold" || command.id === "format.italic",
    );
    expect(
      filterCommands(commands, "", { recentIds: ["format.italic"] }).map(
        (command) => command.id,
      ),
    ).toEqual(["format.italic", "format.bold"]);

    expect(
      filterCommands(commands, "i", { recentIds: ["format.italic"] }).map(
        (command) => command.id,
      ),
    ).toEqual(["format.italic", "format.bold"]);
  });

  it("stores recent ids without breaking on bad storage", () => {
    const storage = fakeStorage();
    const first = rememberRecentCommandId("format.bold", storage);
    const second = rememberRecentCommandId("format.italic", storage);
    expect(first).toEqual(["format.bold"]);
    expect(second).toEqual(["format.italic", "format.bold"]);
    expect(readRecentCommandIds(storage)).toEqual(second);
    expect(
      readRecentCommandIds(
        fakeStorage({ [RECENT_COMMANDS_KEY]: "not json" }),
      ),
    ).toEqual([]);
  });
});
