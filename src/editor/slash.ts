import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import {
  Compartment,
  Prec,
  StateEffect,
  Transaction,
  type ChangeSet,
  type EditorState,
} from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import type { AppPlatform } from "../app/platform";
import {
  formatCommandShortcut,
  slashCommands as registeredSlashCommands,
} from "../commands/registry";
import {
  filterCommands,
  loadPinyinMatcher,
  readRecentCommandIds,
  rememberRecentCommandId,
  type CommandStorage,
  type PinyinMatcher,
} from "../commands/search";
import type {
  CommandDefinition,
  CommandTarget,
} from "../commands/types";

export const SLASH_MENU_WIDTH = 260;
export const SLASH_MENU_MAX_ITEMS = 8;
export const SLASH_MENU_MARGIN = 8;
const SLASH_MENU_GAP = 4;

const EXCLUDED_BLOCK_NODES = new Set(["FencedCode", "CodeBlock", "HTMLBlock"]);

export type SlashTrigger = "/" | "、";

export interface SlashAnchor {
  left: number;
  top: number;
  bottom: number;
}

export interface SlashMenuItem {
  id: string;
  label: string;
  glyph: string;
  shortcut: string | null;
}

export interface SlashMenuState {
  trigger: SlashTrigger;
  query: string;
  anchor: SlashAnchor;
  items: readonly SlashMenuItem[];
  selectedIndex: number;
}

export type SlashMenuSnapshot = SlashMenuState | null;

export interface SlashMenuOptions {
  view: EditorView;
  commands?: readonly CommandDefinition[];
  platform: AppPlatform;
  onChange: (state: SlashMenuSnapshot) => void;
  loadPinyin?: () => Promise<PinyinMatcher>;
  storage?: CommandStorage | null;
}

export interface SlashMenuController {
  /** Runs the item at the index (defaults to the current selection). */
  execute(index?: number): void;
  highlight(index: number): void;
  close(): void;
  destroy(): void;
}

export interface SlashMenuPlacement {
  left: number;
  top: number;
  placement: "above" | "below";
}

export interface Size {
  width: number;
  height: number;
}

/** Places the fixed menu below the cursor, flipping above when needed. */
export function placeSlashMenu(
  anchor: SlashAnchor,
  menu: Size,
  viewport: Size,
  margin = SLASH_MENU_MARGIN,
): SlashMenuPlacement {
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(anchor.left, margin), maxLeft);

  const below = anchor.bottom + SLASH_MENU_GAP;
  const above = anchor.top - SLASH_MENU_GAP - menu.height;
  let top = below;
  let placement: "above" | "below" = "below";

  if (below + menu.height > viewport.height - margin) {
    if (above >= margin) {
      top = above;
      placement = "above";
    } else {
      top = Math.max(margin, viewport.height - menu.height - margin);
    }
  }
  if (top < margin) top = margin;

  return { left, top, placement };
}

function isTriggerCharacter(text: string): text is SlashTrigger {
  return text === "/" || text === "、";
}

