import {
  EditorSelection,
  type ChangeSet,
  type EditorState,
  type SelectionRange,
} from "@codemirror/state";

import { rangeInOrdinaryBody } from "./markdown-context";

export type WrapCharacter = "*" | "`" | "~" | "[";

/**
 * Every character closeBrackets might pair in Markdown. `[` is also in the
 * wrapping set; the other brackets only need literal replacement so a
 * non-empty selection never turns into `(文字)`, `{文字}` or a quoted pair.
 */
export type DirectInputCharacter =
  | WrapCharacter
  | "("
  | ")"
  | "]"
  | "{"
  | "}"
  | "'"
  | '"';

const WRAP_CHARACTERS = new Set<string>(["*", "`", "~", "["]);
const BRACKET_CHARACTERS = new Set<string>([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "'",
  '"',
]);
const DIRECT_CHARACTERS = new Set<string>([
  ...WRAP_CHARACTERS,
  ...BRACKET_CHARACTERS,
]);

export function isWrapCharacter(text: string): text is WrapCharacter {
  return WRAP_CHARACTERS.has(text);
}

export function isDirectInputCharacter(
  text: string,
): text is DirectInputCharacter {
  return DIRECT_CHARACTERS.has(text);
}

/** A single selection that can become a new link without touching the document yet. */
export interface LinkDraftRange {
  from: number;
  to: number;
  text: string;
  leading: string;
  trailing: string;
}

export interface WrapPlan {
  changes: ChangeSet;
  selection: EditorSelection;
  /** Present only when the input will open an immersive link draft. */
  linkDraft: LinkDraftRange | null;
  /** True when `~` would only repeat an existing `~~` pair. */
  noop: boolean;
}

function singleLine(state: EditorState, range: SelectionRange): boolean {
  return state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number;
}

function eligible(state: EditorState, range: SelectionRange): boolean {
  return (
    !range.empty &&
    singleLine(state, range) &&
    state.sliceDoc(range.from, range.to).trim() !== "" &&
    rangeInOrdinaryBody(state, range.from, range.to)
  );
}

function replacementPlan(
  state: EditorState,
  character: string,
): WrapPlan {
  const result = state.changeByRange((range) => ({
    changes: { from: range.from, to: range.to, insert: character },
    range: EditorSelection.cursor(range.from + character.length),
  }));
  return {
    changes: result.changes,
    selection: result.selection,
    linkDraft: null,
    noop: false,
  };
}

/**
 * Decides what a directly typed `*`, backtick, `~` or `[` does to the current
 * selections. All-empty selections return null so CodeMirror's closeBrackets
 * keeps handling them. Any non-empty selection takes the whole input away from
 * closeBrackets, even when wrapping conditions fail.
 */
export function planWrapInput(
  state: EditorState,
  character: WrapCharacter,
): WrapPlan | null {
  const ranges = state.selection.ranges;
  if (!ranges.some((range) => !range.empty)) return null;

  if (!ranges.every((range) => eligible(state, range))) {
    return replacementPlan(state, character);
  }

  let linkDraft: LinkDraftRange | null = null;
  const result = state.changeByRange((range) => {
    const leading = /^[ \t]*/.exec(state.sliceDoc(range.from, range.to))?.[0] ?? "";
    const trailing = /[ \t]*$/.exec(state.sliceDoc(range.from, range.to))?.[0] ?? "";
    const innerFrom = range.from + leading.length;
    const innerTo = range.to - trailing.length;
    if (character === "~") {
      const before = state.sliceDoc(Math.max(0, innerFrom - 2), innerFrom);
      const after = state.sliceDoc(innerTo, innerTo + 2);
      if (before === "~~" && after === "~~") {
        return { range };
      }
    }

    const marker = character === "~" ? "~~" : character;
    const forward = range.anchor <= range.head;
    if (character === "[") {
      // The dialog edits one target; several valid selections keep the
      // literal link syntax instead of stacking dialogs.
      if (ranges.length === 1) {
        linkDraft = {
          from: range.from,
          to: range.to,
          text: state.sliceDoc(innerFrom, innerTo),
          leading,
          trailing,
        };
      }
      return {
        changes: [
          { from: innerFrom, insert: "[" },
          { from: innerTo, insert: "]()" },
        ],
        range: EditorSelection.range(innerTo + 3, innerTo + 3, range.goalColumn),
      };
    }

    const start = innerFrom + marker.length;
    const end = innerTo + marker.length;
    return {
      changes: [
        { from: innerFrom, insert: marker },
        { from: innerTo, insert: marker },
      ],
      range: EditorSelection.range(
        forward ? start : end,
        forward ? end : start,
        range.goalColumn,
      ),
    };
  });

  return {
    changes: result.changes,
    selection: result.selection,
    linkDraft,
    noop: result.changes.empty,
  };
}

/**
 * Literal replacement for the bracket characters closeBrackets would
 * otherwise pair. All-empty selections return null so closeBrackets keeps its
 * normal behavior.
 */
export function planBracketInput(
  state: EditorState,
  character: DirectInputCharacter,
): WrapPlan | null {
  if (!state.selection.ranges.some((range) => !range.empty)) return null;
  return replacementPlan(state, character);
}

/**
 * A direct key listener records the key before the browser turns it into an
 * input change. CodeMirror's inputHandler runs for typing, paste, drop and
 * completion alike; only this pending direct key allows wrapping.
 */
export interface DirectInputState {
  character: DirectInputCharacter | null;
}

export function noteDirectInput(
  state: DirectInputState,
  event: KeyboardEvent,
): void {
  state.character = null;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !isDirectInputCharacter(event.key)
  ) {
    return;
  }
  state.character = event.key;
  setTimeout(() => {
    if (state.character === event.key) state.character = null;
  }, 0);
}

export function takeDirectInput(
  state: DirectInputState,
  text: string,
): DirectInputCharacter | null {
  const character = state.character;
  state.character = null;
  return character !== null && character === text ? character : null;
}
