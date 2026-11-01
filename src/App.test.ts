import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { SAMPLE_DOCUMENT } from "./sample";
import {
  chooseFolder,
  finishClose,
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

const workspaceMock = vi.hoisted(() => ({
  saveBeforeClose: null as null | (() => Promise<void>),
}));

vi.mock("./services/workspace", () => ({
  chooseFolder: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  onSaveBeforeClose: (handler: () => Promise<void>) => {
    workspaceMock.saveBeforeClose = handler;
    return () => {
      workspaceMock.saveBeforeClose = null;
    };
  },
  finishClose: vi.fn(),
}));

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  await Promise.resolve();
  await nextTick();
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

function folder(files: string[], generation = 1): WorkspaceFolder {
  return {
    root: `/notes-${generation}`,
    files,
    canceled: false,
    generation,
    watchRoot: `workspace-${generation}`,
  };
}

async function openFolder(files: string[]): Promise<HTMLSelectElement> {
  vi.mocked(chooseFolder).mockResolvedValue(folder(files));
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

async function chooseFile(
  select: HTMLSelectElement,
  path: string,
): Promise<void> {
  select.value = path;
  select.dispatchEvent(new Event("change"));
  await settle();
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
  vi.mocked(finishClose).mockReset();
  vi.mocked(finishClose).mockResolvedValue(undefined);
  workspaceMock.saveBeforeClose = null;

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

    await chooseFile(select, "b.md");

    expect(readFile).toHaveBeenCalledWith("b.md");
    expect(editorView().state.doc.toString()).toBe("# second\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("saves the pending edit before choosing another folder", async () => {
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    vi.mocked(chooseFolder).mockResolvedValue(folder(["b.md"], 2));
    button("打开文件夹").click();
    await settle();

    expect(writeFile).toHaveBeenCalledWith("a.md", "start\n!", 1);
    expect(chooseFolder).toHaveBeenCalledTimes(2);
    const saveOrder = vi.mocked(writeFile).mock.invocationCallOrder[0]!;
    const switchOrder = vi.mocked(chooseFolder).mock.invocationCallOrder[1]!;
    expect(saveOrder).toBeLessThan(switchOrder);
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "b.md",
    ]);
  });

  it("waits for an in-flight save before choosing another folder", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    let finishWrite!: () => void;
    vi.mocked(writeFile).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeFile).toHaveBeenCalledOnce();

    vi.mocked(chooseFolder).mockResolvedValue(folder(["b.md"], 2));
    button("打开文件夹").click();
    await settle();
    expect(chooseFolder).toHaveBeenCalledTimes(1);

    finishWrite();
    await settle();
    expect(chooseFolder).toHaveBeenCalledTimes(2);
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it("starts a fresh undo history when switching files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("# first\n")
      .mockResolvedValueOnce("# second\n");
    const select = await openFolder(["a.md", "b.md"]);

    await chooseFile(select, "a.md");
    const firstView = editorView();
    await chooseFile(select, "b.md");
    const secondView = editorView();

    expect(secondView).not.toBe(firstView);
    expect(undo(secondView)).toBe(false);
    expect(secondView.state.doc.toString()).toBe("# second\n");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps the edit and stays on the file when saving fails", async () => {
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md", "b.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
    await chooseFile(select, "b.md");

    expect(writeFile).toHaveBeenCalledWith("a.md", "start\n!", 1);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("a.md");
    expect(editorView().state.doc.toString()).toBe("start\n!");
    expect(host.textContent).toContain("保存失败");

    vi.mocked(writeFile).mockRejectedValue(new Error("still full"));
    button("打开文件夹").click();
    await settle();
    expect(chooseFolder).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("保存失败");

    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(chooseFolder).mockResolvedValue(folder(["c.md"], 2));
    button("打开文件夹").click();
    await settle();

    expect(writeFile).toHaveBeenCalledTimes(3);
    expect(writeFile).toHaveBeenLastCalledWith("a.md", "start\n!", 1);
    expect(chooseFolder).toHaveBeenCalledTimes(2);
  });

  it("saves once editing stops for about a second", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["note.md"]);
    await chooseFile(select, "note.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "typed" } });
    expect(writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(999);
    expect(writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith("note.md", "start\ntyped", 1);
    expect(host.textContent).toContain("已保存");
  });

  it("keeps CRLF line endings and a BOM when saving", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("\uFEFF# CRLF\r\nfirst\r\nsecond");
    const select = await openFolder(["windows.md"]);
    await chooseFile(select, "windows.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(1000);

    expect(writeFile).toHaveBeenCalledWith(
      "windows.md",
      "\uFEFF# CRLF\r\nfirst\r\nsecond!",
      1,
    );
  });

  it("does not autosave a file with mixed line endings", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("a\r\nb\nc");
    const select = await openFolder(["mixed.md", "other.md"]);
    await chooseFile(select, "mixed.md");

    expect(host.textContent).toContain("换行风格混合，未自动保存");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(writeFile).not.toHaveBeenCalled();

    await chooseFile(select, "other.md");

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("mixed.md");
    expect(editorView().state.doc.toString()).toBe("a\nb\nc!");
    expect(host.textContent).toContain("换行风格混合，未自动保存");
  });

  it("saves pending edits before the window closes", async () => {
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    await workspaceMock.saveBeforeClose!();

    expect(writeFile).toHaveBeenCalledWith("a.md", "start\n!", 1);
    expect(finishClose).toHaveBeenCalledWith(true);
  });
});
