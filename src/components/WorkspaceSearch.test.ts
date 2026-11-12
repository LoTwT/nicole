import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ searchWorkspace: vi.fn() }));

vi.mock("../services/search", () => ({
  searchWorkspace: mocks.searchWorkspace,
}));

import type {
  SearchMatch,
  SearchPart,
  SearchRequest,
} from "../services/mygo";
import type { SearchSummary } from "../services/search";
import { searchFingerprint } from "../app/workspace-search";
import WorkspaceSearch from "./WorkspaceSearch.vue";

interface FakeSession {
  request: SearchRequest;
  onLine: (part: SearchPart) => void;
  resolve: (summary: SearchSummary) => void;
  reject: (error: unknown) => void;
  close: ReturnType<typeof vi.fn>;
  result: Promise<SearchSummary>;
}

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;
let sessions: FakeSession[] = [];
let closes = 0;
let targets: Array<import("../app/workspace-search").SearchOpenTarget> = [];

async function settle() {
  for (let index = 0; index < 8; index++) await nextTick();
}

function mount(generation = 1) {
  const Component = defineComponent({
    setup() {
      return () =>
        h(WorkspaceSearch, {
          generation,
          onClose: () => {
            closes += 1;
          },
          onOpenResult: (
            target: import("../app/workspace-search").SearchOpenTarget,
          ) => {
            targets.push(target);
          },
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
}

function input(): HTMLInputElement {
  const found = host.querySelector<HTMLInputElement>(
    'input[aria-label="搜索工作区"]',
  );
  if (!found) throw new Error("search input not found");
  return found;
}

function typeQuery(value: string) {
  const field = input();
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function button(selector: string): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found;
}

const match = (
  column: number,
  text: string,
  highlightStart = 0,
): SearchMatch => ({
  column,
  length: text.length,
  fingerprint: searchFingerprint(text),
  endLine: 1,
  endLineFingerprint: searchFingerprint(text),
  startsAtDocumentStart: false,
  startsAtLineStart: false,
  endsAtDocumentEnd: false,
  endsAtLineEnd: false,
  highlightStart,
  highlightEnd: highlightStart + text.length,
});

function linePart(
  path: string,
  line: number,
  text: string,
  matches: SearchMatch[],
): SearchPart {
  return {
    type: "line",
    path,
    line,
    text,
    lineFingerprint: searchFingerprint(text),
    matches,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector<HTMLElement>("#app")!;
  sessions = [];
  closes = 0;
  targets = [];
  vi.clearAllMocks();
  mocks.searchWorkspace.mockImplementation(
    (request: SearchRequest, onLine: (part: SearchPart) => void) => {
      let resolve!: (summary: SearchSummary) => void;
      let reject!: (error: unknown) => void;
      const result = new Promise<SearchSummary>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      const session: FakeSession = {
        request,
        onLine,
        resolve,
        reject,
        close: vi.fn(),
        result,
      };
      sessions.push(session);
      return { result, close: session.close };
    },
  );
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("WorkspaceSearch", () => {
  it("focuses the input and waits for a query", async () => {
    mount();
    await settle();
    expect(document.activeElement).toBe(input());
    expect(host.textContent).toContain("输入内容开始搜索");
    expect(mocks.searchWorkspace).not.toHaveBeenCalled();
    expect(closes).toBe(0);
  });

  it("starts a search with the generation and option flags", async () => {
    mount(7);
    await settle();
    typeQuery("needle");
    await settle();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.request).toEqual({
      generation: 7,
      query: "needle",
      caseSensitive: false,
      regex: false,
    });

    button("[data-search-case]").click();
    await settle();
    expect(sessions).toHaveLength(2);
    expect(sessions[1]!.request.caseSensitive).toBe(true);
    expect(button("[data-search-case]").getAttribute("aria-pressed")).toBe(
      "true",
    );

    button("[data-search-regex]").click();
    await settle();
    expect(sessions).toHaveLength(3);
    expect(sessions[2]!.request.regex).toBe(true);
    expect(sessions[1]!.close).toHaveBeenCalled();
  });

  it("streams grouped lines before the summary and highlights matches", async () => {
    mount();
    await settle();
    typeQuery("needle");
    await settle();
    const session = sessions[0]!;
    session.onLine(
      linePart("notes/daily.md", 2, "needle and needle", [
        match(0, "needle", 0),
        match(11, "needle", 11),
      ]),
    );
    await settle();
    expect(host.textContent).toContain("正在搜索");
    expect(host.querySelectorAll("[data-search-path]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-search-result]")).toHaveLength(1);
    expect(host.querySelectorAll("mark")).toHaveLength(2);
    const firstResult = button("[data-search-result]");
    expect(firstResult.getAttribute("aria-label")).toContain(
      "notes/daily.md 第 2 行",
    );
    expect(firstResult.getAttribute("aria-label")).toContain("needle");
    const status = host.querySelector('[role="status"][aria-live="polite"]');
    expect(status?.textContent).toContain("正在搜索");

    session.onLine(
      linePart("notes/daily.md", 4, "another needle", [match(8, "needle", 8)]),
    );
    session.onLine(
      linePart("README.md", 1, "needle", [match(0, "needle", 0)]),
    );
    await settle();
    const groups = [...host.querySelectorAll("[data-search-path]")].map(
      (group) => group.getAttribute("data-search-path"),
    );
    expect(groups).toEqual(["notes/daily.md", "README.md"]);
    expect(host.querySelectorAll("[data-search-result]")).toHaveLength(3);
    expect(host.textContent).toContain("daily.md");
    expect(host.textContent).toContain("notes");

    session.resolve({ files: 2, matches: 4, truncated: false });
    await settle();
    expect(host.textContent).toContain("2 个文件中有 4 处结果");
    expect(host.textContent).not.toContain("正在搜索");
  });

  it("distinguishes no results, truncation and real errors", async () => {
    mount();
    await settle();
    typeQuery("missing");
    sessions[0]!.resolve({ files: 0, matches: 0, truncated: false });
    await settle();
    expect(host.textContent).toContain("0 个文件中有 0 处结果");

    typeQuery("many");
    sessions[1]!.resolve({ files: 1, matches: 1000, truncated: true });
    await settle();
    expect(host.textContent).toContain("结果过多，请缩小范围");

    typeQuery("(");
    button("[data-search-regex]").click();
    await settle();
    sessions[3]!.reject(
      new Error(
        "workspace: invalid search pattern: error parsing regexp: missing closing )",
      ),
    );
    await settle();
    expect(host.textContent).toContain(
      "正则表达式无效：error parsing regexp: missing closing )",
    );
  });

  it("keeps partial results but marks a failed search as an error", async () => {
    mount();
    await settle();
    typeQuery("needle");
    const session = sessions[0]!;
    session.onLine(linePart("a.md", 1, "needle", [match(0, "needle")]));
    await settle();
    session.reject(new Error("workspace: read failed"));
    await settle();
    expect(host.textContent).toContain("a.md");
    expect(host.textContent).toContain("搜索失败：read failed");
    expect(host.textContent).not.toContain("个文件中有");
  });

  it("ignores late results and errors from an older query", async () => {
    mount();
    await settle();
    typeQuery("a");
    await settle();
    const first = sessions[0]!;
    typeQuery("ab");
    await settle();
    const second = sessions[1]!;
    expect(first.close).toHaveBeenCalled();

    first.onLine(linePart("old.md", 1, "old", [match(0, "old")]));
    first.resolve({ files: 1, matches: 1, truncated: false });
    await settle();
    expect(host.textContent).not.toContain("old.md");
    expect(host.textContent).toContain("正在搜索");

    second.onLine(linePart("new.md", 1, "new", [match(0, "new")]));
    await settle();
    expect(host.textContent).toContain("new.md");
    first.reject(new Error("workspace: read failed"));
    await settle();
    expect(host.textContent).not.toContain("搜索失败");
  });

  it("closes on an emptied input but not on the initial empty view", async () => {
    mount();
    await settle();
    typeQuery("needle");
    await settle();
    expect(closes).toBe(0);
    const session = sessions[0]!;
    input().value = "";
    input().dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(closes).toBe(1);
    expect(session.close).toHaveBeenCalled();
    expect(host.textContent).toContain("输入内容开始搜索");
  });

  it("does not search composition text and starts after composition ends", async () => {
    mount();
    await settle();
    const field = input();
    field.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    field.value = "pin";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(mocks.searchWorkspace).not.toHaveBeenCalled();

    field.value = "拼音";
    field.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await settle();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.request.query).toBe("拼音");
  });

  it("emits the selected line and match for the normal open flow", async () => {
    mount(4);
    await settle();
    typeQuery("needle");
    await settle();
    sessions[0]!.onLine(
      linePart("notes/daily.md", 2, "needle and needle", [
        match(0, "needle", 0),
        match(11, "needle", 11),
      ]),
    );
    await settle();
    const marks = host.querySelectorAll<HTMLElement>("mark[data-search-match]");
    expect(marks).toHaveLength(2);
    marks[1]!.click();
    expect(targets).toHaveLength(1);
    expect(targets[0]!.generation).toBe(4);
    expect(targets[0]!.line.path).toBe("notes/daily.md");
    expect(targets[0]!.line.line).toBe(2);
    expect(targets[0]!.match.column).toBe(11);
    expect(targets[0]!.match.fingerprint).toBe(searchFingerprint("needle"));
  });

  it("cancels the channel when the view is destroyed", async () => {
    mount();
    await settle();
    typeQuery("needle");
    await settle();
    const session = sessions[0]!;
    app?.unmount();
    app = null;
    expect(session.close).toHaveBeenCalled();
  });
});
