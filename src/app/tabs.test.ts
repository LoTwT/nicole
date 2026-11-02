import { describe, expect, it } from "vitest";

import type { EditorRestoreState } from "../editor";
import {
  distinguishingSuffixes,
  insertionIndex,
  mapSnapshotForReplacement,
  tabBadge,
  tabCloseProblems,
  tabTooltip,
  type TabModel,
} from "./tabs";

let nextId = 1;

function model(overrides: Partial<TabModel> = {}): TabModel {
  return {
    id: nextId++,
    kind: "workspace",
    path: "a.md",
    name: "a.md",
    text: "text",
    originalText: "text",
    lineEnding: "\n",
    mixedLineEndings: false,
    savePhase: "saved",
    saveError: null,
    saveErrorDetail: null,
    externalState: "none",
    revision: 0,
    generation: 1,
    snapshot: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<EditorRestoreState> = {}): EditorRestoreState {
  return {
    selection: { ranges: [{ anchor: 0, head: 0 }], main: 0 },
    history: { done: [], undone: [] },
    scrollTopLine: 1,
    scrollTopOffset: 0,
    ...overrides,
  };
}

describe("tab presentation", () => {
  it("adds a parent-folder suffix only for duplicated names", () => {
    const essay = model({ path: "随笔/README.md", name: "README.md" });
    const travel = model({ path: "旅行/README.md", name: "README.md" });
    const unique = model({ path: "notes.md", name: "notes.md" });
    const suffixes = distinguishingSuffixes(
      [essay, travel, unique],
      "写作",
    );
    expect(suffixes.get(essay.id)).toBe("随笔");
    expect(suffixes.get(travel.id)).toBe("旅行");
    expect(suffixes.has(unique.id)).toBe(false);
  });

  it("uses the folder name for a same-named single file", () => {
    const workspace = model({ path: "README.md", name: "README.md" });
    const single = model({
      kind: "single",
      path: "/Users/me/blog/README.md",
      name: "README.md",
    });
    const suffixes = distinguishingSuffixes([workspace, single], "写作");
    expect(suffixes.get(workspace.id)).toBe("写作");
    expect(suffixes.get(single.id)).toBe("blog");
  });

  it("builds the full path tooltip", () => {
    expect(tabTooltip(model({ path: "a/b.md" }), "notes")).toBe(
      "notes/a/b.md",
    );
    expect(
      tabTooltip(
        model({ kind: "single", path: "/tmp/a.md" }),
        "notes",
      ),
    ).toBe("/tmp/a.md");
  });

  it("marks only states the user has to resolve", () => {
    expect(tabBadge(model({ savePhase: "editing" }))).toBeNull();
    expect(tabBadge(model({ savePhase: "saving" }))).toBeNull();
    expect(tabBadge(model({ mixedLineEndings: true }))).toEqual({
      tone: "warning",
      label: "换行风格混合",
    });
    expect(
      tabBadge(model({ saveError: "失败", savePhase: "failed" })),
    ).toEqual({ tone: "danger", label: "保存失败" });
    expect(
      tabBadge(
        model({
          externalState: "deleted",
          saveError: "失败",
          mixedLineEndings: true,
        }),
      ),
    ).toEqual({ tone: "danger", label: "文件已在磁盘上被删除或移走" });
  });

  it("lists every reason a tab cannot be discarded silently", () => {
    const tab = model({
      name: "draft.md",
      text: "new",
      originalText: "old",
      externalState: "deleted",
      saveError: "保存失败",
      mixedLineEndings: true,
    });
    expect(tabCloseProblems(tab)).toEqual([
      "draft.md：文件已在磁盘上被删除或移走",
      "draft.md：保存失败",
      "draft.md：换行风格混合",
    ]);
    expect(tabCloseProblems(model())).toEqual([]);
  });

  it("puts a new tab immediately after the active one", () => {
    const first = model({ path: "a.md" });
    const second = model({ path: "b.md" });
    expect(insertionIndex([first, second], first.id)).toBe(1);
    expect(insertionIndex([first, second], second.id)).toBe(2);
    expect(insertionIndex([first, second], null)).toBe(2);
    expect(insertionIndex([], null)).toBe(0);
  });
});

describe("background snapshot mapping", () => {
  it("maps selections through an insertion and drops incompatible history", () => {
    const mapped = mapSnapshotForReplacement(
      snapshot({
        selection: {
          ranges: [
            { anchor: 4, head: 7 },
            { anchor: 0, head: 2 },
          ],
          main: 1,
        },
        scrollTopLine: 2,
        scrollTopOffset: 6,
      }),
      "one\ntwo\n",
      "zero\none\ntwo\n",
    );
    expect(mapped?.selection).toEqual({
      ranges: [
        { anchor: 9, head: 12 },
        { anchor: 0, head: 7 },
      ],
      main: 1,
    });
    expect(mapped?.scrollTopLine).toBe(3);
    expect(mapped?.scrollTopOffset).toBe(6);
    expect(mapped?.history).toBeNull();
  });

  it("returns the same snapshot when the text did not change", () => {
    const original = snapshot();
    expect(mapSnapshotForReplacement(original, "text", "text")).toBe(original);
    expect(mapSnapshotForReplacement(null, "a", "b")).toBeNull();
  });

  it("clamps selections after a shorter document replaces the text", () => {
    const mapped = mapSnapshotForReplacement(
      snapshot({
        selection: { ranges: [{ anchor: 18, head: 30 }], main: 0 },
        scrollTopLine: 5,
      }),
      "one\ntwo\nthree\nfour\nfive\n",
      "short\n",
    );
    expect(mapped?.selection?.ranges[0]).toEqual({ anchor: 0, head: 6 });
    expect(mapped?.scrollTopLine).toBe(1);
  });
});
