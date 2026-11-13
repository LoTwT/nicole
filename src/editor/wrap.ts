import {
  EditorSelection,
  type ChangeSet,
  type EditorState,
  type SelectionRange,
  type Text,
} from "@codemirror/state";

import { rangeInOrdinaryBody } from "./markdown-context";
import { splitEdgeWhitespace } from "./whitespace";

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

export function isBracketInputCharacter(
  text: string,
): text is DirectInputCharacter {
  return BRACKET_CHARACTERS.has(text);
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
  /** Present only when the input will open one or more immersive link drafts. */
  linkDrafts: readonly LinkDraftRange[];
  /** True when the plan wrapped instead of applying a literal replacement. */
  wrapped: boolean;
  /** True when `~` would only repeat an existing `~~` pair. */
  noop: boolean;
}

/**
 * The immediately preceding backtick wrap. It is accepted only for the exact
 * document and selection the wrap produced, so an existing InlineCode that
 * the user navigates back into stays excluded.
 */
export interface WrapContinuation {
  doc: Text;
  selection: EditorSelection;
  character: WrapCharacter;
}

export function wrapContinuationActive(
  state: EditorState,
  character: WrapCharacter,
  continuation: WrapContinuation | null,
): continuation is WrapContinuation {
  return (
    continuation !== null &&
    continuation.character === character &&
    state.doc === continuation.doc &&
    state.selection.eq(continuation.selection, true)
  );
}

function singleLine(state: EditorState, range: SelectionRange): boolean {
  return state.doc.lineAt(range.from).number === state.doc.lineAt(range.to).number;
}

