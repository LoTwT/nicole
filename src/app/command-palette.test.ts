import { describe, expect, it } from "vitest";

import { loadPinyinMatcher } from "../commands/search";
import {
  filterPaletteFiles,
  filterPaletteHeadings,
  initialPaletteInput,
  normalizeRecentFiles,
  parsePaletteInput,
  RECENT_FILES_LIMIT,
  rememberRecentFilePath,
} from "./command-palette";

describe("command palette modes", () => {
  it("switches modes from the leading prefix", () => {
    expect(parsePaletteInput(">加粗")).toEqual({
      mode: "command",
      query: "加粗",
    });
    expect(parsePaletteInput("@标题")).toEqual({
      mode: "heading",
      query: "标题",
    });
    expect(parsePaletteInput("文章/笔记.md")).toEqual({
      mode: "file",
      query: "文章/笔记.md",
    });
    expect(parsePaletteInput(">")).toEqual({ mode: "command", query: "" });
    expect(initialPaletteInput("command")).toBe(">");
    expect(initialPaletteInput("heading")).toBe("@");
    expect(initialPaletteInput("file")).toBe("");
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
    expect(
      rememberRecentFilePath(next, "new.md").at(-1),
    ).toBe(`note-${RECENT_FILES_LIMIT - 2}.md`);
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
