import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { extractHeadings, extractHeadingsWithStatus } from "./headings";

function state(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [markdown()] });
}

describe("extractHeadings", () => {
  it("reads ATX and Setext headings in document order", () => {
    const doc = [
      "# 标题",
      "",
      "## 二级 *重点*",
      "",
      "Setext 一级",
      "===========",
      "",
      "Setext 二级",
      "-----------",
      "",
      "###### 六级",
      "",
    ].join("\n");

    expect(extractHeadings(state(doc))).toEqual([
      { level: 1, text: "标题", position: 0, line: 1 },
      { level: 2, text: "二级 *重点*", position: 6, line: 3 },
      { level: 1, text: "Setext 一级", position: 18, line: 5 },
      { level: 2, text: "Setext 二级", position: 41, line: 8 },
      { level: 6, text: "六级", position: 64, line: 11 },
    ]);
  });

  it("ignores headings inside fenced code and trims ATX closing hashes", () => {
    const doc = ["## Real ##", "", "```md", "# Not a heading", "```"].join("\n");
    expect(extractHeadings(state(doc))).toEqual([
      { level: 2, text: "Real", position: 0, line: 1 },
    ]);
  });

  it("removes quote and list prefixes, including from Setext headings", () => {
    const doc = [
      "> # Quote ##",
      "",
      "- # Item",
      "",
      "# #",
      "",
      "> Setext",
      "> ------",
    ].join("\n");

    expect(extractHeadings(state(doc))).toEqual([
      { level: 1, text: "Quote", position: 0, line: 1 },
      {
        level: 1,
        text: "Item",
        position: doc.indexOf("- # Item"),
        line: 3,
      },
      { level: 1, text: "", position: doc.indexOf("# #"), line: 5 },
      {
        level: 2,
        text: "Setext",
        position: doc.indexOf("> Setext"),
        line: 7,
      },
    ]);
  });

  it("reports a complete extraction for a parsed document", () => {
    const result = extractHeadingsWithStatus(state("# Title\n"));
    expect(result.complete).toBe(true);
    expect(result.headings).toHaveLength(1);
  });
});
