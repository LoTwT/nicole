import { historyKeymap, redo, undo } from "@codemirror/commands";
import type { CommandDefinition } from "./types";
import type { EditorView } from "@codemirror/view";

function composing(view: unknown) {
  const editor = view as EditorView;
  return editor.compositionStarted || editor.composing;
}
export const historyCommands: readonly CommandDefinition[] = [
  {
    id: "edit.undo",
    label: "撤销",
    scope: "editor",
    group: "app",
    keys: historyKeymap.filter((binding) => binding.run === undo),
    run: ({ view }) =>
      view === null || composing(view) ? false : undo(view as Parameters<typeof undo>[0]),
  },
  {
    id: "edit.redo",
    label: "重做",
    scope: "editor",
    group: "app",
    keys: historyKeymap.filter((binding) => binding.run === redo),
    run: ({ view }) =>
      view === null || composing(view) ? false : redo(view as Parameters<typeof redo>[0]),
  },
];
