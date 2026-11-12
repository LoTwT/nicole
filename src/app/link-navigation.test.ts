import { describe, expect, it } from "vitest";

import type { DocumentHeading } from "../editor/headings";
import {
  classifyLinkDestination,
  decodeLinkDestination,
  findHeadingByFragment,
  headingAnchorIds,
  visibleHeadingText,
} from "./link-navigation";

const workspace = {
  kind: "workspace" as const,
  path: "notes/current.md",
  root: "/notes",
};

function heading(
  level: DocumentHeading["level"],
  text: string,
  position: number,
  line: number,
): DocumentHeading {
  return { level, text, position, line };
}

describe("decodeLinkDestination", () => {
  it("interprets one Markdown escape and entity pass without double decoding", () => {
    expect(decodeLinkDestination(String.raw`a\(b\).md`)).toBe("a(b).md");
    expect(decodeLinkDestination("a&amp;b.md")).toBe("a&b.md");
    expect(decodeLinkDestination(String.raw`\&amp;`)).toBe("&amp;");
    expect(decodeLinkDestination("&#65;&#x42;&bogus;&no-semicolon")).toBe(
      "AB&bogus;&no-semicolon",
    );
    expect(
      decodeLinkDestination("https://example.com/?a=1&amp;b=2"),
    ).toBe("https://example.com/?a=1&b=2");
  });
});

describe("classifyLinkDestination", () => {
  it("classifies HTTP(S), current fragments and workspace Markdown", () => {
    expect(
      classifyLinkDestination("https://example.com/a?x=1&amp;y=2", workspace),
    ).toEqual({ kind: "external", url: "https://example.com/a?x=1&y=2" });
    expect(classifyLinkDestination("#标题", workspace)).toEqual({
      kind: "fragment",
      fragment: "标题",
    });
    expect(classifyLinkDestination("#", workspace)).toEqual({
      kind: "fragment",
      fragment: "",
    });
    expect(
      classifyLinkDestination("../assets/a%20b.md#%E6%A0%87%E9%A2%98", workspace),
    ).toEqual({
      kind: "workspace",
      path: "assets/a b.md",
      fragment: "标题",
    });
    expect(classifyLinkDestination("/a/./b.md", workspace)).toEqual({
      kind: "workspace",
      path: "a/b.md",
      fragment: null,
    });
  });

  it("rejects other schemes, malformed HTTP, escaping paths and single-file relatives", () => {
    for (const address of [
      "javascript:alert(1)",
      String.raw`\j\a\v\a\s\c\r\i\p\t:alert(1)`,
      "java&#x73;cript:alert(1)",
      "file:///tmp/a.md",
      "mailto:user@example.com",
      "https://",
      "//example.com/a.md",
      "a%2Fb.md",
      "a%5Cb.md",
      "a%00b.md",
      "a:b.md",
      "a?query.md",
      "../../outside.md",
      "a.txt",
      "a%ZZ.md",
    ]) {
      expect(classifyLinkDestination(address, workspace).kind).toBe(
        "unsupported",
      );
    }
    expect(
      classifyLinkDestination("a.md", {
        kind: "single",
        path: "/tmp/a.md",
        root: null,
      }),
    ).toEqual({
      kind: "unsupported",
      message: "单文件标签页只支持当前文档锚点和 HTTP(S) 链接",
    });
    expect(
      classifyLinkDestination("#当前", {
        kind: "single",
        path: "/tmp/a.md",
        root: null,
      }),
    ).toEqual({ kind: "fragment", fragment: "当前" });
    expect(classifyLinkDestination("", workspace)).toEqual({ kind: "empty" });
  });
});

describe("heading anchors", () => {
  const headings = [
    heading(1, "Hello **World**", 0, 1),
    heading(2, "Hello *World*", 10, 3),
    heading(3, "中文 标题", 20, 5),
    heading(4, "[链接](https://example.com/url) `code`", 30, 7),
  ];

  it("uses visible GitHub-style text, duplicate suffixes and aliases", () => {
    expect(visibleHeadingText("**重点** [链接](url) `code`")).toBe(
      "重点 链接 code",
    );
    expect(visibleHeadingText("A &amp; B")).toBe("A & B");
    expect(headingAnchorIds(headings)).toEqual([
      "hello-world",
      "hello-world-1",
      "中文-标题",
      "链接-code",
    ]);
    expect(findHeadingByFragment(headings, "hello-world-1")?.line).toBe(3);
    expect(findHeadingByFragment(headings, "中文 标题")?.line).toBe(5);
    expect(findHeadingByFragment(headings, "不存在")).toBeNull();
  });

  it("avoids collisions between generated ids and heading text", () => {
    const collided = [
      heading(1, "A", 0, 1),
      heading(2, "A-1", 2, 3),
      heading(3, "A", 5, 5),
    ];
    expect(headingAnchorIds(collided)).toEqual(["a", "a-1", "a-2"]);
  });
});
