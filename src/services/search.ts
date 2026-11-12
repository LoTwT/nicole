import { Channel } from "mygo-runtime";

import {
  Workspace,
  type SearchPart,
  type SearchRequest,
} from "./mygo";

export type { SearchPart, SearchRequest };

/** The final counts of a completed search. */
export interface SearchSummary {
  files: number;
  matches: number;
  truncated: boolean;
}

/** A running workspace search. */
export interface WorkspaceSearch {
  /**
   * Resolves when Go sends its done part and rejects when the search fails.
   * It stays pending after close(), because a canceled search has no result.
   */
  result: Promise<SearchSummary>;
  /** Stops the scan; late parts and errors are ignored. */
  close(): void;
}

/**
 * Streams matching lines from the open workspace until Go sends done. Closing
 * the channel cancels the Go call, so a new query stops the old scan instead
 * of letting it run beside the new one.
 */
export function searchWorkspace(
  request: SearchRequest,
  onLine: (part: SearchPart) => void,
): WorkspaceSearch {
  const parts = new Channel<SearchPart>();
  let donePart: SearchPart | null = null;
  let canceled = false;
  let settled = false;
  let resolveResult!: (summary: SearchSummary) => void;
  let rejectResult!: (reason: unknown) => void;
  const result = new Promise<SearchSummary>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const finish = (summaryPart: SearchPart) => {
    if (settled) return;
    settled = true;
    resolveResult({
      files: summaryPart.fileCount ?? 0,
      matches: summaryPart.matchCount ?? 0,
      truncated: summaryPart.truncated === true,
    });
  };

  Workspace.search(request, parts)
    .then(() => {
      if (settled) return;
      if (donePart !== null) {
        finish(donePart);
        return;
      }
      if (!canceled) {
        settled = true;
        rejectResult(new Error("workspace: search ended without a result"));
      }
    })
    .catch((error: unknown) => {
      if (canceled || settled) return;
      settled = true;
      rejectResult(error);
    })
    .finally(() => {
      parts.close();
    });

  parts.onmessage = (part) => {
    if (canceled) return;
    if (part.type === "line") {
      if (!settled) onLine(part);
      return;
    }
    if (part.type === "done") {
      donePart = part;
      finish(part);
    }
  };

  return {
    result,
    close: () => {
      if (canceled) return;
      canceled = true;
      parts.close();
    },
  };
}
