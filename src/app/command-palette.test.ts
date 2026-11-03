import { describe, expect, it } from "vitest";

import { loadPinyinMatcher } from "../commands/search";
import {
  filterPaletteFiles,
  filterPaletteHeadings,
  normalizeRecentFiles,
  paletteModePrefix,
  RECENT_FILES_LIMIT,
  rememberRecentFilePath,
} from "./command-palette";

describe("command palette modes", () => {
  it("has a visible marker only outside file mode", () => {
    expect(paletteModePrefix("command")).toBe(">");
    expect(paletteModePrefix("heading")).toBe("@");
    expect(paletteModePrefix("file")).toBeNull();
  });
});

describe("command palette files", () => {
  it("puts recent files first without a query and sorts the rest by path", () => {
    const files = ["b.md", "dir/a.md", "c.md", "a.md"];
    expect(
      filterPaletteFiles(files, "", { recentFiles: ["c.md", "a.md"] }),
    ).toEqual(["c.md", "a.md", "b.md", "dir/a.md"]);
  });

  it("ranks matches before recency when a query is present", async () => {
    const matcher = await loadPinyinMatcher();
    const files = ["notes/加粗.md", "jia.md", "other/加粗指南.md"];
    expect(
      filterPaletteFiles(files, "jiacu", {
        matcher,
        recentFiles: ["jia.md"],
      }),
    ).toEqual(["notes/加粗.md", "other/加粗指南.md"]);
  });

  it("keeps recent files unique and within the limit", () => {
    const recent = Array.from(
      { length: RECENT_FILES_LIMIT },
      (_value, index) => `note-${index}.md`,
    );
    const next = rememberRecentFilePath(recent, "note-5.md");
    expect(next).toHaveLength(RECENT_FILES_LIMIT);
    expect(next[0]).toBe("note-5.md");
    expect(next.filter((path) => path === "note-5.md")).toHaveLength(1);
    const appended = rememberRecentFilePath(next, "new.md");
    expect(appended).toHaveLength(RECENT_FILES_LIMIT);
    expect(appended.at(-1)).toBe(`note-${RECENT_FILES_LIMIT - 2}.md`);
  });

  it("drops invalid and duplicate stored paths", () => {
    expect(
      normalizeRecentFiles([
        "a.md",
        "a.md",
        "../outside.md",
        "/absolute.md",
        "dir\\file.md",
        "dir/./file.md",
        "b.md",
      ]),
    ).toEqual(["a.md", "b.md"]);
  });
});

describe("command palette headings", () => {
  const headings = [
    { level: 1 as const, text: "开头", position: 0, line: 1 },
    { level: 2 as const, text: "加粗说明", position: 10, line: 3 },
    { level: 3 as const, text: "结尾", position: 30, line: 8 },
  ];

  it("matches heading text with pinyin and preserves document order on ties", async () => {
    const matcher = await loadPinyinMatcher();
    expect(
      filterPaletteHeadings(headings, "jiacu", matcher).map(
        (heading) => heading.text,
      ),
    ).toEqual(["加粗说明"]);
    expect(filterPaletteHeadings(headings, "")).toEqual(headings);
  });
});
