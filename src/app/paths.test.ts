import { describe, expect, it } from "vitest";

import {
  absoluteBaseName,
  absoluteParent,
  displayPath,
  isInFolder,
  relativePath,
} from "./paths";

describe("path display", () => {
  it("abbreviates the home folder", () => {
    expect(displayPath("/Users/me/notes", "/Users/me")).toBe("~/notes");
    expect(displayPath("/Users/me", "/Users/me")).toBe("~");
    expect(displayPath("/tmp/x", "/Users/me")).toBe("/tmp/x");
  });

  it("works with absolute paths", () => {
    expect(absoluteBaseName("/tmp/a.md")).toBe("a.md");
    expect(absoluteParent("/tmp/a.md")).toBe("/tmp");
    expect(absoluteParent("/a.md")).toBe("/");
  });

  it("checks workspace containment by segment", () => {
    expect(isInFolder("/notes", "/notes/a.md")).toBe(true);
    expect(isInFolder("/notes", "/notes-other/a.md")).toBe(false);
    expect(relativePath("/notes", "/notes/a.md")).toBe("a.md");
  });
});
