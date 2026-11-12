import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

// Slash-menu context intentionally keeps its original point rules: an inline
// code delimiter is not "inside" code, and only the three block kinds below
// silence a trigger.
const POINT_BLOCK_NODES = new Set(["FencedCode", "CodeBlock", "HTMLBlock"]);

// Wrapping a selection must also stay out of HTML and comments anywhere in the
// range, including their delimiters.
const RANGE_EXCLUDED_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "HTMLBlock",
  "CommentBlock",
  "ProcessingInstructionBlock",
  "InlineCode",
  "HTMLTag",
  "Comment",
  "ProcessingInstruction",
]);

/** End of a leading `---` frontmatter block, or null when there is none. */
export function frontmatterEnd(state: EditorState): number | null {
  if (state.doc.lines < 2 || state.doc.line(1).text.trim() !== "---") {
    return null;
  }
  for (let number = 2; number <= state.doc.lines; number++) {
    const text = state.doc.line(number).text.trim();
    if (text === "---" || text === "...") {
      return state.doc.line(number).to;
    }
  }
  return null;
}

function inExcludedNode(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): boolean {
  let node = syntaxTree(state).resolveInner(position, bias);
  for (;;) {
    if (node.name === "InlineCode") {
      if (node.from < position && position < node.to) return true;
    } else if (
      POINT_BLOCK_NODES.has(node.name) &&
      node.from <= position &&
      (position < node.to ||
        (position === state.doc.length && node.to === position))
    ) {
      return true;
    }
    if (!node.parent) return false;
    node = node.parent;
  }
}

/** Whether a caret belongs to code, HTML or frontmatter instead of prose. */
export function inExcludedContext(
  state: EditorState,
  position: number,
): boolean {
  const frontmatter = frontmatterEnd(state);
  if (frontmatter !== null && position < frontmatter) return true;

  if (inExcludedNode(state, position, 1)) return true;
  // At the very end there is no character on the right to resolve against.
  // Looking left finds an unclosed fenced/indented/HTML block whose node ends
  // exactly at the document end. A closed fenced block ends before a trailing
  // newline, so its closing fence is not mistaken for content.
  return position === state.doc.length
    ? inExcludedNode(state, position, -1)
    : false;
}

/**
 * Whether every character of a non-empty range is ordinary Markdown prose.
 * The syntax tree may still be incomplete for a very large document; an
 * unavailable part is treated as not verified rather than guessed as prose.
 */
export function rangeInOrdinaryBody(
  state: EditorState,
  from: number,
  to: number,
): boolean {
  const frontmatter = frontmatterEnd(state);
  if (frontmatter !== null && from < frontmatter) return false;

  const tree = ensureSyntaxTree(state, to, 20);
  // Fail closed when the parser budget cannot cover the selection; ordinary
  // replacement is safer than wrapping code or HTML we could not inspect.
  if (tree === null) return false;
  let ordinary = true;
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (!ordinary) return false;
      if (!RANGE_EXCLUDED_NODES.has(node.name)) return;
      if (node.from < to && node.to > from) {
        ordinary = false;
        return false;
      }
    },
  });
  return ordinary;
}
