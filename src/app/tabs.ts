import { ChangeSet } from "@codemirror/state";

import type { SavedSelection, EditorRestoreState } from "../editor";
import type { LineEnding } from "./line-endings";
import { tabProblem, type SavePhase } from "./status";

export type TabKind = "workspace" | "single" | "preview";
export type ExternalTabState = "none" | "modified" | "deleted";

/**
 * The per-path document model. The editor view is disposable; text, save
 * state, line endings and the background restore state live here. Saves only
 * ever use this model's path, never whichever tab happens to be active.
 */
export interface TabModel {
  id: number;
  kind: TabKind;
  /** Workspace-relative for workspace/preview tabs, absolute for single files. */
  path: string;
  name: string;
  text: string;
  /** The text on disk, normalized to \n. Dirty means text differs from this. */
  originalText: string;
  lineEnding: LineEnding;
  mixedLineEndings: boolean;
  savePhase: SavePhase;
  saveError: string | null;
  saveErrorDetail: string | null;
  externalState: ExternalTabState;
  /** Bumped by every external event; a forced save captured an older value. */
  revision: number;
  /** Workspace generation captured when the tab was opened; 0 for single files. */
  generation: number;
  previewSize?: number;
  previewFolder?: string;
  /** Present while the tab is in the background. */
  snapshot: EditorRestoreState | null;
}

export function isDirty(model: TabModel): boolean {
  return model.text !== model.originalText;
}

export function isMarkdownTab(model: TabModel): boolean {
  return model.kind !== "preview";
}

export function tabBadge(model: TabModel): {
  tone: "danger" | "warning";
  label: string;
} | null {
  const tone = tabProblem(
    model.externalState === "deleted",
    model.mixedLineEndings,
    model.saveError !== null,
  );
  if (tone === null) {
    return null;
  }
  if (model.externalState === "deleted") {
    return { tone, label: "文件已在磁盘上被删除或移走" };
  }
  if (model.saveError !== null) {
    return { tone, label: "保存失败" };
  }
  return { tone, label: "换行风格混合" };
}

/**
 * The reasons a tab cannot be closed without discarding something. A save
 * failure or mixed endings always count, even if the text was undone back to
 * the disk version: the user still has to acknowledge the state.
 */
export function tabCloseProblems(model: TabModel): string[] {
  const problems: string[] = [];
  if (model.externalState === "deleted") {
    problems.push(`${model.name}：文件已在磁盘上被删除或移走`);
  } else if (model.externalState === "modified") {
    problems.push(`${model.name}：文件已在 Nicole 之外被修改`);
  }
  if (model.saveError !== null) {
    problems.push(`${model.name}：保存失败`);
  }
  if (model.mixedLineEndings) {
    problems.push(`${model.name}：换行风格混合`);
  }
  if (
    problems.length === 0 &&
    isDirty(model) &&
    model.externalState === "none"
  ) {
    problems.push(`${model.name}：有未保存的更改`);
  }
  return problems;
}

function shortName(path: string): string {
  const slash = path.replaceAll("\\", "/").lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

function parentName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Same-named files get a suffix. A workspace file uses its parent folder; a
 * single file uses the folder of its absolute path. Root files fall back to
 * the root name so the suffix is never empty.
 */
export function distinguishingSuffixes(
  tabs: readonly TabModel[],
  rootName: string,
): Map<number, string> {
  const counts = new Map<string, number>();
  for (const tab of tabs) {
    counts.set(tab.name, (counts.get(tab.name) ?? 0) + 1);
  }
  const suffixes = new Map<number, string>();
  for (const tab of tabs) {
    if ((counts.get(tab.name) ?? 0) < 2) {
      continue;
    }
    const folder = parentName(tab.path);
    suffixes.set(tab.id, folder === "" ? rootName : shortName(folder));
  }
  return suffixes;
}

export function tabTooltip(model: TabModel, rootName: string): string {
  return model.kind === "single"
    ? model.path
    : `${rootName}/${model.path}`;
}

/** New tabs open immediately to the right of the active tab. */
export function insertionIndex(
  tabs: readonly TabModel[],
  activeId: number | null,
): number {
  if (activeId === null) {
    return tabs.length;
  }
  const index = tabs.findIndex((tab) => tab.id === activeId);
  return index === -1 ? tabs.length : index + 1;
}

function lineStart(text: string, lineNumber: number): number {
  const target = Math.max(1, lineNumber);
  let position = 0;
  for (let line = 1; line < target; line++) {
    const next = text.indexOf("\n", position);
    if (next === -1) {
      return text.length;
    }
    position = next + 1;
  }
  return Math.min(position, text.length);
}

function lineNumberAt(text: string, position: number): number {
  const limit = Math.max(0, Math.min(position, text.length));
  let line = 1;
  for (let index = 0; index < limit; index++) {
    if (text[index] === "\n") {
      line++;
    }
  }
  return line;
}

function clamp(value: number, length: number): number {
  return Math.max(0, Math.min(length, value));
}

/**
 * Maps a background tab's selection and broken undo history to content loaded
 * from disk. The text is replaced as one change so a selection after an
 * insertion still points at the same words; history is dropped because it
 * describes transactions against the old document.
 */
export function mapSnapshotForReplacement(
  snapshot: EditorRestoreState | null,
  oldText: string,
  newText: string,
): EditorRestoreState | null {
  if (snapshot === null) {
    return null;
  }
  if (oldText === newText) {
    return snapshot;
  }
  let prefix = 0;
  const limit = Math.min(oldText.length, newText.length);
  while (prefix < limit && oldText[prefix] === newText[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }
  const changes = ChangeSet.of(
    {
      from: prefix,
      to: oldText.length - suffix,
      insert: newText.slice(prefix, newText.length - suffix),
    },
    oldText.length,
  );

  let selection: SavedSelection | null = null;
  if (
    snapshot.selection &&
    Array.isArray(snapshot.selection.ranges) &&
    snapshot.selection.ranges.length > 0
  ) {
    const ranges = snapshot.selection.ranges.map((range) => {
      const anchor = clamp(
        changes.mapPos(clamp(range.anchor, oldText.length)),
        newText.length,
      );
      const head = clamp(
        changes.mapPos(clamp(range.head ?? range.anchor, oldText.length)),
        newText.length,
      );
      return { anchor, head };
    });
    selection = {
      ranges,
      main: Math.min(
        Math.max(0, snapshot.selection.main),
        ranges.length - 1,
      ),
    };
  }

  const scrollTopLine =
    snapshot.scrollTopLine === null
      ? null
      : lineNumberAt(
          newText,
          changes.mapPos(
            lineStart(oldText, snapshot.scrollTopLine),
            1,
          ),
        );

  return {
    selection,
    history: null,
    scrollTopLine,
    scrollTopOffset: snapshot.scrollTopOffset,
  };
}
