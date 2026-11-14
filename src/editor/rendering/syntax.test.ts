import { GFM, parser } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { mathMarkdown } from "./syntax";
import { renderMarkdownPreview } from "./preview";

describe("math syntax boundaries", () => {
  it.each([
    "$$\n未闭合\n\n# 标题\n\n[链接](https://example.com)\n",
    "$$\nx\n    $$\n\n# 标题\n\n正文\n",
  ])("leaves later Markdown intact when a valid closing delimiter is absent", async (source) => {
    const tree = parser.configure([GFM, mathMarkdown]).parse(source).toString();
    expect(tree).not.toContain("BlockMath");
    expect(tree).toContain("ATXHeading1");
    const preview = document.createElement("div");
    preview.innerHTML = await renderMarkdownPreview(source);
    expect(preview.querySelector("h1")?.textContent).toBe("标题");
    expect(preview.querySelector(".katex")).toBeNull();
  });

  it("accepts blank lines inside a closed formula and retains the following heading", () => {
    const source = "$$\nx\n\n+y\n  $$\n\n# 标题\n";
    const tree = parser.configure([GFM, mathMarkdown]).parse(source).toString();
    expect(tree).toContain("BlockMath(MathMark,MathText,MathMark)");
    expect(tree).toContain("ATXHeading1");
  });

  it.each([
    "> $$\n> x^2\n> $$\n\n# 标题",
    "- 项目\n\n  $$\n  x^2\n  $$\n\n# 标题",
    "> - $$\n>   x^2\n>   $$\n\n# 标题",
  ])("parses container math without including structural prefixes in its text", async (source) => {
    const parsed = parser.configure([GFM, mathMarkdown]).parse(source);
    const pieces: string[] = [];
    parsed.iterate({ enter(node) {
      if (node.name === "MathText") pieces.push(source.slice(node.from, node.to));
    } });
    expect(parsed.toString()).toContain("BlockMath");
    expect(parsed.toString()).toContain("ATXHeading1");
    expect(pieces.join("").trim()).toBe("x^2");
    const dom = document.createElement("div");
    dom.innerHTML = await renderMarkdownPreview(source);
    expect(dom.querySelector(".katex-display")).not.toBeNull();
    expect(dom.querySelector("h1")?.textContent).toBe("标题");
  });

  it.each([
    "> $$\n> 未闭合\n\n# 标题\n\n$$",
    "- $$\n  未闭合\n\n# 标题\n\n$$",
  ])("does not borrow a closing delimiter after its container ends", async (source) => {
    const parsed = parser.configure([GFM, mathMarkdown]).parse(source);
    expect(parsed.toString()).not.toContain("BlockMath");
    expect(parsed.toString()).toContain("ATXHeading1");
    const dom = document.createElement("div");
    dom.innerHTML = await renderMarkdownPreview(source);
    expect(dom.querySelector(".katex-display")).toBeNull();
    expect(dom.querySelector("h1")?.textContent).toBe("标题");
  });
});
