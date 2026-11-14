import { markdownLanguage } from "@codemirror/lang-markdown";
import type { SyntaxNode } from "@lezer/common";

export type TableAlignment = "left" | "center" | "right" | null;

/** Cell values remain Markdown source, not HTML or a lossy text projection. */
export interface MarkdownTable {
  source: string;
  headers: string[];
  rows: string[][];
  alignments: TableAlignment[];
  /** Container prefixes keep blockquotes and list indentation in place. */
  headerPrefix: string;
  delimiterPrefix: string;
  rowPrefixes: string[];
}

/** GFM requires pipes in code spans to be escaped too. */
export function splitTableRow(line: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let backslashes = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === "|" && backslashes % 2 === 0) {
      parts.push(line.slice(start, index).trim());
      start = index + 1;
    }
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  parts.push(line.slice(start).trim());
  if (line.trimStart().startsWith("|")) parts.shift();
  if (line.trimEnd().endsWith("|") && backslashesBeforeLastPipe(line) % 2 === 0) {
    parts.pop();
  }
  return parts;
}

function backslashesBeforeLastPipe(line: string): number {
  const end = line.trimEnd().length - 1;
  let count = 0;
  for (let index = end - 1; index >= 0 && line[index] === "\\"; index--) count++;
  return count;
}

function linePrefix(source: string, position: number): string {
  return source.slice(source.lastIndexOf("\n", position - 1) + 1, position);
}

/** Uses the same GFM parser as the editor to establish table boundaries. */
export function parseMarkdownTable(source: string): MarkdownTable | null {
  const tree = markdownLanguage.parser.parse(source);
  let table: SyntaxNode | null = null;
  tree.iterate({
    enter(node) {
      if (node.name !== "Table" || table !== null) return;
      table = node.node;
      return false;
    },
  });
  if (table === null) return null;
  const node = table as SyntaxNode;
  // Only a complete table (including its container prefix) may be replaced.
  if (source.slice(node.to).trim() !== "" || source.slice(0, node.from).includes("\n")) return null;
  const header = node.getChild("TableHeader");
  const delimiter = node.getChild("TableDelimiter");
  if (header === null || delimiter === null) return null;
  const headers = splitTableRow(source.slice(header.from, header.to));
  const separators = splitTableRow(source.slice(delimiter.from, delimiter.to));
  if (headers.length === 0 || headers.length !== separators.length) return null;
  const rows = node.getChildren("TableRow");
  return {
    source,
    headers,
    rows: rows.map((row) => splitTableRow(source.slice(row.from, row.to))),
    alignments: separators.map((cell) => {
      const left = cell.startsWith(":");
      const right = cell.endsWith(":");
      return left && right ? "center" : left ? "left" : right ? "right" : null;
    }),
    headerPrefix: linePrefix(source, header.from),
    delimiterPrefix: linePrefix(source, delimiter.from),
    rowPrefixes: rows.map((row) => linePrefix(source, row.from)),
  };
}

export function cloneMarkdownTable(table: MarkdownTable): MarkdownTable {
  return {
    ...table,
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
    alignments: [...table.alignments],
    rowPrefixes: [...table.rowPrefixes],
  };
}

function escapeCellPipes(cell: string): string {
  let result = "";
  let backslashes = 0;
  for (const character of cell.replace(/[\r\n]/g, " ")) {
    if (character === "|" && backslashes % 2 === 0) result += "\\";
    result += character;
    backslashes = character === "\\" ? backslashes + 1 : 0;
  }
  return result;
}

/** A no-op Apply keeps the original table byte-for-byte. */
export function serializeMarkdownTable(table: MarkdownTable): string {
  const original = parseMarkdownTable(table.source);
  if (original && JSON.stringify([table.headers, table.rows, table.alignments]) ===
      JSON.stringify([original.headers, original.rows, original.alignments])) {
    return table.source;
  }
  const row = (cells: readonly string[]) => `| ${cells.map(escapeCellPipes).join(" | ")} |`;
  const delimiter = table.alignments.map((alignment) =>
    alignment === "center" ? ":---:" : alignment === "left" ? ":---" : alignment === "right" ? "---:" : "---",
  );
  return [
    table.headerPrefix + row(table.headers),
    table.delimiterPrefix + row(delimiter),
    ...table.rows.map((cells, index) => (table.rowPrefixes[index] ?? table.delimiterPrefix) + row(cells)),
  ].join("\n");
}
