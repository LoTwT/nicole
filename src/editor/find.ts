import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import type { CommandTarget } from "../commands/types";

export type FindReplaceError = "invalid-regexp";

/** Conditions shared by all tabs; the open state and counts stay per view. */
export interface FindReplaceOptions {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  regexp: boolean;
}

export const EMPTY_FIND_OPTIONS: FindReplaceOptions = {
  query: "",
  replacement: "",
  caseSensitive: false,
  regexp: false,
};

/** What the Nicole find panel renders. The controller owns the open state. */
export interface FindReplaceState {
  open: boolean;
  replaceVisible: boolean;
  query: string;
  replacement: string;
  caseSensitive: boolean;
  regexp: boolean;
  /** One-based index of the main selection when it exactly matches a match. */
  current: number;
  total: number;
  error: FindReplaceError | null;
  /** Increments when a shortcut asks the panel to focus its input again. */
  focusToken: number;
}

export interface FindReplaceController {
  snapshot(): FindReplaceState;
  subscribe(listener: (state: FindReplaceState) => void): () => void;
  /** Opens the panel, optionally revealing the replace row. */
  open(replaceVisible?: boolean): void;
  close(): void;
  /** Re-focuses the find input when the panel is already open. */
  focus(): void;
  setQuery(query: string): void;
  setReplacement(replacement: string): void;
  setCaseSensitive(caseSensitive: boolean): void;
  setRegexp(regexp: boolean): void;
  next(): boolean;
  previous(): boolean;
  replace(): boolean;
  replaceAll(): boolean;
  destroy(): void;
}

const findPanelOpen = StateEffect.define<boolean>();

const findPanelOpenField = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(findPanelOpen)) value = effect.value;
    }
    return value;
  },
});

const matchMark = Decoration.mark({ class: "cm-searchMatch" });
const selectedMatchMark = Decoration.mark({
  class: "cm-searchMatch cm-searchMatch-selected",
});

// CodeMirror's own search panel is never shown: the Vue panel is the only
// visible one. Keeping a panel factory means an old keymap or a test that
// calls openSearchPanel() still cannot create a second visible panel.
const inertSearchPanel = () => {
  const dom = document.createElement("div");
  dom.hidden = true;
  dom.setAttribute("aria-hidden", "true");
  return { dom };
};

const searchSupport = search({ createPanel: inertSearchPanel });

function currentQuery(view: EditorView): SearchQuery {
  return getSearchQuery(view.state);
}

function queryUsable(view: EditorView): boolean {
  const query = currentQuery(view);
  return query.search !== "" && query.valid;
}

function forEachMatch(
  query: SearchQuery,
  state: EditorState,
  from: number,
  to: number,
  visit: (match: { from: number; to: number }) => void,
) {
  const cursor = query.getCursor(state, from, to);
  for (;;) {
    const next = cursor.next();
    if (next.done) return;
    visit(next.value);
  }
}

/**
 * Reuses CodeMirror's query cursor rather than a second regular-expression
 * engine. The margin lets a match that crosses a viewport edge still appear.
 */
function buildDecorations(
  view: EditorView,
  isOpen: boolean,
): DecorationSet {
  if (!isOpen) return Decoration.none;
  const query = currentQuery(view);
  if (!query.valid) return Decoration.none;

  const matches = new Map<string, { from: number; to: number }>();
  const margin = 250;
  for (const visible of view.visibleRanges) {
    const from = Math.max(0, visible.from - margin);
    const to = Math.min(view.state.doc.length, visible.to + margin);
    forEachMatch(query, view.state, from, to, (match) => {
      if (match.to <= match.from) return;
      if (match.to < visible.from || match.from > visible.to) return;
      matches.set(`${match.from}:${match.to}`, match);
    });
  }

  const selection = view.state.selection.ranges;
  const sorted = [...matches.values()].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const match of sorted) {
    const current = selection.some(
      (range) => range.from === match.from && range.to === match.to,
    );
    builder.add(
      match.from,
      match.to,
      current ? selectedMatchMark : matchMark,
    );
  }
  return builder.finish();
}

class FindHighlighter {
  decorations: DecorationSet;
  // An IME composition must not have the decorated line rebuilt underneath
  // the candidate window. Map the existing set through the edit and rebuild
  // after the composition ends, matching preview()'s rule.
  private stale = false;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(
      view,
      view.state.field(findPanelOpenField),
    );
  }

  update(update: ViewUpdate) {
    const openChanged =
      update.state.field(findPanelOpenField) !==
      update.startState.field(findPanelOpenField);
    const queryChanged =
      getSearchQuery(update.state) !== getSearchQuery(update.startState);
    const changed =
      openChanged ||
      queryChanged ||
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged;
    if (!changed && !this.stale) return;

    if (update.view.compositionStarted) {
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
      }
      this.stale = true;
      return;
    }

    if (this.stale || changed) {
      this.stale = false;
      this.decorations = buildDecorations(
        update.view,
        update.state.field(findPanelOpenField),
      );
    }
  }
}

const findHighlighter = ViewPlugin.fromClass(FindHighlighter, {
  decorations: (value) => value.decorations,
});

export const findSearchExtension: Extension = [
  searchSupport,
  findPanelOpenField,
  findHighlighter,
];

interface Counts {
  current: number;
  total: number;
  error: FindReplaceError | null;
}

function countMatches(state: EditorState): Counts {
  const query = getSearchQuery(state);
  if (query.search === "") {
    return { current: 0, total: 0, error: null };
  }
  if (!query.valid) {
    return { current: 0, total: 0, error: "invalid-regexp" };
  }

  let total = 0;
  let current = 0;
  const main = state.selection.main;
  forEachMatch(query, state, 0, state.doc.length, (match) => {
    total += 1;
    if (match.from === main.from && match.to === main.to) current = total;
  });
  return { current, total, error: null };
}

