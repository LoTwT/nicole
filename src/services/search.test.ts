import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  channels: [] as Array<{
    onmessage: ((value: unknown) => void) | null;
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("mygo-runtime", () => ({
  Channel: class {
    onmessage: ((value: unknown) => void) | null = null;
    close = vi.fn();

    constructor(onmessage?: (value: unknown) => void) {
      this.onmessage = onmessage ?? null;
      runtimeMocks.channels.push(this);
    }
  },
}));

const mygoMocks = vi.hoisted(() => ({ search: vi.fn() }));

vi.mock("./mygo", () => ({
  Workspace: { search: mygoMocks.search },
}));

import type { SearchPart, SearchRequest } from "./mygo";
import { searchWorkspace } from "./search";

const request: SearchRequest = {
  generation: 3,
  query: "needle",
  caseSensitive: false,
  regex: false,
};

const linePart: SearchPart = {
  type: "line",
  path: "notes.md",
  line: 2,
  text: "a needle",
  matches: [
    {
      start: 2,
      end: 8,
      text: "needle",
      length: 6,
      highlightStart: 2,
      highlightEnd: 8,
    },
  ],
};

function channel() {
  const current = runtimeMocks.channels.at(-1);
  if (!current) throw new Error("channel was not created");
  return current;
}

beforeEach(() => {
  runtimeMocks.channels.length = 0;
  vi.clearAllMocks();
});

describe("searchWorkspace", () => {
  it("forwards line parts and resolves with the done summary", async () => {
    let finishCall!: () => void;
    const call = new Promise<void>((resolve) => {
      finishCall = resolve;
    });
    mygoMocks.search.mockReturnValue(call);
    const lines: SearchPart[] = [];
    const search = searchWorkspace(request, (part) => lines.push(part));
    const parts = channel();

    expect(mygoMocks.search).toHaveBeenCalledWith(request, parts);
    parts.onmessage?.(linePart);
    expect(lines).toEqual([linePart]);

    parts.onmessage?.({
      type: "done",
      fileCount: 2,
      matchCount: 3,
      truncated: true,
    });
    await expect(search.result).resolves.toEqual({
      files: 2,
      matches: 3,
      truncated: true,
    });
    finishCall();
    await call;
    await vi.waitFor(() => expect(parts.close).toHaveBeenCalled());
  });

  it("rejects with a real search error", async () => {
    mygoMocks.search.mockRejectedValue(new Error("workspace: read failed"));
    const search = searchWorkspace(request, () => {});
    await expect(search.result).rejects.toThrow("workspace: read failed");
  });

  it("rejects when the call ends without a done part", async () => {
    mygoMocks.search.mockResolvedValue(undefined);
    const search = searchWorkspace(request, () => {});
    await expect(search.result).rejects.toThrow(
      "workspace: search ended without a result",
    );
  });

  it("closes the channel and ignores results after cancellation", async () => {
    let finishCall!: () => void;
    const call = new Promise<void>((resolve) => {
      finishCall = resolve;
    });
    mygoMocks.search.mockReturnValue(call);
    const lines: SearchPart[] = [];
    const search = searchWorkspace(request, (part) => lines.push(part));
    const parts = channel();

    search.close();
    expect(parts.close).toHaveBeenCalled();
    parts.onmessage?.(linePart);
    parts.onmessage?.({ type: "done", fileCount: 1, matchCount: 1 });
    finishCall();
    await call;
    expect(lines).toEqual([]);
    const state = await Promise.race([
      search.result.then(() => "settled"),
      Promise.resolve("pending"),
    ]);
    expect(state).toBe("pending");
  });

  it("ignores an old call error after cancellation", async () => {
    let failCall!: (error: unknown) => void;
    const call = new Promise<void>((_resolve, reject) => {
      failCall = reject;
    });
    mygoMocks.search.mockReturnValue(call);
    const search = searchWorkspace(request, () => {});
    search.close();
    failCall(new Error("workspace: channel closed"));
    await call.catch(() => {});
    const state = await Promise.race([
      search.result.then(() => "settled"),
      Promise.resolve("pending"),
    ]);
    expect(state).toBe("pending");
  });
});