function eligible(
  state: EditorState,
  range: SelectionRange,
  allowInlineCode: boolean,
): boolean {
  return (
    !range.empty &&
    singleLine(state, range) &&
    splitEdgeWhitespace(state.sliceDoc(range.from, range.to)).core !== "" &&
    rangeInOrdinaryBody(state, range.from, range.to, { allowInlineCode })
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
    linkDrafts: [],
    wrapped: false,
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
  continuation: WrapContinuation | null = null,
): WrapPlan | null {
  const ranges = state.selection.ranges;
  if (!ranges.some((range) => !range.empty)) return null;

  const allowInlineCode =
    character === "`" && wrapContinuationActive(state, character, continuation);
  if (!ranges.every((range) => eligible(state, range, allowInlineCode))) {
    return replacementPlan(state, character);
  }

  const linkDrafts: LinkDraftRange[] = [];
  const result = state.changeByRange((range) => {
    const raw = state.sliceDoc(range.from, range.to);
    const { leading, trailing, core } = splitEdgeWhitespace(raw);
    const innerFrom = range.from + leading.length;
    const innerTo = innerFrom + core.length;
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
      linkDrafts.push({
        from: range.from,
        to: range.to,
        text: core,
        leading,
        trailing,
      });
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
    linkDrafts,
    wrapped: true,
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
 * A direct input can be recognized from either a keyboard event or the
 * browser's `beforeinput` event. The latter is the authoritative early
 * boundary: WebKit sometimes delivers the keydown after the DOM input (and
 * after CodeMirror's inputHandler), while still identifying ordinary typing
 * as `insertText`. A token is tied to the document and selection where it was
 * observed so a delayed event cannot consume it after unrelated state changes.
 */
export interface DirectInputIntent {
  character: DirectInputCharacter;
  doc: Text;
  selection: EditorSelection;
  source: "keydown" | "beforeinput";
}

export interface CompositionInput {
  data: string;
  /** The inputHandler has consumed this DOM input. */
  handled: boolean;
}

export interface CompositionOperation {
  /** Identifies one composition lifecycle, including its pending tail. */
  id: number;
  /**
   * The document and selected range the composition replaces. A composition
   * whose final text already equals this range changes nothing, even when
   * CodeMirror never sees an input to consume.
   */
  startDoc: Text;
  startRange: { from: number; to: number; text: string };
  hasInput: boolean;
  lastInput: CompositionInput | null;
}

/**
 * A composition whose end carried text that was not yet reconciled by
 * CodeMirror can still deliver that text afterwards. Keep the exact editor
 * state and epoch so the next matching input is consumed once as the
 * composition tail, not as a new direct key; any intervening transaction
 * invalidates it.
 */
export interface PendingCompositionEnd {
  id: number;
  data: string;
  state: EditorState;
}

export interface DirectInputState {
  intent: DirectInputIntent | null;
  composition: CompositionOperation | null;
  pendingCompositionEnd: PendingCompositionEnd | null;
  nextCompositionId: number;
}

export function clearDirectInput(state: DirectInputState): void {
  state.intent = null;
  state.pendingCompositionEnd = null;
}

export function noteCompositionStart(
  state: DirectInputState,
  editorState: EditorState,
): void {
  state.intent = null;
  state.pendingCompositionEnd = null;
  const range = editorState.selection.main;
  state.composition = {
    id: state.nextCompositionId++,
    startDoc: editorState.doc,
    startRange: {
      from: range.from,
      to: range.to,
      text: editorState.sliceDoc(range.from, range.to),
    },
    hasInput: false,
    lastInput: null,
  };
}

export function noteCompositionBeforeInput(
  state: DirectInputState,
  event: InputEvent,
): void {
  state.intent = null;
  const composition = state.composition;
  if (composition === null) return;
  composition.hasInput = true;
  composition.lastInput = {
    data: event.data ?? "",
    handled: false,
  };
}

export function noteCompositionInput(
  state: DirectInputState,
  text: string | null = null,
): void {
  state.intent = null;
  const composition = state.composition;
  if (composition === null) return;
  composition.hasInput = true;
  if (text !== null) {
    if (composition.lastInput?.data === text) {
      composition.lastInput.handled = true;
    } else {
      composition.lastInput = { data: text, handled: true };
    }
  }
}

export function noteCompositionEnd(
  state: DirectInputState,
  data: string,
  editorState: EditorState,
): void {
  const composition = state.composition;
  state.composition = null;
  state.intent = null;
  const last = composition?.lastInput ?? null;
  const finalResultObserved =
    last !== null && last.data === data && last.handled;
  // A composition can finish without an input for CodeMirror to consume: if
  // its final text equals the range it replaced, the document already holds
  // the result. Only that unchanged range may skip the pending tail; a
  // different final text or any document change still needs the tail.
  const rangeAlreadyFinal =
    composition !== null &&
    data.length > 0 &&
    editorState.doc === composition.startDoc &&
    composition.startRange.text === data;
  state.pendingCompositionEnd =
    composition !== null &&
    data.length > 0 &&
    !finalResultObserved &&
    !rangeAlreadyFinal
      ? { id: composition.id, data, state: editorState }
      : null;
}

export function takePendingCompositionTail(
  state: DirectInputState,
  text: string,
  editorState: EditorState,
): boolean {
  const pending = state.pendingCompositionEnd;
  if (pending === null) return false;
  state.pendingCompositionEnd = null;
  return pending.data === text && pending.state === editorState;
}

function rememberDirectInput(
  state: DirectInputState,
  character: DirectInputCharacter,
  editorState: EditorState,
  source: DirectInputIntent["source"],
): void {
  state.intent = {
    character,
    doc: editorState.doc,
    selection: editorState.selection,
    source,
  };
}

export function noteDirectKeydown(
  state: DirectInputState,
  event: KeyboardEvent,
  editorState: EditorState,
): boolean {
  const pending = state.intent;
  state.intent = null;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    !isDirectInputCharacter(event.key)
  ) {
    // A late keydown is part of the same input that was already recognized by
    // `beforeinput`; it must not invalidate that earlier direct-input intent.
    if (
      pending?.source === "beforeinput" &&
      pending.character === event.key &&
      pending.doc === editorState.doc &&
      pending.selection.eq(editorState.selection, true)
    ) {
      state.intent = pending;
    }
    return false;
  }
  rememberDirectInput(state, event.key, editorState, "keydown");
  return true;
}

export function noteDirectBeforeInput(
  state: DirectInputState,
  event: InputEvent,
  editorState: EditorState,
  composing: boolean,
): boolean {
  const pendingCompositionEnd = state.pendingCompositionEnd;
  state.intent = null;
  if (pendingCompositionEnd !== null) {
    const isCompositionTail =
      pendingCompositionEnd.state === editorState &&
      event.inputType === "insertText" &&
      !event.isComposing &&
      event.data === pendingCompositionEnd.data;
    if (isCompositionTail) return false;
    state.pendingCompositionEnd = null;
  }
  if (
    event.defaultPrevented ||
    event.isComposing ||
    composing ||
    event.inputType !== "insertText" ||
    typeof event.data !== "string" ||
    event.data.length !== 1 ||
    !isDirectInputCharacter(event.data)
  ) {
    return false;
  }
  rememberDirectInput(state, event.data, editorState, "beforeinput");
  return true;
}

export function takeDirectInput(
  state: DirectInputState,
  text: string,
  editorState: EditorState,
): DirectInputCharacter | null {
  const intent = state.intent;
  state.intent = null;
  if (
    intent === null ||
    intent.character !== text ||
    intent.doc !== editorState.doc ||
    !intent.selection.eq(editorState.selection, true)
  ) {
    return null;
  }
  return intent.character;
}
