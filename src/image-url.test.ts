import { describe, expect, it } from "vitest";

import { resolveImageUrl } from "./image-url";

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
