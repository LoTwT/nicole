import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { SAMPLE_DOCUMENT } from "./sample";
import {
  chooseFolder,
  readFile,
  writeFile,
  type WorkspaceFolder,
} from "./services/workspace";

vi.mock("./services/app", () => ({
  getAppInfo: async () => ({
    version: "0.0.1",
    os: "test",
    arch: "test",
    goVersion: "go1.test",
  }),
}));

vi.mock("./services/workspace", () => ({
  chooseFolder: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) {
    throw new Error(`button ${label} not found`);
  }
  return found;
}

async function openFolder(files: string[]): Promise<HTMLSelectElement> {
  const folder: WorkspaceFolder = {
    root: "/notes",
    files,
    canceled: false,
  };
  vi.mocked(chooseFolder).mockResolvedValue(folder);
  button("打开文件夹").click();
  await settle();
  const select = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Markdown 文件"]',
  );
  if (!select) {
    throw new Error("file select not found");
  }
  return select;
}

function editorView(): EditorView {
  const editorDOM = host.querySelector<HTMLElement>(".cm-editor");
  if (!editorDOM) {
    throw new Error("editor not found");
  }
  const view = EditorView.findFromDOM(editorDOM);
  if (!view) {
    throw new Error("editor view not found");
  }
  return view;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.classList.remove("dark");
  localStorage.clear();

  vi.mocked(chooseFolder).mockReset();
  vi.mocked(readFile).mockReset();
  vi.mocked(writeFile).mockReset();
  vi.mocked(writeFile).mockResolvedValue(undefined);

  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  vi.useRealTimers();
});

describe("App", () => {
  it("keeps the editor DOM, selection and undo history when the theme changes", async () => {
    await nextTick();

    const editorDOM = host.querySelector<HTMLElement>(".cm-editor");
    expect(editorDOM).not.toBeNull();

    const view = EditorView.findFromDOM(editorDOM!);
    expect(view).not.toBeNull();

    view!.dispatch({
      changes: { from: 0, insert: "X" },
      selection: { anchor: 6, head: 10 },
    });
    await nextTick();

    const selection = view!.state.selection.main;
    const edited = view!.state.doc.toString();
    const themeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(themeButton).not.toBeNull();

    themeButton!.click();
    await nextTick();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(host.querySelector(".cm-editor")).toBe(editorDOM);
    expect(view!.state.selection.main.eq(selection)).toBe(true);
    expect(view!.state.doc.toString()).toBe(edited);

    undo(view!);
    expect(view!.state.doc.toString()).toBe(SAMPLE_DOCUMENT);
  });

  it("opens a folder and lists its Markdown files", async () => {
    const select = await openFolder(["a.md", "nested/b.md"]);

    expect(chooseFolder).toHaveBeenCalledOnce();
    expect(select.disabled).toBe(false);
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "a.md",
      "nested/b.md",
    ]);
  });

  it("loads the selected file into the editor", async () => {
    vi.mocked(readFile).mockResolvedValue("# second\n");
    const select = await openFolder(["a.md", "b.md"]);

    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    expect(readFile).toHaveBeenCalledWith("b.md");
    expect(editorView().state.doc.toString()).toBe("# second\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("saves once editing stops for about a second", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["note.md"]);

    select.value = "note.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "typed" } });
    expect(writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith("note.md", "start\ntyped");
    expect(host.textContent).toContain("已保存");
  });

  it("keeps CRLF line endings and a BOM when saving", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("\uFEFF# CRLF\r\nfirst\r\nsecond");
    const select = await openFolder(["windows.md"]);

    select.value = "windows.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(writeFile).toHaveBeenCalledWith(
      "windows.md",
      "\uFEFF# CRLF\r\nfirst\r\nsecond!",
    );
  });
});
