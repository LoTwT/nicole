import { describe, expect, it } from "vitest";

import type { SearchPart } from "../services/mygo";
import {
  addSearchLine,
  formatSearchSummary,
  locateSearchMatch,
  searchErrorText,
  searchLineFromPart,
  searchLineSegments,
  splitSearchPath,
} from "./workspace-search";

function linePart(
  path: string,
  line: number,
  text: string,
  matches: SearchPart["matches"],
): SearchPart {
  return { type: "line", path, line, text, matches };
}

const fooMatch = {
  start: 4,
  end: 7,
  text: "foo",
  length: 3,
  highlightStart: 4,
  highlightEnd: 7,
};

describe("workspace search results", () => {
  it("groups streamed lines by file and counts matches", () => {
    let groups = addSearchLine(
      [],
      linePart("notes/daily.md", 2, "needle one", [
        { ...fooMatch, start: 0, end: 6, text: "needle", length: 6, highlightStart: 0, highlightEnd: 6 },
      ]),
    );
    groups = addSearchLine(
      groups,
      linePart("notes/daily.md", 4, "needle two", [
        { ...fooMatch, start: 20, end: 26, text: "needle", length: 6, highlightStart: 0, highlightEnd: 6 },
      ]),
    );
    groups = addSearchLine(
      groups,
      linePart("README.md", 1, "needle", [
        { ...fooMatch, start: 0, end: 6, text: "needle", length: 6, highlightStart: 0, highlightEnd: 6 },
      ]),
    );

    expect(groups.map((group) => group.path)).toEqual([
      "notes/daily.md",
      "README.md",
    ]);
    expect(groups[0]!.name).toBe("daily.md");
    expect(groups[0]!.folder).toBe("notes");
    expect(groups[0]!.matchCount).toBe(2);
    expect(groups[0]!.lines.map((line) => line.line)).toEqual([2, 4]);
    expect(splitSearchPath("README.md")).toEqual({
      name: "README.md",
      folder: "",
    });
  });

  it("builds highlighted segments for multiple matches and empty matches", () => {
    const line = searchLineFromPart(
      linePart("a.md", 1, "foo foo", [
        { ...fooMatch, start: 0, end: 3, highlightStart: 0, highlightEnd: 3 },
        { ...fooMatch, start: 4, end: 7, highlightStart: 4, highlightEnd: 7 },
        { ...fooMatch, start: 7, end: 7, length: 0, text: "", highlightStart: 7, highlightEnd: 7 },
      ]),
    )!;
    expect(
      line.segments.map((segment) => [segment.text, segment.highlighted, segment.zeroWidth]),
    ).toEqual([
      ["foo", true, false],
      [" ", false, false],
      ["foo", true, false],
      ["", true, true],
    ]);
    expect(searchLineFromPart({ type: "done", fileCount: 1 })).toBeNull();
  });

  it("formats counts and maps known backend errors", () => {
    expect(formatSearchSummary(3, 5)).toBe("3 个文件中有 5 处结果");
    expect(
      searchErrorText(
        new Error(
          "workspace: invalid search pattern: error parsing regexp: missing closing ]",
        ),
      ),
    ).toBe(
      "正则表达式无效：error parsing regexp: missing closing ]",
    );
    expect(searchErrorText(new Error("workspace: no folder is open"))).toBe(
      "没有打开工作区",
    );
    expect(searchErrorText(new Error("workspace: folder changed"))).toBe(
      "工作区已切换，请重新搜索",
    );
    expect(searchErrorText(new Error("workspace: read failed"))).toBe(
      "搜索失败：read failed",
    );
  });
});

describe("locating a result in the editor", () => {
  it("uses UTF-16 offsets for Chinese and emoji", () => {
    const line = searchLineFromPart(
      linePart("a.md", 1, "中文😀foo", [fooMatch]),
    )!;
    expect(locateSearchMatch("中文😀foo\nnext", line, fooMatch)).toEqual({
      from: 4,
      to: 7,
    });
    expect(locateSearchMatch("中文😀foo\nnext", line, fooMatch)?.from).toBe(4);
    // The editor model stores normalized newlines; a CRLF file still matches
    // these offsets.
    expect(locateSearchMatch("中文😀foo\r\nnext", line, fooMatch)?.from).toBe(4);
  });

  it("relocates within the matching line when text moved", () => {
    const line = searchLineFromPart(
      linePart("a.md", 1, "中文😀foo", [fooMatch]),
    )!;
    const located = locateSearchMatch("X 中文😀foo\nnext", line, fooMatch);
    expect(located).toEqual({ from: 6, to: 9 });
    expect(
      locateSearchMatch("X 中文😀foo\nnext", line, fooMatch),
    ).not.toBeNull();
    expect(locateSearchMatch("X 没有\nnext", line, fooMatch)).toBeNull();
  });

  it("supports matches that continue across lines", () => {
    const match = {
      start: 0,
      end: 7,
      text: "foo\nbar",
      length: 7,
      highlightStart: 0,
      highlightEnd: 3,
    };
    const line = searchLineFromPart(
      linePart("a.md", 1, "foo", [match]),
    )!;
    expect(locateSearchMatch("foo\nbar", line, match)).toEqual({
      from: 0,
      to: 7,
    });
  });

  it("does not guess for a zero-width match after the line changed", () => {
    const match = {
      start: 1,
      end: 1,
      text: "",
      length: 0,
      highlightStart: 1,
      highlightEnd: 1,
    };
    const line = searchLineFromPart(
      linePart("a.md", 1, "abc", [match]),
    )!;
    expect(locateSearchMatch("abc", line, match)).toEqual({ from: 1, to: 1 });
    expect(locateSearchMatch("abcd", line, match)).toBeNull();
  });
});
