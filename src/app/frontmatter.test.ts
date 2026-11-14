import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { applyFrontmatter, readFrontmatter } from "./frontmatter";

describe("Frontmatter draft editing", () => {
  it("keeps no-op source exact, including comments, quote style and CRLF", () => {
    const source =
      '\uFEFF---\r\n# 保留\r\ntitle: "原文" # 注释\r\ntags: [a, b]\r\n...\r\n\r\n正文\r\n';
    const draft = readFrontmatter(source);
    expect(
      applyFrontmatter(
        draft,
        draft.fields.map((field) => ({ ...field })),
      ),
    ).toBeNull();
  });
  it("changes metadata only, preserving typed and unknown values plus comments", () => {
    const source =
      '---\n# 保留\ntitle: "原文" # 注释\npublished: false\ntags: [a, b]\ncustom: { nested: 42 }\n---\n\n# 正文\n';
    const draft = readFrontmatter(source);
    const fields = draft.fields.map((field) => ({ ...field }));
    fields[0]!.value = "新标题";
    fields[1]!.value = "true";
    fields.push({ id: 100, key: "rating", kind: "number", value: "5" });
    const change = applyFrontmatter(draft, fields)!;
    const updated =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
    expect(updated).toContain("# 保留");
    expect(updated).toContain("# 注释");
    expect(updated).toContain("custom: { nested: 42 }");
    expect(updated.endsWith("\n\n# 正文\n")).toBe(true);
    expect(
      readFrontmatter(updated).fields.map((field) => [
        field.key,
        field.kind,
        field.value,
      ]),
    ).toContainEqual(["published", "boolean", "true"]);
  });
  it("adds a new block without touching the body and allows nested YAML", () => {
    const source = "# 正文\n";
    const draft = readFrontmatter(source);
    const change = applyFrontmatter(draft, [
      { id: 1, key: "meta", kind: "yaml", value: "tags: [一, 二]\ncount: 2" },
    ])!;
    expect(
      source.slice(0, change.from) + change.insert + source.slice(change.to),
    ).toBe("---\nmeta:\n  tags: [ 一, 二 ]\n  count: 2\n---\n\n# 正文\n");
  });
  it("rejects invalid YAML, duplicate fields and deleted anchors instead of dropping data", () => {
    expect(() => readFrontmatter("---\na: [broken\n---\n正文")).toThrow();
    expect(() => readFrontmatter("---\na: 1\na: 2\n---\n")).toThrow();
    expect(() => readFrontmatter("---\na: 1\n正文")).toThrow("结束标记");
    const draft = readFrontmatter("---\na: &a [one]\nb: *a\n---\n正文");
    expect(() => applyFrontmatter(draft, draft.fields.slice(1))).toThrow();
    expect(() =>
      applyFrontmatter(draft, [
        ...draft.fields,
        { ...draft.fields[0]!, id: 4 },
      ]),
    ).toThrow("重复");
  });

  it("patches one scalar without changing unknown field bytes, delimiters, comments or blank lines", () => {
    const source =
      '\uFEFF--- \t\r\n# keep\r\ntitle : "old"    # inline\r\n\r\nextra: [a, b]\r\nnested:\r\n  other : { x: 1, y: [one,two] } # nested\r\n... \t\r\n\r\n正文\r\n';
    const draft = readFrontmatter(source);
    const fields = draft.fields.map((field) => ({ ...field }));
    fields[0]!.value = "new";
    const change = applyFrontmatter(draft, fields)!;
    expect(
      source.slice(0, change.from) + change.insert + source.slice(change.to),
    ).toBe(source.replace('"old"', '"new"'));
  });

  it("keeps anchor properties and aliases when changing scalar or nested values", () => {
    const source =
      '---\nbase: &base "old" # inline\nmeta: &meta\n  tags: [a, b]\n  count: 1\nref: *base\nnestedRef: *meta\nextra: [one,two]\n---\n正文';
    const draft = readFrontmatter(source);
    const fields = draft.fields.map((field) => ({ ...field }));
    fields[0]!.value = "new";
    fields[1]!.value = fields[1]!.value.replace("count: 1", "count: 2");
    const change = applyFrontmatter(draft, fields)!;
    const updated =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
    expect(updated).toContain('base: &base "new" # inline\n');
    expect(updated).toContain(
      "ref: *base\nnestedRef: *meta\nextra: [one,two]\n",
    );
    const values = parseDocument(readFrontmatter(updated).yaml).toJS();
    expect(values.ref).toBe("new");
    expect(values.meta).toEqual({ tags: ["a", "b"], count: 2 });
    expect(values.nestedRef).toBe(values.meta);
    const removeAnchor = fields.map((field) => ({ ...field }));
    removeAnchor[1]!.value = removeAnchor[1]!.value.replace("&meta", "");
    expect(() => applyFrontmatter(draft, removeAnchor)).toThrow("锚点");
  });

  it("preserves block scalar header comments and correctly types tag and empty-value edits", () => {
    const source =
      "---\ntext: |  # keep exactly\n  old\nflag: !!str false\nempty: # keep empty\nextra: [a, b]\n---\n";
    const draft = readFrontmatter(source);
    const fields = draft.fields.map((field) => ({ ...field }));
    fields[0]!.value = "new\n";
    fields[1]!.kind = "boolean";
    fields[1]!.value = "true";
    fields[2]!.kind = "number";
    fields[2]!.value = " 5 ";
    const change = applyFrontmatter(draft, fields)!;
    const updated =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
    expect(updated).toContain("text: |  # keep exactly\n  new\n");
    expect(updated).toContain("empty: 5 # keep empty\nextra: [a, b]\n");
    expect(parseDocument(readFrontmatter(updated).yaml).toJS()).toEqual({
      text: "new\n",
      flag: true,
      empty: 5,
      extra: ["a", "b"],
    });
  });

  it("renames, deletes and adds entries while retaining neighboring layout and comments", () => {
    const source =
      "---\n# leading\nremove: 1 # removed with field\n\n# keep before\nname : 'same' # keep inline\nextra: [a,b]\n# tail\n---\nbody";
    const draft = readFrontmatter(source);
    const fields = draft.fields.slice(1).map((field) => ({ ...field }));
    fields[0]!.key = "new name";
    fields.push({ id: 10, key: "added", kind: "number", value: "2" });
    const change = applyFrontmatter(draft, fields)!;
    const updated =
      source.slice(0, change.from) + change.insert + source.slice(change.to);
    expect(updated).toBe(
      "---\n# leading\n\n# keep before\n\"new name\" : 'same' # keep inline\nextra: [a,b]\n# tail\nadded: 2\n---\nbody",
    );
  });

  it("supports local value changes in a flow mapping but rejects unsafe structural edits and reordering", () => {
    const source = '---\n{ title: "old", extra: [a,b] } # tail\n---\n';
    const draft = readFrontmatter(source);
    const fields = draft.fields.map((field) => ({ ...field }));
    fields[0]!.value = "new";
    const change = applyFrontmatter(draft, fields)!;
    expect(change.insert).toBe(source.replace('"old"', '"new"'));
    expect(() => applyFrontmatter(draft, fields.slice(1))).toThrow("源码");
    expect(() => applyFrontmatter(draft, [...fields].reverse())).toThrow("重排");
    expect(() =>
      applyFrontmatter(draft, [...fields, { ...fields[0]!, key: "other" }]),
    ).toThrow("标识");
  });
});
