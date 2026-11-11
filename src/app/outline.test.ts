import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { extractHeadings } from "../editor/headings";
import {
  activeOutlineHeadingIndex,
  OUTLINE_FIXED_MIN_WIDTH,
  outlineHeadings,
  outlinePlacement,
} from "./outline";

function headings(doc: string) {
  return extractHeadings(
    EditorState.create({ doc, extensions: [markdown()] }),
  );
}

describe("outlineHeadings", () => {
  it("drops frontmatter and the single leading H1 article title", () => {
    const doc = [
      "---",
      "title: 文章",
      "tags:",
      "  - 随笔",
      "---",
      "",
      "# 文章标题",
      "",
      "## 第一节",
      "",
      "### 细节",
      "",
      "```md",
      "# 代码块里的标题",
      "```",
      "",
      "#### 不显示",
      "",
    ].join("\n");

    const result = outlineHeadings(doc, headings(doc));

    expect(result.map((heading) => [heading.level, heading.text])).toEqual([
      [2, "第一节"],
      [3, "细节"],
    ]);
    expect(result[0]!.position).toBe(doc.indexOf("## 第一节"));
    expect(result[1]!.position).toBe(doc.indexOf("### 细节"));
  });

  it("drops the article title when it is a Setext heading", () => {
    const doc = ["文章标题", "========", "", "## 小节", ""].join("\n");
    expect(outlineHeadings(doc, headings(doc)).map((item) => item.text)).toEqual([
      "小节",
    ]);
  });

  it("keeps the only H1 when it is not the first non-empty body line", () => {
    const doc = ["前言", "", "# 标题", "", "## 小节", ""].join("\n");
    expect(outlineHeadings(doc, headings(doc)).map((item) => item.text)).toEqual([
      "标题",
      "小节",
    ]);
  });

  it("keeps every H1 when the document has more than one", () => {
    const doc = ["# 第一章", "", "# 第二章", "", "## 小节", ""].join("\n");
    expect(outlineHeadings(doc, headings(doc)).map((item) => item.text)).toEqual([
      "第一章",
      "第二章",
      "小节",
    ]);
  });

  it("keeps a leading H1 when the opening fence is not frontmatter", () => {
    const doc = ["---", "", "# 标题", "", "## 小节", ""].join("\n");
    expect(outlineHeadings(doc, headings(doc)).map((item) => item.text)).toEqual([
      "标题",
      "小节",
    ]);
  });

  it("keeps an empty heading for the component to label", () => {
    const doc = ["# 文章", "", "## #", ""].join("\n");
    expect(outlineHeadings(doc, headings(doc))).toEqual([
      { level: 2, text: "", position: doc.indexOf("## #"), line: 3 },
    ]);
  });
});

describe("activeOutlineHeadingIndex", () => {
  const items = [
    { level: 1 as const, text: "一", position: 0, line: 2 },
    { level: 2 as const, text: "二", position: 10, line: 5 },
    { level: 2 as const, text: "二", position: 20, line: 9 },
  ];

  it("selects the last heading at or above the visible top line", () => {
    expect(activeOutlineHeadingIndex(items, 1)).toBeNull();
    expect(activeOutlineHeadingIndex(items, 2)).toBe(0);
    expect(activeOutlineHeadingIndex(items, 7)).toBe(1);
    expect(activeOutlineHeadingIndex(items, 200)).toBe(2);
  });
});

describe("outlinePlacement", () => {
  it("switches exactly at the content-width threshold", () => {
    expect(outlinePlacement(OUTLINE_FIXED_MIN_WIDTH - 1)).toBe("floating");
    expect(outlinePlacement(OUTLINE_FIXED_MIN_WIDTH)).toBe("fixed");
    expect(outlinePlacement(OUTLINE_FIXED_MIN_WIDTH + 1)).toBe("fixed");
  });
});
