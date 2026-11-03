import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** The subset of a Lezer syntax node that heading extraction needs. */
interface HeadingNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly firstChild: HeadingNode | null;
  readonly nextSibling: HeadingNode | null;
}

/** One Markdown heading in document order. */
export interface DocumentHeading {
  level: HeadingLevel;
  /** Heading text without the ATX/Setext markers or container prefixes. */
  text: string;
  /** Start of the heading line; jumping to a heading puts the caret here. */
  position: number;
  line: number;
}

export interface HeadingExtraction {
  headings: DocumentHeading[];
  /**
   * False when the syntax tree was still being parsed at the deadline, so
   * headings near the end of the document may be missing.
   */
  complete: boolean;
}

const HEADING_NODE = /^(?:ATXHeading|SetextHeading)([1-6])$/;
const SYNTAX_TREE_TIMEOUT_MS = 250;

function headerMarks(node: HeadingNode): HeadingNode[] {
  const marks: HeadingNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === "HeaderMark") {
      marks.push(child);
    }
  }
  return marks;
}

/**
 * The text between the ATX opening marker and an optional closing marker.
 * HeaderMark nodes already sit after any blockquote or list prefix.
 */
function atxText(state: EditorState, node: HeadingNode): string {
  const marks = headerMarks(node);
  const start = marks[0]?.to ?? node.from;
  const end = marks.length > 1 ? marks[marks.length - 1]!.from : node.to;
  return state.doc.sliceString(start, end).trim();
}

/**
 * Setext headings span their content line and the underline. The node starts
 * at the content, after any blockquote or list prefix, so read that first
 * line instead of the raw line text.
 */
function setextText(state: EditorState, node: HeadingNode): string {
  const line = state.doc.lineAt(node.from);
  return state.doc.sliceString(node.from, line.to).trim();
}

/**
 * Reads ATX and Setext headings from the Markdown syntax tree. The parser may
 * still be working on a document that has no view, so ask it to parse the rest
 * first. `complete` reports whether that parse reached the end; partial trees
 * still contribute the headings they already contain.
 */
export function extractHeadingsWithStatus(
  state: EditorState,
  timeoutMs = SYNTAX_TREE_TIMEOUT_MS,
): HeadingExtraction {
  const ensured = ensureSyntaxTree(state, state.doc.length, timeoutMs);
  const tree = ensured ?? syntaxTree(state);
  const headings: DocumentHeading[] = [];

  tree.iterate({
    enter(node) {
      const match = HEADING_NODE.exec(node.name);
      if (!match) {
        return;
      }
      const line = state.doc.lineAt(node.from);
      const level = Number(match[1]) as HeadingLevel;
      headings.push({
        level,
        text: node.name.startsWith("ATX")
          ? atxText(state, node.node)
          : setextText(state, node.node),
        position: line.from,
        line: line.number,
      });
      return false;
    },
  });

  return { headings, complete: ensured !== null };
}

/** Convenience wrapper for callers that only need the heading list. */
export function extractHeadings(state: EditorState): DocumentHeading[] {
  return extractHeadingsWithStatus(state).headings;
}
