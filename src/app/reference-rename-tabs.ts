import { EditorState } from "@codemirror/state";
import { history, historyField, isolateHistory } from "@codemirror/commands";
import type { EditorRestoreState } from "../editor/types";
import { mapSnapshotForReplacement } from "./tabs";
import type { ReferenceDocumentUpdate } from "./link-references";

/** Background tabs receive the same single history step without mounting another view. */
export function referenceUpdatedSnapshot(snapshot: EditorRestoreState | null, update: ReferenceDocumentUpdate): EditorRestoreState | null {
  if (!snapshot || !update.edits.length) return snapshot;
  const mapped = mapSnapshotForReplacement(snapshot, update.content, update.updatedContent)!;
  const state = EditorState.fromJSON({
    doc: update.content,
    ...(snapshot.selection ? { selection: snapshot.selection } : {}),
    ...(snapshot.history ? { history: snapshot.history } : {}),
  }, { extensions: [history()] }, { history: historyField });
  const next = state.update({
    changes: update.edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.after })),
    annotations: isolateHistory.of("full"), userEvent: "input.references",
  }).state;
  return { ...mapped, selection: next.selection.toJSON(), history: next.toJSON({ history: historyField }).history };
}
