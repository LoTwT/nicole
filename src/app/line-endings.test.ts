import { describe, expect, it } from "vitest";

import {
  detectLineEndings,
  normalizeLineEndings,
  withLineEnding,
} from "./line-endings";

describe("line endings", () => {
  it("detects one style", () => {
    expect(detectLineEndings("a\nb\n")).toEqual({ ending: "\n", mixed: false });
    expect(detectLineEndings("a\r\nb\r\n")).toEqual({
      ending: "\r\n",
      mixed: false,
    });
    expect(detectLineEndings("a\rb\r")).toEqual({ ending: "\r", mixed: false });
  });

  it("marks mixed files", () => {
    expect(detectLineEndings("a\r\nb\n")).toEqual({
      ending: "\r\n",
      mixed: true,
    });
  });

  it("normalizes and restores the original style", () => {
    const loaded = "a\r\nb\r\n";
    expect(normalizeLineEndings(loaded)).toBe("a\nb\n");
    expect(withLineEnding("a\nb\n", "\r\n")).toBe(loaded);
    expect(withLineEnding("a\r\nb\r\n", "\n")).toBe("a\nb\n");
  });
});
