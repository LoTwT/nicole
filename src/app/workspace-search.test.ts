import { describe, expect, it } from "vitest";

import type { SearchMatch, SearchPart } from "../services/mygo";
import {
  addSearchLine,
  formatSearchSummary,
  locateSearchMatch,
  searchErrorText,
  searchFingerprint,
  searchLineFromPart,
  searchLineSegments,
  searchTargetStillCurrent,
  splitSearchPath,
} from "./workspace-search";

function match(
  column: number,
  text: string,
  highlightStart = column,
  endLine = 1,
  endLineText = text,
): SearchMatch {
  return {
    column,
    length: text.length,
    fingerprint: searchFingerprint(text),
    endLine,
    endLineFingerprint: searchFingerprint(endLineText),
    startsAtDocumentStart: false,
    startsAtLineStart: false,
    endsAtDocumentEnd: false,
    endsAtLineEnd: false,
    highlightStart,
    highlightEnd: highlightStart + text.length,
  };
}

function linePart(
  path: string,
  line: number,
  text: string,
  matches: SearchPart["matches"],
  fullLine = text,
): SearchPart {
  return {
    type: "line",
    path,
    line,
    text,
    lineFingerprint: searchFingerprint(fullLine),
    matches,
  };
}

describe("workspace search results", () => {
  it("uses the shared 128-bit fingerprint vectors", () => {
    expect(searchFingerprint("")).toBe("cbf29ce484222325cbf29ce484222325");
    expect(searchFingerprint("a")).toBe("089be207b544f1e408326707b4eb37da");
    expect(searchFingerprint("中文😀foo")).toBe(
      "5a605c943172cfd3bb1279579d8c64c7",
    );
    expect(searchFingerprint("foo\nbar")).toBe(
      "5b2c62f6f41bccb8e58535308d138ac6",
    );
  });

  it("groups streamed lines by file and counts matches", () => {
    let groups = addSearchLine(
      [],
      linePart("notes/daily.md", 2, "needle one", [match(0, "needle")]),
    );
    groups = addSearchLine(
      groups,
      linePart("notes/daily.md", 4, "needle two", [match(0, "needle")]),
    );
    groups = addSearchLine(
      groups,
      linePart("README.md", 1, "needle", [match(0, "needle")]),
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
        match(0, "foo", 0),
        match(4, "foo", 4),
        {
          column: 7,
          length: 0,
          fingerprint: searchFingerprint(""),
          endLine: 1,
          endLineFingerprint: searchFingerprint("foo foo"),
          startsAtDocumentStart: false,
          startsAtLineStart: false,
          endsAtDocumentEnd: false,
          endsAtLineEnd: false,
          highlightStart: 7,
          highlightEnd: 7,
        },
      ]),
    )!;
    expect(
      line.segments.map((segment) => [
        segment.text,
        segment.highlighted,
        segment.zeroWidth,
      ]),
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
    ).toBe("正则表达式无效：error parsing regexp: missing closing ]");
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
  it("uses line and UTF-16 column for Chinese and emoji", () => {
    const line = searchLineFromPart(
      linePart("a.md", 1, "中文😀foo", [match(4, "foo", 4, 1, "中文😀foo")]),
    )!;
    expect(locateSearchMatch("中文😀foo\nnext", line, line.matches[0]!)).toEqual(
      {
        from: 4,
        to: 7,
      },
    );
    // Earlier lines may change length without changing the target line or
    // its column.
    const secondLine = searchLineFromPart(
      linePart("a.md", 2, "中文😀foo", [match(4, "foo", 4, 2, "中文😀foo")]),
    )!;
    expect(
      locateSearchMatch("first\n中文😀foo\nnext", secondLine, secondLine.matches[0]!),
    ).toEqual({ from: 10, to: 13 });
    expect(
      locateSearchMatch(
        "a much longer first line\n中文😀foo\nnext",
        secondLine,
        secondLine.matches[0]!,
      ),
    ).toEqual({ from: 29, to: 32 });
  });

  it("keeps an unchanged target line when earlier lines change length", () => {
    const body = "first\nfoo here\n";
    const part = linePart("a.md", 2, "foo here", [match(0, "foo here", 0, 2)]);
    const line = searchLineFromPart(part)!;
    expect(locateSearchMatch(body, line, line.matches[0]!)).toEqual({
      from: 6,
      to: 14,
    });
    expect(
      locateSearchMatch("a much longer first line\nfoo here\n", line, line.matches[0]!),
    ).toEqual({ from: 25, to: 33 });
  });

  it("rejects a changed target line instead of jumping to a duplicate", () => {
    const original = "foo bar foo";
    const line = searchLineFromPart(
      linePart("a.md", 1, original, [match(8, "foo", 8, 1, original)]),
    )!;
    expect(locateSearchMatch(original, line, line.matches[0]!)).toEqual({
      from: 8,
      to: 11,
    });
    expect(
      locateSearchMatch("foo bar ", line, line.matches[0]!),
    ).toBeNull();
  });

  it("verifies the complete long match, not a bounded prefix", () => {
    const original = "a".repeat(200) + "Z";
    const line = searchLineFromPart(
      linePart(
        "a.md",
        1,
        original,
        [match(0, original)],
      ),
    )!;
    expect(locateSearchMatch(original, line, line.matches[0]!)).toEqual({
      from: 0,
      to: 201,
    });
    expect(
      locateSearchMatch("a".repeat(200) + "Y", line, line.matches[0]!),
    ).toBeNull();
    expect(
      locateSearchMatch("a".repeat(200) + "Z\nrest", line, line.matches[0]!),
    ).not.toBeNull();
  });

  it("supports matches that continue across lines and rejects changed tails", () => {
    const original = "foo\nbar";
    const crossLine: SearchMatch = {
      column: 0,
      length: 7,
      fingerprint: searchFingerprint(original),
      endLine: 2,
      endLineFingerprint: searchFingerprint("bar"),
      startsAtDocumentStart: true,
      startsAtLineStart: true,
      endsAtDocumentEnd: true,
      endsAtLineEnd: true,
      highlightStart: 0,
      highlightEnd: 3,
    };
    const line = searchLineFromPart(
      linePart("a.md", 1, "foo", [crossLine]),
    )!;
    expect(locateSearchMatch(original, line, crossLine)).toEqual({
      from: 0,
      to: 7,
    });
    expect(locateSearchMatch("foo\nbaz", line, crossLine)).toBeNull();
    expect(locateSearchMatch("foo\nbarx", line, crossLine)).toBeNull();
  });

  it("preserves document-end and line-end anchor semantics", () => {
    const anchored: SearchMatch = {
      column: 0,
      length: 3,
      fingerprint: searchFingerprint("foo"),
      endLine: 1,
      endLineFingerprint: searchFingerprint("foo"),
      startsAtDocumentStart: true,
      startsAtLineStart: true,
      endsAtDocumentEnd: true,
      endsAtLineEnd: true,
      highlightStart: 0,
      highlightEnd: 3,
    };
    const line = searchLineFromPart(
      linePart("a.md", 1, "foo", [anchored]),
    )!;
    expect(locateSearchMatch("foo", line, anchored)).toEqual({
      from: 0,
      to: 3,
    });
    expect(locateSearchMatch("foo\n", line, anchored)).toBeNull();
    expect(locateSearchMatch("foo\nrest", line, anchored)).toBeNull();
  });

  it("relocates a zero-width match after earlier line lengths change", () => {
    const original = "a\nabc";
    const line = searchLineFromPart(
      linePart("a.md", 2, "abc", [
        {
          column: 3,
          length: 0,
          fingerprint: searchFingerprint(""),
          endLine: 2,
          endLineFingerprint: searchFingerprint("abc"),
          startsAtDocumentStart: false,
          startsAtLineStart: false,
          endsAtDocumentEnd: true,
          endsAtLineEnd: true,
          highlightStart: 3,
          highlightEnd: 3,
        },
      ]),
    )!;
    expect(locateSearchMatch(original, line, line.matches[0]!)).toEqual({
      from: 5,
      to: 5,
    });
    expect(
      locateSearchMatch("prefix\nabc", line, line.matches[0]!),
    ).toEqual({ from: 10, to: 10 });
    expect(locateSearchMatch("prefix\nabcd", line, line.matches[0]!)).toBeNull();
  });

  it("rejects a zero-width result when the full line fingerprint changed", () => {
    const line = searchLineFromPart(
      linePart("a.md", 1, "abc", [
        {
          column: 3,
          length: 0,
          fingerprint: searchFingerprint(""),
          endLine: 1,
          endLineFingerprint: searchFingerprint("abc"),
          startsAtDocumentStart: false,
          startsAtLineStart: false,
          endsAtDocumentEnd: true,
          endsAtLineEnd: true,
          highlightStart: 3,
          highlightEnd: 3,
        },
      ]),
    )!;
    expect(locateSearchMatch("abc", line, line.matches[0]!)).not.toBeNull();
    expect(locateSearchMatch("abcd", line, line.matches[0]!)).toBeNull();
  });
});

describe("search target identity", () => {
  it("requires the same root, generation, tab, text, view and document", () => {
    const view = {};
    const doc = {};
    const snapshot = {
      root: "/notes",
      generation: 1,
      tabId: 2,
      text: "content",
      view,
      doc,
    };
    expect(searchTargetStillCurrent(snapshot, { ...snapshot })).toBe(true);
    expect(
      searchTargetStillCurrent(snapshot, {
        ...snapshot,
        generation: 2,
      }),
    ).toBe(false);
    expect(
      searchTargetStillCurrent(snapshot, {
        ...snapshot,
        tabId: 3,
      }),
    ).toBe(false);
    expect(
      searchTargetStillCurrent(snapshot, {
        ...snapshot,
        text: "changed",
      }),
    ).toBe(false);
    expect(
      searchTargetStillCurrent(snapshot, {
        ...snapshot,
        view: {},
      }),
    ).toBe(false);
    expect(
      searchTargetStillCurrent(snapshot, {
        ...snapshot,
        doc: {},
      }),
    ).toBe(false);
    expect(searchTargetStillCurrent(snapshot, null)).toBe(false);
  });
});
