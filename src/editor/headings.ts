import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** One Markdown heading in document order. */
export interface DocumentHeading {
  level: HeadingLevel;
  /** Heading text without the ATX/Setext markers. */
  text: string;
  /** Start of the heading line; jumping to a heading puts the caret here. */
  position: number;
  line: number;
}

const HEADING_NODE = /^(?:ATXHeading|SetextHeading)([1-6])$/;

function atxText(line: string): string {
  return line
    .replace(/^\s*#{1,6}(?:[ \t]+|$)/, "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();
}

/**
 * Reads ATX and Setext headings from the Markdown syntax tree. The parser may
 * still be working on a document that has no view, so ask it to parse the rest
 * first; the fallback keeps partially parsed trees usable.
 */
export function extractHeadings(state: EditorState): DocumentHeading[] {
  const tree =
    ensureSyntaxTree(state, state.doc.length, 250) ?? syntaxTree(state);
  const headings: DocumentHeading[] = [];

  tree.iterate({
    enter(node) {
      const match = HEADING_NODE.exec(node.name);
      if (!match) {
        return;
      }
      const line = state.doc.lineAt(node.from);
      const level = Number(match[1]) as HeadingLevel;
      const text = node.name.startsWith("ATX")
        ? atxText(line.text)
        : line.text.trim();
      headings.push({
        level,
        text,
        position: line.from,
        line: line.number,
      });
      return false;
    },
  });

  return headings;
}
