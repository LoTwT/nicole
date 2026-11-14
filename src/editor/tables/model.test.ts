import { describe, expect, it } from "vitest";
import { cloneMarkdownTable, parseMarkdownTable, serializeMarkdownTable, splitTableRow } from "./model";

describe("GFM table data", () => {
  it("preserves escaped pipes, code spans, optional edge pipes, empty cells and alignment", () => {
    const source = "甲 | `a\\|b` | \\|\n:--- | :---: | ---:\n| | **乙** | 末尾";
    const table = parseMarkdownTable(source)!;
    expect(table.headers).toEqual(["甲", "`a\\|b`", "\\|"]);
    expect(table.rows).toEqual([["", "**乙**", "末尾"]]);
    expect(table.alignments).toEqual(["left", "center", "right"]);
    expect(serializeMarkdownTable(table)).toBe(source);
  });

  it("only treats unescaped pipes as delimiters, including inside inline code", () => {
    expect(splitTableRow("| \\| | a\\\\| b | ")).toEqual(["\\|", "a\\\\", "b"]);
    expect(splitTableRow("| `a|b` | c |")).toEqual(["`a", "b`", "c"]);
  });

  it("retains extra cells that GFM ignores rather than silently dropping their source", () => {
    const table = parseMarkdownTable("| A | B |\n|---|---|\n|1|2|hidden|\n|3|")!;
    table.rows[0]![0] = "改";
    const source = serializeMarkdownTable(table);
    expect(parseMarkdownTable(source)?.rows).toEqual([["改", "2", "hidden"], ["3"]]);
  });

  it("escapes newly typed literal pipes without double-escaping source pipes", () => {
    const table = parseMarkdownTable("| A | B |\n|---|---|\n|1|2|")!;
    table.headers[0] = "新|标题";
    table.rows[0]![1] = "`a\\|b`";
    const source = serializeMarkdownTable(table);
    expect(source).toContain("新\\|标题");
    expect(parseMarkdownTable(source)?.rows[0]?.[1]).toBe("`a\\|b`");
  });

  it("keeps blockquote prefixes when a nested table is changed", () => {
    const source = "> | A | B |\n> |---|---|\n> |1|2|";
    const table = parseMarkdownTable(source)!;
    expect(table.headerPrefix).toBe("> ");
    table.rows[0]![0] = "中文";
    expect(serializeMarkdownTable(table)).toBe("> | A | B |\n> | --- | --- |\n> | 中文 | 2 |");
  });

  it("keeps list container indentation and clones all mutable draft values", () => {
    const source = "- | A | B |\n  |---|---|\n  |1|2|";
    const original = parseMarkdownTable(source)!;
    const draft = cloneMarkdownTable(original);
    draft.headers[0] = "C";
    draft.rows[0]![0] = "3";
    draft.alignments[1] = "right";
    expect(serializeMarkdownTable(original)).toBe(source);
    expect(serializeMarkdownTable(draft)).toBe("- | C | B |\n  | --- | ---: |\n  | 3 | 2 |");
  });

  it("does not accept a normal paragraph or partially extracted document as a table", () => {
    expect(parseMarkdownTable("A | B\ntext | text")).toBeNull();
    expect(parseMarkdownTable("正文\n\n| A | B |\n|---|---|")).toBeNull();
    expect(parseMarkdownTable("| A | B |\n|---|---|\n\n后文")).toBeNull();
  });
});