const controllers = new WeakMap<EditorView, FindReplaceController>();
const updateListeners = new WeakMap<EditorView, (update: ViewUpdate) => void>();

export function createFindReplaceController(
  view: EditorView,
  initial: FindReplaceOptions = EMPTY_FIND_OPTIONS,
): FindReplaceController {
  let open = false;
  let replaceVisible = false;
  let query = initial.query;
  let replacement = initial.replacement;
  let caseSensitive = initial.caseSensitive;
  let regexp = initial.regexp;
  let current = 0;
  let total = 0;
  let error: FindReplaceError | null = null;
  let focusToken = 0;
  let destroyed = false;
  const listeners = new Set<(state: FindReplaceState) => void>();
  let lastState: FindReplaceState | null = null;

  function snapshot(): FindReplaceState {
    return {
      open,
      replaceVisible,
      query,
      replacement,
      caseSensitive,
      regexp,
      current,
      total,
      error,
      focusToken,
    };
  }

  function emit() {
    const next = snapshot();
    const previous = lastState;
    if (
      previous !== null &&
      previous.open === next.open &&
      previous.replaceVisible === next.replaceVisible &&
      previous.query === next.query &&
      previous.replacement === next.replacement &&
      previous.caseSensitive === next.caseSensitive &&
      previous.regexp === next.regexp &&
      previous.current === next.current &&
      previous.total === next.total &&
      previous.error === next.error &&
      previous.focusToken === next.focusToken
    ) {
      return;
    }
    lastState = next;
    for (const listener of listeners) listener(next);
  }

  function buildQuery() {
    return new SearchQuery({
      search: query,
      caseSensitive,
      regexp,
      replace: replacement,
    });
  }

  function dispatchQuery() {
    if (destroyed) return;
    // A leftover search binding can still open CodeMirror's hidden panel.
    // Close its state so only Nicole's highlighter owns the match classes.
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    view.dispatch({ effects: setSearchQuery.of(buildQuery()) });
  }

  function refresh() {
    if (open) {
      const counts = countMatches(view.state);
      current = counts.current;
      total = counts.total;
      error = counts.error;
    } else {
      current = 0;
      total = 0;
      error = null;
    }
    emit();
  }

  function focus() {
    if (!open || destroyed) return;
    focusToken += 1;
    emit();
  }

  function openPanel(revealReplace: boolean) {
    if (destroyed) return;
    if (!open) {
      const range = view.state.selection.main;
      const singleLine =
        !range.empty &&
        view.state.doc.lineAt(range.from).number ===
          view.state.doc.lineAt(range.to).number;
      if (singleLine) {
        query = view.state.sliceDoc(range.from, range.to);
      }
    }
    open = true;
    replaceVisible = revealReplace;
    focusToken += 1;
    if (searchPanelOpen(view.state)) closeSearchPanel(view);
    view.dispatch({
      effects: [findPanelOpen.of(true), setSearchQuery.of(buildQuery())],
    });
    refresh();
  }

  function close() {
    if (destroyed || !open) return;
    open = false;
    replaceVisible = false;
    view.dispatch({ effects: findPanelOpen.of(false) });
    refresh();
    view.focus();
  }

  function handleUpdate(update: ViewUpdate) {
    if (destroyed || !open) return;
    if (
      update.docChanged ||
      update.selectionSet ||
      getSearchQuery(update.state) !== getSearchQuery(update.startState)
    ) {
      refresh();
    }
  }

  function move(direction: 1 | -1): boolean {
    if (destroyed) return false;
    if (!open && !queryUsable(view)) {
      openPanel(false);
      return true;
    }
    if (!queryUsable(view)) {
      focus();
      return true;
    }
    if (direction === 1) findNext(view);
    else findPrevious(view);
    if (open) refresh();
    return true;
  }

  const controller: FindReplaceController = {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    open: openPanel,
    close,
    focus,
    setQuery(value) {
      if (query === value) return;
      query = value;
      dispatchQuery();
      if (open) refresh();
    },
    setReplacement(value) {
      if (replacement === value) return;
      replacement = value;
      dispatchQuery();
      if (open) refresh();
    },
    setCaseSensitive(value) {
      if (caseSensitive === value) return;
      caseSensitive = value;
      dispatchQuery();
      if (open) refresh();
    },
    setRegexp(value) {
      if (regexp === value) return;
      regexp = value;
      dispatchQuery();
      if (open) refresh();
    },
    next: () => move(1),
    previous: () => move(-1),
    replace() {
      if (destroyed || !open || !queryUsable(view)) return false;
      const changed = replaceNext(view);
      if (changed) refresh();
      return changed;
    },
    replaceAll() {
      if (destroyed || !open || !queryUsable(view)) return false;
      const changed = replaceAll(view);
      if (changed) refresh();
      return changed;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      listeners.clear();
      controllers.delete(view);
      updateListeners.delete(view);
    },
  };

  controllers.set(view, controller);
  updateListeners.set(view, handleUpdate);
  view.dispatch({ effects: setSearchQuery.of(buildQuery()) });
  return controller;
}

/** Looks up the controller a command was invoked against. */
export function findControllerForTarget(
  target: CommandTarget | null | undefined,
): FindReplaceController | null {
  if (!(target instanceof EditorView)) return null;
  return controllers.get(target) ?? null;
}

/** Forwards every editor update to its controller; the editor owns the hook. */
export function notifyFindController(update: ViewUpdate) {
  updateListeners.get(update.view)?.(update);
}