function frontmatterEnd(state: EditorState): number | null {
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

function inExcludedBlock(
  state: EditorState,
  position: number,
  bias: -1 | 1,
): boolean {
  let node = syntaxTree(state).resolveInner(position, bias);
  for (;;) {
    if (node.name === "InlineCode") {
      if (node.from < position && position < node.to) return true;
    } else if (
      EXCLUDED_BLOCK_NODES.has(node.name) &&
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

function inExcludedContext(state: EditorState, position: number): boolean {
  const frontmatter = frontmatterEnd(state);
  if (frontmatter !== null && position < frontmatter) return true;

  if (inExcludedBlock(state, position, 1)) return true;
  // At the very end there is no character on the right to resolve against.
  // Looking left finds an unclosed fenced/indented/HTML block whose node ends
  // exactly at the document end. A closed fenced block ends before a trailing
  // newline, so its closing fence is not mistaken for content.
  return position === state.doc.length
    ? inExcludedBlock(state, position, -1)
    : false;
}

export function createSlashMenu(options: SlashMenuOptions): SlashMenuController {
  const { view, platform, onChange, storage } = options;
  const commands = options.commands ?? registeredSlashCommands();
  const loadPinyin = options.loadPinyin ?? loadPinyinMatcher;
  const compartment = new Compartment();

  let open = false;
  let triggerPosition = -1;
  let queryEnd = -1;
  let triggerCharacter: SlashTrigger = "/";
  let query = "";
  let selectedIndex = 0;
  let matches: readonly CommandDefinition[] = [];
  let items: readonly SlashMenuItem[] = [];
  let pinyinMatcher: PinyinMatcher | null = null;
  let pinyinLoading = false;
  let recentIds = readRecentCommandIds(storage);
  let destroyed = false;
  let imeKeyPending = false;
  let imeKeyTimer: ReturnType<typeof setTimeout> | null = null;

  function anchorAtCursor(): SlashAnchor {
    const position = view.state.selection.main.head;
    const coords = view.coordsAtPos(position);
    if (coords) {
      return { left: coords.left, top: coords.top, bottom: coords.bottom };
    }
    const fallback = view.dom.getBoundingClientRect();
    return { left: fallback.left, top: fallback.bottom, bottom: fallback.bottom };
  }

  function snapshot(): SlashMenuState | null {
    if (!open) return null;
    return {
      trigger: triggerCharacter,
      query,
      anchor: anchorAtCursor(),
      items,
      selectedIndex,
    };
  }

  function emit() {
    onChange(snapshot());
  }

  function close() {
    if (!open) return;
    open = false;
    triggerPosition = -1;
    queryEnd = -1;
    query = "";
    matches = [];
    items = [];
    onChange(null);
  }

  function composing(): boolean {
    return imeKeyPending || view.compositionStarted || view.composing;
  }

  function refresh() {
    if (!open || destroyed) return;
    const filtered = filterCommands(commands, query, {
      matcher: pinyinMatcher,
      recentIds,
    });
    matches = filtered.slice(0, SLASH_MENU_MAX_ITEMS);
    items = matches.map((command) => ({
      id: command.id,
      label: command.label,
      glyph: command.glyph ?? command.label.slice(0, 2),
      shortcut: formatCommandShortcut(command, platform),
    }));

    if (matches.length === 0) {
      const waitingForPinyin =
        query !== "" && pinyinMatcher === null && pinyinLoading;
      if (!waitingForPinyin && !composing()) {
        close();
        return;
      }
    }

    if (selectedIndex >= items.length) {
      selectedIndex = Math.max(0, items.length - 1);
    }
    emit();
  }

  function openAt(position: number, character: SlashTrigger) {
    if (destroyed) return;
    open = true;
    triggerPosition = position;
    queryEnd = position + 1;
    triggerCharacter = character;
    query = "";
    selectedIndex = 0;
    matches = [];
    items = [];
    refresh();
    if (!pinyinMatcher && !pinyinLoading) {
      pinyinLoading = true;
      void loadPinyin()
        .then((matcher) => {
          pinyinMatcher = matcher;
        })
        .catch(() => {
          // Search still works for labels and aliases without pinyin.
        })
        .finally(() => {
          pinyinLoading = false;
          if (open) refresh();
        });
    }
  }

  function maybeOpen(update: ViewUpdate) {
    // Pasting or programmatic insertion at a valid position is not typing a
    // slash; only direct input (including IME output) opens the menu.
    if (!update.transactions.some((tr) => tr.isUserEvent("input.type"))) {
      return;
    }
    let changes = 0;
    const candidates: { position: number; character: SlashTrigger }[] = [];
    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      changes++;
      if (fromA !== toA || toB - fromB !== 1) return;
      const text = inserted.toString();
      if (isTriggerCharacter(text)) {
        candidates.push({ position: fromA, character: text });
      }
    });
    const candidate = candidates[0];
    if (changes !== 1 || !candidate) return;

    // Use the state before the slash was typed so the surrounding Markdown
    // block is still the one the user was editing.
    const state = update.startState;
    const line = state.doc.lineAt(candidate.position);
    const previous =
      candidate.position > 0
        ? state.sliceDoc(candidate.position - 1, candidate.position)
        : "";
    if (candidate.position !== line.from && previous !== " ") return;
    if (inExcludedContext(state, candidate.position)) return;
    openAt(candidate.position, candidate.character);
  }

  function syncFromView(update?: ViewUpdate) {
    if (!open) return;
    const state = view.state;
    const range = state.selection.main;
    if (!range.empty) {
      if (composing()) return;
      close();
      return;
    }
    const head = range.head;
    if (update && !update.docChanged && head !== queryEnd) {
      if (composing()) return;
      close();
      return;
    }
    const offTrigger =
      triggerPosition < 0 ||
      head <= triggerPosition ||
      state.sliceDoc(triggerPosition, triggerPosition + 1) !==
        triggerCharacter ||
      state.doc.lineAt(head).number !==
        state.doc.lineAt(triggerPosition).number;
    if (offTrigger) {
      // Candidate-window keys can move the selection or (in synthetic input)
      // insert text. Wait for compositionend before deciding to close.
      if (composing()) return;
      close();
      return;
    }
    const nextQuery = state.sliceDoc(triggerPosition + 1, head);
    if (/\s/.test(nextQuery)) {
      if (composing()) return;
      close();
      return;
    }
    if (nextQuery !== query) {
      query = nextQuery;
      selectedIndex = 0;
    }
    queryEnd = head;
    refresh();
  }

  function execute(index = selectedIndex) {
    if (!open || composing()) return;
    const command = matches[index];
    if (!command) return;
    const state = view.state;
    const range = state.selection.main;
    if (
      !range.empty ||
      range.head <= triggerPosition ||
      range.head !== queryEnd
    ) {
      close();
      return;
    }
    if (
      state.sliceDoc(triggerPosition, triggerPosition + 1) !== triggerCharacter
    ) {
      close();
      return;
    }

    const from = triggerPosition;
    const deletion = state.update({
      changes: { from, to: queryEnd, insert: "" },
      selection: { anchor: from },
    });
    let targetState = deletion.state;
    const capture = {
      changes: null as ChangeSet | null,
      effects: [] as StateEffect<unknown>[],
    };
    const target: CommandTarget = {
      get state() {
        return targetState;
      },
      dispatch(...specs) {
        for (const spec of specs) {
          const transaction = targetState.update(spec);
          if (!transaction.changes.empty) {
            capture.changes = capture.changes
              ? capture.changes.compose(transaction.changes)
              : transaction.changes;
          }
          capture.effects.push(...transaction.effects);
          targetState = transaction.state;
        }
      },
    };

    command.run({ view: target, platform });
    open = false;
    triggerPosition = -1;
    queryEnd = -1;
    onChange(null);

    const changes = capture.changes
      ? deletion.changes.compose(capture.changes)
      : deletion.changes;
    view.dispatch({
      changes,
      selection: targetState.selection,
      ...(capture.effects.length > 0 ? { effects: capture.effects } : {}),
      userEvent: "input.format",
      annotations: isolateHistory.of("full"),
    });
    recentIds = rememberRecentCommandId(command.id, storage);
    view.focus();
  }

  function handleMenuKey(
    key: "Escape" | "ArrowUp" | "ArrowDown" | "Enter",
  ): boolean {
    if (!open) return false;
    if (composing()) return false;
    if (key === "Escape") {
      close();
      return true;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      if (items.length > 0) {
        const direction = key === "ArrowDown" ? 1 : -1;
        selectedIndex =
          (selectedIndex + direction + items.length) % items.length;
        emit();
      }
      return true;
    }
    if (items.length > 0) execute(selectedIndex);
    return true;
  }

  function markImeKey() {
    imeKeyPending = true;
    if (imeKeyTimer !== null) clearTimeout(imeKeyTimer);
    imeKeyTimer = setTimeout(() => {
      imeKeyTimer = null;
      imeKeyPending = false;
      if (open) syncFromView();
    }, 0);
  }

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      if (open) {
        triggerPosition = update.changes.mapPos(triggerPosition, -1);
        queryEnd = update.changes.mapPos(queryEnd, 1);
        if (!composing()) {
          const userEvents = update.transactions.map((tr) =>
            tr.annotation(Transaction.userEvent),
          );
          if (
            userEvents.some(
              (event) =>
                !event ||
                event.startsWith("undo") ||
                event.startsWith("redo"),
            )
          ) {
            close();
            return;
          }
        }
        syncFromView(update);
      } else {
        maybeOpen(update);
      }
      return;
    }
    if (update.selectionSet) syncFromView(update);
  });

  // The menu must see these keys before basicSetup's editor bindings. A DOM
  // handler rather than a keymap keeps `isComposing`/keyCode 229 in the same
  // decision and leaves every key untouched while an IME owns it.
  const menuKeys = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event) {
        if (!open) return false;
        if (event.keyCode === 229) {
          markImeKey();
          return false;
        }
        if (event.isComposing || composing()) {
          return false;
        }
        if (
          event.key === "Escape" ||
          event.key === "ArrowUp" ||
          event.key === "ArrowDown" ||
          event.key === "Enter"
        ) {
          return handleMenuKey(event.key);
        }
        return false;
      },
    }),
  );

  view.dispatch({
    effects: StateEffect.appendConfig.of(
      compartment.of([updateListener, menuKeys]),
    ),
  });

  const compositionEnd = () => {
    if (imeKeyTimer !== null) {
      clearTimeout(imeKeyTimer);
      imeKeyTimer = null;
    }
    imeKeyPending = false;
    queueMicrotask(() => {
      if (open) syncFromView();
    });
  };
  const blur = () => {
    if (open) close();
  };
  view.contentDOM.addEventListener("compositionend", compositionEnd);
  view.contentDOM.addEventListener("blur", blur);

  return {
    execute,
    highlight(index) {
      if (!open || items.length === 0) return;
      selectedIndex = Math.min(Math.max(index, 0), items.length - 1);
      emit();
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      open = false;
      if (imeKeyTimer !== null) clearTimeout(imeKeyTimer);
      imeKeyTimer = null;
      imeKeyPending = false;
      view.contentDOM.removeEventListener("compositionend", compositionEnd);
      view.contentDOM.removeEventListener("blur", blur);
      view.dispatch({ effects: compartment.reconfigure([]) });
      onChange(null);
    },
  };
}
