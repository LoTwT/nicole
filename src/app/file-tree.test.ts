import { describe, expect, it } from "vitest";

import {
  editSelectionRange,
  expandedPaths,
  flattenVisible,
  mergeChildren,
  parentPath,
  sortEntries,
  toTreeNodes,
  type TreeNode,
} from "./file-tree";

const entries = [
  { name: "第10章.md", path: "第10章.md", isDir: false, isMarkdown: true, size: 1 },
  { name: "第2章.md", path: "第2章.md", isDir: false, isMarkdown: true, size: 1 },
  { name: "zeta", path: "zeta", isDir: true, isMarkdown: false, size: 0 },
  { name: "Alpha", path: "Alpha", isDir: true, isMarkdown: false, size: 0 },
];

describe("file tree helpers", () => {
  it("puts folders first and sorts names naturally", () => {
    expect(sortEntries(entries).map((entry) => entry.name)).toEqual([
      "Alpha",
      "zeta",
      "第2章.md",
      "第10章.md",
    ]);
  });

  it("walks only expanded descendants", () => {
    const nodes = toTreeNodes(entries, new Set(["Alpha"]));
    nodes[0]!.children = [
      { ...entries[0]!, children: null, expanded: false, loading: false },
    ];
    expect(flattenVisible(nodes).map((node) => node.name)).toEqual([
      "Alpha",
      "第10章.md",
      "zeta",
      "第2章.md",
      "第10章.md",
    ]);
    expect(expandedPaths(nodes)).toEqual(["Alpha"]);
  });

  it("keeps existing nodes when refreshing a folder", () => {
    const current: TreeNode[] = [
      {
        ...entries[2]!,
        children: [],
        expanded: true,
        loading: false,
      },
    ];
    const merged = mergeChildren(current, [entries[2]!], new Set(["zeta"]));
    expect(merged[0]).toBe(current[0]);
  });

  it("derives parent paths and rename selections", () => {
    expect(parentPath("notes/a.md")).toBe("notes");
    expect(parentPath("a.md")).toBe(".");
    expect(editSelectionRange({ kind: "rename", target: "a", value: "note.md" })).toEqual([0, 4]);
    expect(editSelectionRange({ kind: "create-file", target: ".", value: "未命名.md" })).toEqual([0, 3]);
  });
});
