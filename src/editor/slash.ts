import { Compartment, Prec, StateEffect } from "@codemirror/state";
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
import type { CommandDefinition } from "../commands/types";

export const SLASH_MENU_WIDTH = 260;
export const SLASH_MENU_MAX_ITEMS = 8;
export const SLASH_MENU_MARGIN = 8;
const SLASH_MENU_GAP = 4;

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

export function createSlashMenu(options: SlashMenuOptions): SlashMenuController {
  const { view, platform, onChange, storage } = options;
  const commands = options.commands ?? registeredSlashCommands();
  const loadPinyin = options.loadPinyin ?? loadPinyinMatcher;
  const compartment = new Compartment();

  let open = false;
  let triggerPosition = -1;
  let triggerCharacter: SlashTrigger = "/";
  let query = "";
  let selectedIndex = 0;
  let matches: readonly CommandDefinition[] = [];
  let items: readonly SlashMenuItem[] = [];
  let pinyinMatcher: PinyinMatcher | null = null;
  let pinyinLoading = false;
  let recentIds = readRecentCommandIds(storage);
  let destroyed = false;

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
    query = "";
    matches = [];
    items = [];
    onChange(null);
  }

  function composing(): boolean {
    return view.compositionStarted || view.composing;
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
        candidates.push({ position: fromB, character: text });
      }
    });
    const candidate = candidates[0];
    if (changes !== 1 || !candidate) return;

    const state = view.state;
    const line = state.doc.lineAt(candidate.position);
    const previous =
      candidate.position > 0
        ? state.sliceDoc(candidate.position - 1, candidate.position)
        : "";
    if (candidate.position !== line.from && previous !== " ") return;
    openAt(candidate.position, candidate.character);
  }

  function syncFromView() {
    if (!open) return;
    const state = view.state;
    const range = state.selection.main;
    if (!range.empty) {
      if (composing()) return;
      close();
      return;
    }
    const head = range.head;
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
    query = state.sliceDoc(triggerPosition + 1, head);
    refresh();
  }

  function execute(index = selectedIndex) {
    if (!open || composing()) return;
    const command = matches[index];
    if (!command) return;
    const state = view.state;
    const range = state.selection.main;
    if (!range.empty || range.head <= triggerPosition) {
      close();
      return;
    }
    if (state.sliceDoc(triggerPosition, triggerPosition + 1) !== triggerCharacter) {
      close();
      return;
    }

    // Close before dispatching so the deletion update cannot reopen or close
    // the menu again. Every other close path keeps the query in the document.
    const from = triggerPosition;
    open = false;
    triggerPosition = -1;
    onChange(null);
    view.dispatch({
      changes: { from, to: range.head, insert: "" },
      selection: { anchor: from },
    });
    recentIds = rememberRecentCommandId(command.id, storage);
    command.run({ view, platform });
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

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      if (open) {
        syncFromView();
      } else {
        maybeOpen(update);
      }
      return;
    }
    if (update.selectionSet) syncFromView();
  });

  // The menu must see these keys before basicSetup's editor bindings. A DOM
  // handler rather than a keymap keeps `isComposing`/keyCode 229 in the same
  // decision and leaves every key untouched while an IME owns it.
  const menuKeys = Prec.highest(
    EditorView.domEventHandlers({
      keydown(event) {
        if (!open) return false;
        if (event.isComposing || event.keyCode === 229 || composing()) {
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
    queueMicrotask(() => {
      if (open) syncFromView();
    });
  };
  view.contentDOM.addEventListener("compositionend", compositionEnd);

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
      view.contentDOM.removeEventListener("compositionend", compositionEnd);
      view.dispatch({ effects: compartment.reconfigure([]) });
      onChange(null);
    },
  };
}
