import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { SAMPLE_DOCUMENT } from "./sample";
import {
  getSettings,
  migrateLegacyTheme,
  setTheme,
} from "./services/settings";
import {
  chooseFolder,
  confirmDiscard,
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
  saveBeforeClose: null as null | ((token: number) => Promise<void>),
}));

const eventMock = vi.hoisted(() => ({
  openFile: null as null | ((path: string) => void),
  pending: [] as string[],
}));

vi.mock("./services/open-file", () => ({
  onOpenFile: (handler: (path: string) => void) => {
    eventMock.openFile = handler;
    return () => {
      eventMock.openFile = null;
    };
  },
  takePendingOpenedFiles: async () => eventMock.pending,
}));

vi.mock("./services/settings", () => ({
  getSettings: vi.fn(),
  migrateLegacyTheme: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock("./services/workspace", () => ({
  chooseFolder: vi.fn(),
  confirmDiscard: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  onSaveBeforeClose: (handler: (token: number) => Promise<void>) => {
    workspaceMock.saveBeforeClose = handler;
    return () => {
      workspaceMock.saveBeforeClose = null;
  eventMock.openFile = null;
    };
  },
  finishClose: vi.fn(),
}));

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 10; index++) {
    await Promise.resolve();
    await nextTick();
  }
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

  vi.mocked(getSettings).mockReset();
  vi.mocked(getSettings).mockResolvedValue({
    theme: "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  });
  vi.mocked(migrateLegacyTheme).mockReset();
  vi.mocked(migrateLegacyTheme).mockImplementation(async (legacy) => ({
    theme:
      legacy === "light" || legacy === "dark"
        ? legacy
        : "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  }));
  vi.mocked(setTheme).mockReset();
  vi.mocked(setTheme).mockResolvedValue(undefined);
  eventMock.openFile = null;
  eventMock.pending = [];

  vi.mocked(chooseFolder).mockReset();
  vi.mocked(confirmDiscard).mockReset();
  vi.mocked(confirmDiscard).mockResolvedValue(false);
  vi.mocked(readFile).mockReset();
  vi.mocked(writeFile).mockReset();
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(finishClose).mockReset();
  vi.mocked(finishClose).mockResolvedValue(undefined);
  workspaceMock.saveBeforeClose = null;
  eventMock.openFile = null;

  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
});

afterEach(() => {
  app?.unmount();
  vi.restoreAllMocks();
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
    expect(setTheme).toHaveBeenCalledWith("dark");
    expect(host.querySelector(".cm-editor")).toBe(editorDOM);
    expect(view!.state.selection.main.eq(selection)).toBe(true);
    expect(view!.state.doc.toString()).toBe(edited);

    undo(view!);
    expect(view!.state.doc.toString()).toBe(SAMPLE_DOCUMENT);
  });

  it("follows the system appearance while the theme stays system", async () => {
    app?.unmount();
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];
    const mediaState = { matches: false };
    const media = {
      get matches() {
        return mediaState.matches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (
        _type: string,
        listener: (event: MediaQueryListEvent) => void,
      ) => {
        listeners.push(listener);
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    vi.spyOn(window, "matchMedia").mockReturnValue(media);

    app = createApp(App);
    app.mount(host);
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    mediaState.matches = true;
    listeners[0]?.({ matches: true } as MediaQueryListEvent);
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(setTheme).not.toHaveBeenCalled();
  });

  it("migrates the old localStorage theme and removes it", async () => {
    app?.unmount();
    vi.mocked(getSettings).mockClear();
    vi.mocked(migrateLegacyTheme).mockClear();
    localStorage.setItem("nicole-theme", "dark");

    app = createApp(App);
    app.mount(host);
    await settle();

    expect(migrateLegacyTheme).toHaveBeenCalledWith("dark");
    expect(getSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem("nicole-theme")).toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("shows the path of a file the system opened", async () => {
    eventMock.openFile?.("/tmp/from-system.md");
    await settle();
    expect(host.textContent).toContain("/tmp/from-system.md");

    eventMock.openFile?.("/tmp/another.md");
    await settle();
    expect(host.textContent).toContain("/tmp/another.md");
  });

  it("takes a file that arrived before the page subscribed", async () => {
    app?.unmount();
    eventMock.pending = ["/tmp/at-launch.md"];

    app = createApp(App);
    app.mount(host);
    await settle();

    expect(host.textContent).toContain("/tmp/at-launch.md");
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

  it("waits for an in-flight save before reading the next file", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md"]);
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

    vi.mocked(readFile).mockResolvedValue("B\n");
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(readFile).toHaveBeenCalledTimes(1);

    finishWrite();
    await settle();
    expect(readFile).toHaveBeenLastCalledWith("b.md");
    expect(editorView().state.doc.toString()).toBe("B\n");
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
    expect(confirmDiscard).toHaveBeenCalledOnce();
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

    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(select.value).toBe("mixed.md");
    expect(editorView().state.doc.toString()).toBe("a\nb\nc!");
    expect(host.textContent).toContain("换行风格混合，未自动保存");
  });

  it("clears the previous file and shows a placeholder after opening a folder", async () => {
    vi.mocked(readFile).mockResolvedValue("first\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");
    expect(host.querySelector(".cm-editor")).not.toBeNull();

    vi.mocked(chooseFolder).mockResolvedValue(folder(["b.md"], 2));
    button("打开文件夹").click();
    await settle();

    expect(chooseFolder).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".cm-editor")).toBeNull();
    const placeholder = host.querySelector<HTMLElement>("[data-placeholder]");
    expect(placeholder?.textContent).toContain("选择一个 Markdown 文件开始编辑");
    expect(placeholder?.style.display).not.toBe("none");
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "b.md",
    ]);

    vi.mocked(readFile).mockResolvedValue("second\n");
    await chooseFile(select, "b.md");
    expect(editorView().state.doc.toString()).toBe("second\n");
  });

  it("saves edits typed while the next file is being read", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md"]);
    await chooseFile(select, "a.md");

    let finishRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "typed" } });
    finishRead("B\n");
    await settle();

    expect(writeFile).toHaveBeenCalledWith("a.md", "A\ntyped", 1);
    expect(select.value).toBe("b.md");
    expect(editorView().state.doc.toString()).toBe("B\n");
  });

  it("discards a file read that finishes after a folder switch", async () => {
    const select = await openFolder(["a.md"]);

    let finishRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    select.value = "a.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    vi.mocked(chooseFolder).mockResolvedValue(folder(["z.md"], 2));
    button("打开文件夹").click();
    await settle();
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "z.md",
    ]);

    finishRead("OLD FOLDER a.md\n");
    await settle();

    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(select.value).toBe("");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("invalidates a selection made while a folder is being opened", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md"]);
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

    let finishChoose!: (value: WorkspaceFolder) => void;
    vi.mocked(chooseFolder).mockImplementationOnce(
      () =>
        new Promise<WorkspaceFolder>((resolve) => {
          finishChoose = resolve;
        }),
    );
    button("打开文件夹").click();
    await settle();
    // openFolder is still waiting for the save, so chooseFolder has not run.
    expect(chooseFolder).toHaveBeenCalledTimes(1);

    let finishRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    finishWrite();
    await settle();
    expect(chooseFolder).toHaveBeenCalledTimes(2);
    expect(readFile).toHaveBeenLastCalledWith("b.md");
    expect(finishRead).toBeTypeOf("function");

    finishChoose(folder(["b.md"], 2));
    await settle();
    finishRead("OLD FOLDER b.md\n");
    await settle();

    // A regression would leave the old content in an editor bound to the new
    // generation; edit it so the wrong write would also be observable.
    const staleEditor = host.querySelector<HTMLElement>(".cm-editor");
    if (staleEditor) {
      const staleView = EditorView.findFromDOM(staleEditor);
      staleView?.dispatch({
        changes: { from: staleView.state.doc.length, insert: "X" },
      });
      await vi.advanceTimersByTimeAsync(1000);
    }

    const writes = vi.mocked(writeFile).mock.calls;
    expect(writes.every((call) => call[0] === "a.md" && call[2] === 1)).toBe(
      true,
    );
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(select.value).toBe("");
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "b.md",
    ]);
  });

  it("keeps an in-flight selection when opening a folder is cancelled", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md"]);
    await chooseFile(select, "a.md");

    let finishRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    vi.mocked(chooseFolder).mockResolvedValueOnce({
      root: "",
      files: [],
      canceled: true,
      generation: 0,
    });
    button("打开文件夹").click();
    await settle();
    expect(chooseFolder).toHaveBeenCalledTimes(2);

    finishRead("B\n");
    await settle();

    expect(select.value).toBe("b.md");
    expect(editorView().state.doc.toString()).toBe("B\n");
  });

  it("keeps the newest file when an earlier read finishes last", async () => {
    const select = await openFolder(["a.md", "b.md"]);

    let finishA!: (value: string) => void;
    let finishB!: (value: string) => void;
    vi.mocked(readFile)
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishA = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishB = resolve;
          }),
      );

    select.value = "a.md";
    select.dispatchEvent(new Event("change"));
    await settle();
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();
    expect(readFile).toHaveBeenCalledTimes(2);

    finishB("B\n");
    await settle();
    expect(editorView().state.doc.toString()).toBe("B\n");
    expect(select.value).toBe("b.md");

    finishA("A\n");
    await settle();
    expect(editorView().state.doc.toString()).toBe("B\n");
    expect(select.value).toBe("b.md");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("does not show a read error from a stale selection", async () => {
    const select = await openFolder(["a.md"]);

    let failRead!: (error: Error) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((_, reject) => {
          failRead = reject;
        }),
    );
    select.value = "a.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    vi.mocked(chooseFolder).mockResolvedValue(folder(["z.md"], 2));
    button("打开文件夹").click();
    await settle();

    failRead(new Error("gone"));
    await settle();

    expect(host.textContent).not.toContain("读取失败");
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(select.value).toBe("");
  });

  it("does not save the new file for a stale read", async () => {
    const select = await openFolder(["a.md"]);
    let finishOldRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOldRead = resolve;
        }),
    );
    select.value = "a.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    vi.mocked(chooseFolder).mockResolvedValue(folder(["z.md"], 2));
    button("打开文件夹").click();
    await settle();
    vi.mocked(readFile).mockResolvedValue("Z\n");
    await chooseFile(select, "z.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    finishOldRead("OLD FOLDER a.md\n");
    await settle();

    expect(writeFile).not.toHaveBeenCalled();
    expect(editorView().state.doc.toString()).toBe("Z\n!");
    expect(select.value).toBe("z.md");
  });

  it("does not load a file when a newer selection starts during its save", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md", "c.md"]);
    await chooseFile(select, "a.md");

    let finishB!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishB = resolve;
        }),
    );
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    let finishWrite!: () => void;
    vi.mocked(writeFile).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    finishB("B\n");
    await settle();
    expect(writeFile).toHaveBeenCalledWith("a.md", "A\n!", 1);

    vi.mocked(readFile).mockImplementationOnce(
      () => new Promise<string>(() => {}),
    );
    select.value = "c.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    finishWrite();
    await settle();

    expect(editorView().state.doc.toString()).toBe("A\n!");
    expect(select.value).toBe("a.md");
  });

  it("never writes a failed edit from the old file into the next file", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValueOnce("A\n");
    const select = await openFolder(["a.md", "b.md"]);
    await chooseFile(select, "a.md");

    let finishRead!: (value: string) => void;
    vi.mocked(readFile).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
    );
    select.value = "b.md";
    select.dispatchEvent(new Event("change"));
    await settle();

    vi.mocked(writeFile).mockRejectedValue(new Error("disk full"));
    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "typed" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeFile).toHaveBeenCalledWith("a.md", "A\ntyped", 1);

    vi.mocked(confirmDiscard).mockResolvedValue(true);
    finishRead("B\n");
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    const writes = vi.mocked(writeFile).mock.calls;
    expect(writes.every((call) => call[0] === "a.md")).toBe(true);
    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(select.value).toBe("b.md");
    expect(editorView().state.doc.toString()).toBe("B\n");
  });

  it("continues after the user discards a failed save when switching files", async () => {
    vi.mocked(readFile)
      .mockResolvedValueOnce("A\n")
      .mockResolvedValueOnce("B\n");
    const select = await openFolder(["a.md", "b.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
    vi.mocked(confirmDiscard).mockResolvedValue(true);

    await chooseFile(select, "b.md");

    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith("a.md", "A\n!", 1);
    expect(readFile).toHaveBeenLastCalledWith("b.md");
    expect(select.value).toBe("b.md");
    expect(editorView().state.doc.toString()).toBe("B\n");
  });

  it("continues after the user discards a failed save when switching folders", async () => {
    vi.mocked(readFile).mockResolvedValue("A\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));
    vi.mocked(confirmDiscard).mockResolvedValue(true);
    vi.mocked(chooseFolder).mockResolvedValue(folder(["b.md"], 2));

    button("打开文件夹").click();
    await settle();

    expect(confirmDiscard).toHaveBeenCalledOnce();
    expect(chooseFolder).toHaveBeenCalledTimes(2);
    expect([...select.options].map((option) => option.value)).toEqual([
      "",
      "b.md",
    ]);
    expect(host.querySelector(".cm-editor")).toBeNull();
  });

  it("clears pending text when the document returns to the loaded text", async () => {
    vi.mocked(readFile).mockResolvedValue("a\r\nb\nc");
    const select = await openFolder(["mixed.md", "other.md"]);
    await chooseFile(select, "mixed.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    undo(view);
    expect(view.state.doc.toString()).toBe("a\nb\nc");
    await nextTick();
    expect(host.textContent).not.toContain("换行风格混合");

    await workspaceMock.saveBeforeClose!(3);
    expect(writeFile).not.toHaveBeenCalled();
    expect(finishClose).toHaveBeenCalledWith(3, true);

    vi.mocked(readFile).mockResolvedValue("B\n");
    await chooseFile(select, "other.md");
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(editorView().state.doc.toString()).toBe("B\n");
  });

  it("does not resurrect a failed save after the edit is undone", async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    let failWrite!: (error: Error) => void;
    vi.mocked(writeFile).mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          failWrite = reject;
        }),
    );
    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(writeFile).toHaveBeenCalledWith("a.md", "start\n!", 1);

    undo(view);
    expect(view.state.doc.toString()).toBe("start\n");
    failWrite(new Error("disk full"));
    await settle();

    await workspaceMock.saveBeforeClose!(10);

    expect(writeFile).toHaveBeenCalledOnce();
    expect(finishClose).toHaveBeenCalledWith(10, true);
  });

  it("answers a close request with false when saving fails", async () => {
    vi.mocked(readFile).mockResolvedValue("A\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("disk full"));

    await workspaceMock.saveBeforeClose!(8);

    expect(writeFile).toHaveBeenCalledWith("a.md", "A\n!", 1);
    expect(finishClose).toHaveBeenCalledWith(8, false);
    expect(host.textContent).toContain("保存失败");
  });

  it("answers a close request with false for a mixed-ending file", async () => {
    vi.mocked(readFile).mockResolvedValue("a\r\nb\nc");
    const select = await openFolder(["mixed.md"]);
    await chooseFile(select, "mixed.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    await workspaceMock.saveBeforeClose!(9);

    expect(writeFile).not.toHaveBeenCalled();
    expect(finishClose).toHaveBeenCalledWith(9, false);
    expect(host.textContent).toContain("换行风格混合");
  });

  it("saves pending edits before the window closes", async () => {
    vi.mocked(readFile).mockResolvedValue("start\n");
    const select = await openFolder(["a.md"]);
    await chooseFile(select, "a.md");

    const view = editorView();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });

    await workspaceMock.saveBeforeClose!(7);

    expect(writeFile).toHaveBeenCalledWith("a.md", "start\n!", 1);
    expect(finishClose).toHaveBeenCalledWith(7, true);
  });
});
