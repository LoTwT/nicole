import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { extractHeadings } from "./headings";

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
});
