import { describe, expect, it } from "vitest";

import {
  CODE_FONT_FALLBACK,
  customFontStack,
  fileDisplayName,
  READING_FONT_FALLBACK,
  UI_FONT_FALLBACK,
  visibleTreeEntry,
} from "./settings-display";

describe("settings display helpers", () => {
  it("builds a quoted installed-font family with the existing fallback", () => {
    expect(customFontStack("", UI_FONT_FALLBACK)).toBeNull();
    expect(customFontStack("   ", UI_FONT_FALLBACK)).toBeNull();
    expect(customFontStack("Songti SC", READING_FONT_FALLBACK)).toBe(
      `"Songti SC", ${READING_FONT_FALLBACK}`,
    );
    expect(customFontStack('Bad";{}name', CODE_FONT_FALLBACK)).toBe(
      `"Badname", ${CODE_FONT_FALLBACK}`,
    );
  });

  it("trims labels but never folders or the real name", () => {
    expect(
      fileDisplayName({ name: "notes.md", isDir: false }, true),
    ).toBe("notes");
    expect(
      fileDisplayName({ name: "NOTES.MD", isDir: false }, true),
    ).toBe("NOTES");
    expect(fileDisplayName({ name: "notes.md", isDir: false }, false)).toBe(
      "notes.md",
    );
    expect(fileDisplayName({ name: "notes.md", isDir: true }, true)).toBe(
      "notes.md",
    );
    expect(fileDisplayName({ name: "cover.png", isDir: false }, true)).toBe(
      "cover.png",
    );
  });

  it("keeps directories and always hides only non-Markdown files", () => {
    const file = (name: string, isDir: boolean, isMarkdown: boolean) => ({
      name,
      path: name,
      isDir,
      isMarkdown,
      size: 0,
    });
    expect(visibleTreeEntry(file("notes", true, false), false)).toBe(true);
    expect(visibleTreeEntry(file("a.md", false, true), false)).toBe(true);
    expect(visibleTreeEntry(file("cover.png", false, false), false)).toBe(false);
    expect(visibleTreeEntry(file("cover.png", false, false), true)).toBe(true);
  });
});
