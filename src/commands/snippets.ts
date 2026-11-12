import { isolateHistory } from "@codemirror/commands";

import type { CommandDefinition } from "./types";

/** One user template as returned by the bounded workspace snapshot. */
export interface SnippetDefinition {
  readonly id: string;
  readonly label: string;
  readonly body: string;
}

const VARIABLE = /\{\{(date|cursor)\}\}/g;

/** Local calendar day, as the template sees it at execution time. */
export function localDateStamp(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Expands the two variables that affect the edit. Every {{cursor}} marker is
 * removed and the first one decides the final caret; without one the caret
 * goes to the end. All other text, including other brace sequences, stays
 * literal and is never evaluated.
 */
export function expandSnippet(
  body: string,
  date: Date = new Date(),
): { text: string; cursor: number } {
  const stamp = localDateStamp(date);
  let text = "";
  let cursor: number | null = null;
  let last = 0;

  for (const match of body.matchAll(VARIABLE)) {
    const index = match.index ?? 0;
    text += body.slice(last, index);
    if (match[1] === "date") {
      text += stamp;
    } else if (cursor === null) {
      cursor = text.length;
    }
    last = index + match[0].length;
  }
  text += body.slice(last);
  return { text, cursor: cursor ?? text.length };
}

/**
 * Turns one snapshot of user templates into ordinary editor commands. They
 * share the registry's CommandDefinition, search, recency and execution paths;
 * only the body and its stable namespaced id differ. Templates replace the
 * current selection, expand at run time and form one isolated undo step.
 */
export function createSnippetCommands(
  snippets: readonly SnippetDefinition[],
): CommandDefinition[] {
  return snippets.map((snippet) => ({
    id: snippet.id,
    label: snippet.label,
    group: "insert",
    scope: "editor",
    inSlashMenu: true,
    requiresWorkspace: true,
    requiresActiveMarkdown: true,
    run(context) {
      const target = context.view;
      if (target === null) return false;
      const { text, cursor } = expandSnippet(snippet.body);
      const range = target.state.selection.main;
      target.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + cursor },
        userEvent: "input.format",
        annotations: isolateHistory.of("full"),
      });
      return true;
    },
  }));
}
