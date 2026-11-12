import { describe, expect, it } from "vitest";

import {
  formatImageDestination,
  parseMarkdownDestination,
  resolveImageUrl,
  resolveLocalImagePath,
} from "./image-url";

const DOC = "notes/chapter/one.md";
const GENERATION = 4;

describe("resolveImageUrl", () => {
  it("resolves a path next to the document", () => {
    expect(resolveImageUrl("photo.png", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/chapter/photo.png",
    );
  });

  it("resolves parent segments against the document folder", () => {
    expect(resolveImageUrl("../assets/photo.jpg", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/assets/photo.jpg",
    );
    expect(resolveImageUrl("./photo.gif", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/chapter/photo.gif",
    );
    expect(resolveImageUrl("../../photo.gif", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/photo.gif",
    );
  });

  it("treats a leading slash as the workspace root", () => {
    expect(resolveImageUrl("/assets/photo.webp", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/assets/photo.webp",
    );
  });

  it("escapes spaces and non-ASCII names", () => {
    expect(resolveImageUrl("图片 1.png", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/chapter/%E5%9B%BE%E7%89%87%201.png",
    );
    expect(resolveImageUrl("my%20photo.png", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/chapter/my%20photo.png",
    );
  });

  it("reads angle-wrapped destinations as URL/path values", () => {
    expect(resolveImageUrl("<photo.png>", DOC, GENERATION)).toBe(
      "nicole-image://localhost/4/notes/chapter/photo.png",
    );
    expect(
      resolveImageUrl("<https://example.com/a%20b.png>", DOC, GENERATION),
    ).toBe("https://example.com/a%20b.png");
    expect(resolveLocalImagePath("<assets/photo.png>", DOC)).toBe(
      "notes/chapter/assets/photo.png",
    );
  });

  it("keeps http, https and image data URLs unchanged", () => {
    for (const src of [
      "https://example.com/a.png",
      "HTTP://example.com/a.png",
      "data:image/png;base64,AAAA",
      "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
    ]) {
      expect(resolveImageUrl(src, DOC, GENERATION)).toBe(src);
    }
  });

  it("keeps absolute URLs without a document", () => {
    expect(resolveImageUrl("https://example.com/a.png", null, 0)).toBe(
      "https://example.com/a.png",
    );
  });

  it("rejects URLs that cannot be shown", () => {
    for (const src of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "//example.com/a.png",
      "C:/Windows/a.png",
      "notes\\a.png",
      "photo.txt",
      "",
      "   ",
    ]) {
      expect(resolveImageUrl(src, DOC, GENERATION)).toBeNull();
    }
  });

  it("rejects paths outside the workspace or in ignored folders", () => {
    for (const src of [
      "../../../photo.png",
      "%2e%2e/%2e%2e/%2e%2e/photo.png",
      ".hidden/photo.png",
      "node_modules/pkg/photo.png",
      "photo.png?raw=1",
      "photo.png#fragment",
      "notes//photo.png",
    ]) {
      expect(resolveImageUrl(src, DOC, GENERATION)).toBeNull();
    }
  });

  it("rejects relative paths without a document or generation", () => {
    expect(resolveImageUrl("photo.png", null, GENERATION)).toBeNull();
    expect(resolveImageUrl("photo.png", DOC, 0)).toBeNull();
  });
});

describe("resolveLocalImagePath", () => {
  it("returns the workspace path for local images", () => {
    expect(resolveLocalImagePath("photo.png", DOC)).toBe(
      "notes/chapter/photo.png",
    );
    expect(resolveLocalImagePath("../assets/图片 1.png", DOC)).toBe(
      "notes/assets/图片 1.png",
    );
    expect(resolveLocalImagePath("/assets/photo.JPG", DOC)).toBe(
      "assets/photo.JPG",
    );
  });

  it("does not enable reveal for remote, data or unresolved paths", () => {
    for (const src of [
      "https://example.com/a.png",
      "data:image/png;base64,AAAA",
      "photo.txt",
      "../../../photo.png",
      ".hidden/photo.png",
      "node_modules/pkg/photo.png",
      "photo.png?raw=1",
      "",
    ]) {
      expect(resolveLocalImagePath(src, DOC)).toBeNull();
    }
    expect(resolveLocalImagePath("photo.png", null)).toBeNull();
    expect(resolveLocalImagePath("photo.png", "")).toBeNull();
  });
});

describe("formatImageDestination", () => {
  it("parses Markdown angle wrappers without treating encoded brackets as syntax", () => {
    expect(parseMarkdownDestination(" <assets/a.png> ")).toBe("assets/a.png");
    expect(parseMarkdownDestination("<https://example.com/a.png>")).toBe(
      "https://example.com/a.png",
    );
    expect(parseMarkdownDestination("assets/%3Cpic%3E.png")).toBe(
      "assets/%3Cpic%3E.png",
    );
    expect(parseMarkdownDestination("<assets/%3Cpic%3E.png>")).toBe(
      "assets/%3Cpic%3E.png",
    );
    expect(parseMarkdownDestination("assets/<pic>.png")).toBe(
      "assets/<pic>.png",
    );
  });

  it("serializes the address inside an angle wrapper, not the wrapper", () => {
    expect(formatImageDestination("<assets/图 1.png>")).toBe(
      "assets/%E5%9B%BE%201.png",
    );
    expect(formatImageDestination("<https://example.com/a.png>")).toBe(
      "https://example.com/a.png",
    );
    expect(formatImageDestination("assets/%3Cpic%3E.png")).toBe(
      "assets/%3Cpic%3E.png",
    );
  });

  it("escapes spaces and Unicode one segment at a time", () => {
    expect(formatImageDestination("assets/图 1.png")).toBe(
      "assets/%E5%9B%BE%201.png",
    );
    expect(formatImageDestination("/图/片 1.png")).toBe(
      "/%E5%9B%BE/%E7%89%87%201.png",
    );
    expect(formatImageDestination("assets/a(1)!*.png")).toBe(
      "assets/a%281%29%21%2A.png",
    );
  });

  it("does not double-encode an already escaped path", () => {
    expect(formatImageDestination("assets/%E5%9B%BE%201.png")).toBe(
      "assets/%E5%9B%BE%201.png",
    );
    expect(formatImageDestination("assets/my%20photo.png")).toBe(
      "assets/my%20photo.png",
    );
  });

  it("keeps remote, data and query/fragment suffixes intact", () => {
    expect(formatImageDestination("https://example.com/图 1.png?x=1#top")).toBe(
      "https://example.com/图 1.png?x=1#top",
    );
    expect(formatImageDestination("data:image/svg+xml,%3Csvg%3E")).toBe(
      "data:image/svg+xml,%3Csvg%3E",
    );
    expect(formatImageDestination("assets/图 1.png?raw=1")).toBe(
      "assets/%E5%9B%BE%201.png?raw=1",
    );
  });

  it("round-trips the serialized destination through the local resolver", () => {
    const encoded = formatImageDestination("assets/图 1.png");
    expect(resolveLocalImagePath(encoded, "notes/a.md")).toBe(
      "notes/assets/图 1.png",
    );
  });
});
