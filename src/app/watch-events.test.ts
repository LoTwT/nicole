import { describe, expect, it } from "vitest";

import type { WorkspaceFileEvent } from "../services/mygo";
import { classifyWatchEvents } from "./watch-events";

function event(partial: Partial<WorkspaceFileEvent>): WorkspaceFileEvent {
  return {
    op: "write",
    path: "",
    isDir: false,
    ...partial,
  };
}

describe("workspace watch classification", () => {
  it("does not treat an image create as an edit of the open document", () => {
    const result = classifyWatchEvents(
      [event({ op: "create", path: "assets/cover.png" })],
      "note.md",
      true,
    );
    expect(result.document).toBe("none");
    expect(result.refreshPaths).toContain("assets");
  });

  it("reports writes to the open document", () => {
    expect(
      classifyWatchEvents([event({ op: "write", path: "note.md" })], "note.md", true)
        .document,
    ).toBe("modified");
  });

  it("reports removal and rename-away as deletion", () => {
    expect(
      classifyWatchEvents([event({ op: "remove", path: "note.md" })], "note.md", true)
        .document,
    ).toBe("deleted");
    expect(
      classifyWatchEvents(
        [event({ op: "rename", oldPath: "note.md", path: "old.md" })],
        "note.md",
        true,
      ).document,
    ).toBe("deleted");
  });

  it("reports a containing folder removal as deletion", () => {
    expect(
      classifyWatchEvents(
        [event({ op: "remove", path: "notes", isDir: true })],
        "notes/a.md",
        true,
      ).document,
    ).toBe("deleted");
  });

  it("ignores document events for single files", () => {
    expect(
      classifyWatchEvents([event({ op: "write", path: "note.md" })], "note.md", false)
        .document,
    ).toBe("none");
  });
});
