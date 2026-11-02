import { Channel } from "mygo-runtime";

import {
  Workspace,
  type FileWatchPart,
  type WorkspaceFileEvent,
} from "./mygo";

export type { WorkspaceFileEvent };

/** A running workspace watch. */
export interface WorkspaceWatcher {
  /** Resolves once Go watches the whole tree. */
  ready: Promise<void>;
  /** Resolves when the watch ends; rejects with what stopped it. */
  closed: Promise<void>;
  /** Stops the watch. Events already taken are not delivered again. */
  close(): void;
}

/**
 * Streams changes in the open workspace that Nicole did not make itself.
 * Hidden folders and node_modules are not watched, while non-Markdown files
 * are reported.
 */
export function watchWorkspace(
  generation: number,
  onEvents: (events: WorkspaceFileEvent[]) => void,
): WorkspaceWatcher {
  const parts = new Channel<FileWatchPart>();
  let resolveReady!: () => void;
  let rejectReady!: (reason?: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const closed = Workspace.watch(generation, parts)
    .catch((error: unknown) => {
      rejectReady(error);
      throw error;
    })
    .finally(() => parts.close());

  parts.onmessage = (part) => {
    if (part.type === "ready") {
      resolveReady();
      return;
    }
    if (part.type === "events") {
      onEvents(part.events ?? []);
    }
  };

  return {
    ready,
    closed,
    close: () => parts.close(),
  };
}
