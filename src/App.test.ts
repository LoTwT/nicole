import { EditorView } from "@codemirror/view";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  pickFolder: vi.fn(),
  openFolder: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  onSaveBeforeClose: vi.fn(),
  finishClose: vi.fn(),
  listDirectory: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  trashEntry: vi.fn(),
  openWithDefaultApp: vi.fn(),
  revealEntry: vi.fn(),
  popupNativeMenu: vi.fn(),
  copyText: vi.fn(),
  getSettings: vi.fn(),
  migrateLegacyTheme: vi.fn(),
  setTheme: vi.fn(),
  setSidebarWidth: vi.fn(),
  setExpandedFolders: vi.fn(),
  addRecentFolder: vi.fn(),
  removeRecentFolder: vi.fn(),
  chooseSingleFile: vi.fn(),
  acceptSingleFile: vi.fn(),
  dismissOfferedFile: vi.fn(),
  readSingleFile: vi.fn(),
  writeSingleFile: vi.fn(),
  releaseSingleFile: vi.fn(),
  onOpenFile: vi.fn(),
  takePendingOpenedFiles: vi.fn(),
  onWindowFileDrop: vi.fn(),
  pasteImage: vi.fn(),
  importImages: vi.fn(),
  watchWorkspace: vi.fn(),
}));

vi.mock("./services/app", () => ({ getAppInfo: mocks.getAppInfo }));
vi.mock("./services/workspace", () => ({
  pickFolder: mocks.pickFolder,
  openFolder: mocks.openFolder,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  onSaveBeforeClose: mocks.onSaveBeforeClose,
  finishClose: mocks.finishClose,
}));
vi.mock("./services/files", () => ({
  listDirectory: mocks.listDirectory,
  createFile: mocks.createFile,
  createFolder: mocks.createFolder,
  renameEntry: mocks.renameEntry,
  trashEntry: mocks.trashEntry,
  openWithDefaultApp: mocks.openWithDefaultApp,
  revealEntry: mocks.revealEntry,
}));
vi.mock("./services/menu", () => ({ popupNativeMenu: mocks.popupNativeMenu }));
vi.mock("./services/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("./services/settings", () => ({
  getSettings: mocks.getSettings,
  migrateLegacyTheme: mocks.migrateLegacyTheme,
  setTheme: mocks.setTheme,
  setSidebarWidth: mocks.setSidebarWidth,
  setExpandedFolders: mocks.setExpandedFolders,
  addRecentFolder: mocks.addRecentFolder,
  removeRecentFolder: mocks.removeRecentFolder,
}));
vi.mock("./services/single-file", () => ({
  chooseSingleFile: mocks.chooseSingleFile,
  acceptSingleFile: mocks.acceptSingleFile,
  dismissOfferedFile: mocks.dismissOfferedFile,
  readSingleFile: mocks.readSingleFile,
  writeSingleFile: mocks.writeSingleFile,
  releaseSingleFile: mocks.releaseSingleFile,
}));
vi.mock("./services/open-file", () => ({
  onOpenFile: mocks.onOpenFile,
  takePendingOpenedFiles: mocks.takePendingOpenedFiles,
}));
vi.mock("./services/assets", () => ({
  onWindowFileDrop: mocks.onWindowFileDrop,
  pasteImage: mocks.pasteImage,
  importImages: mocks.importImages,
}));
vi.mock("./services/watch", () => ({
  watchWorkspace: mocks.watchWorkspace,
}));

const entry = (
  name: string,
  path: string,
  options: { isDir?: boolean; isMarkdown?: boolean; size?: number } = {},
) => ({
  name,
  path,
  isDir: options.isDir ?? false,
  isMarkdown: options.isMarkdown ?? name.endsWith(".md"),
  size: options.size ?? 10,
});

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;
let tree: ReturnType<typeof entry>[] = [];
let openFileText = "";
let watchEvents: ((events: import("./services/mygo").WorkspaceFileEvent[]) => void) | null =
  null;
let closeHandler: ((token: number) => Promise<void>) | null = null;
let openHandler: (() => void) | null = null;
let pendingFiles: string[] = [];

async function settle() {
  for (let index = 0; index < 20; index++) {
    await Promise.resolve();
    await nextTick();
  }
}

function folder(root: string, generation = 1) {
  return { root, files: [], canceled: false, generation };
}

function buttons(label: string): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
    (item) => item.textContent?.replace(/\s+/g, "").includes(label),
  );
}

function button(label: string): HTMLButtonElement {
  const found = buttons(label)[0];
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

function sidebarButton(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("aside button")].find(
    (item) => item.textContent?.replace(/\s+/g, "").includes(label),
  );
  if (!found) throw new Error(`sidebar button ${label} not found`);
  return found;
}

function editorView(): EditorView {
  const element = host.querySelector<HTMLElement>(".cm-editor");
  if (!element) throw new Error("editor not found");
  const view = EditorView.findFromDOM(element);
  if (!view) throw new Error("editor view not found");
  return view;
}

function replaceEditorText(text: string) {
  const view = editorView();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

async function openFolder(files = tree, generation = 1) {
  mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
  mocks.openFolder.mockResolvedValue(folder("/notes", generation));
  button("打开文件夹").click();
  await settle();
}

async function openFile(name = "a.md", text = "# A\n") {
  tree = [entry(name, name)];
  mocks.listDirectory.mockImplementation(async (path: string) => ({
    path,
    entries: path === "." ? tree : [],
  }));
  openFileText = text;
  mocks.readFile.mockResolvedValue(text);
  await openFolder();
  const row = host.querySelector<HTMLElement>(`[data-tree-path="${name}"]`);
  if (!row) throw new Error(`tree row ${name} not found`);
  row.click();
  await settle();
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function dialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]');
}

function dialogButton(label: string): HTMLButtonElement {
  const found = [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!found) throw new Error(`dialog button ${label} not found`);
  return found;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.classList.remove("dark");
  localStorage.clear();
  tree = [];
  pendingFiles = [];
  openFileText = "";
  watchEvents = null;
  closeHandler = null;
  openHandler = null;

  vi.clearAllMocks();
  mocks.getAppInfo.mockResolvedValue({
    version: "0.0.1",
    os: "darwin",
    arch: "arm64",
    goVersion: "go1.27",
    homeDir: "/Users/tester",
  });
  mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
  mocks.openFolder.mockResolvedValue(folder("/notes"));
  mocks.readFile.mockImplementation(async () => openFileText);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.listDirectory.mockImplementation(async (path: string) => ({
    path,
    entries: path === "." ? tree : [],
  }));
  mocks.createFile.mockResolvedValue("new.md");
  mocks.createFolder.mockResolvedValue("folder");
  mocks.renameEntry.mockImplementation(async (path: string, name: string) => {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return parent ? `${parent}/${name}` : name;
  });
  mocks.trashEntry.mockResolvedValue(undefined);
  mocks.openWithDefaultApp.mockResolvedValue(undefined);
  mocks.revealEntry.mockResolvedValue(undefined);
  mocks.popupNativeMenu.mockResolvedValue("");
  mocks.copyText.mockResolvedValue(true);
  mocks.getSettings.mockResolvedValue({
    theme: "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  });
  mocks.migrateLegacyTheme.mockResolvedValue({
    theme: "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  });
  mocks.setTheme.mockResolvedValue(undefined);
  mocks.setSidebarWidth.mockResolvedValue(undefined);
  mocks.setExpandedFolders.mockResolvedValue(undefined);
  mocks.addRecentFolder.mockResolvedValue(undefined);
  mocks.removeRecentFolder.mockResolvedValue(undefined);
  mocks.acceptSingleFile.mockImplementation(async (path: string) => ({
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
  }));
  mocks.dismissOfferedFile.mockResolvedValue(undefined);
  mocks.readSingleFile.mockResolvedValue("# Single\n");
  mocks.writeSingleFile.mockResolvedValue(undefined);
  mocks.releaseSingleFile.mockResolvedValue(undefined);
  mocks.takePendingOpenedFiles.mockImplementation(async () => {
    const files = pendingFiles;
    pendingFiles = [];
    return files;
  });
  mocks.onOpenFile.mockImplementation((handler: () => void) => {
    openHandler = handler;
    return () => {
      openHandler = null;
    };
  });
  mocks.onWindowFileDrop.mockReturnValue(() => {});
  mocks.pasteImage.mockResolvedValue([]);
  mocks.importImages.mockResolvedValue([]);
  mocks.onSaveBeforeClose.mockImplementation(
    (handler: (token: number) => Promise<void>) => {
      closeHandler = handler;
      return () => {
        closeHandler = null;
      };
    },
  );
  mocks.finishClose.mockResolvedValue(undefined);
  mocks.watchWorkspace.mockImplementation(
    (_generation: number, onEvents: typeof watchEvents) => {
      watchEvents = onEvents;
      return {
        ready: Promise.resolve(),
        closed: new Promise<void>(() => {}),
        close: vi.fn(),
      };
    },
  );

  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.innerHTML = "";
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("application shell", () => {
  it("starts with the empty workspace and opens a folder", async () => {
    await settle();
    expect(host.textContent).toContain("开始写作");
    expect(host.textContent).toContain("打开一个文件夹作为工作区");
    expect(host.querySelector("aside")).toBeNull();

    tree = [entry("a.md", "a.md")];
    await openFolder();
    expect(mocks.pickFolder).toHaveBeenCalledOnce();
    expect(mocks.openFolder).toHaveBeenCalledWith("/notes");
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).toContain("选择一个文件开始写作");
    expect(host.textContent).toContain("a.md");
    expect(mocks.addRecentFolder).not.toHaveBeenCalled();
  });

  it("shows the last folder as missing instead of opening it", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
    });
    mocks.openFolder.mockRejectedValue(new Error("not found"));
    await settle();
    app = createApp(App);
    app.mount(host);
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledWith("/gone");
    expect(host.textContent).toContain("上次打开的文件夹“gone”已不存在");
  });

  it("confirms a folder switch and keeps the current file on cancel", async () => {
    await openFile();
    expect(host.textContent).toContain("a.md");

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("打开文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("切换到“second”");
    dialogButton("取消").click();
    await settle();

    expect(mocks.openFolder).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("a.md");
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("opens a non-Markdown file as a placeholder with system actions", async () => {
    tree = [
      entry("cover.png", "assets/cover.png", {
        isMarkdown: false,
        size: 2048,
      }),
    ];
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries: path === "." ? [entry("assets", "assets", { isDir: true })] : tree,
    }));
    await openFolder();
    host
      .querySelector<HTMLElement>('[data-tree-path="assets"]')!
      .click();
    await settle();
    host
      .querySelector<HTMLElement>('[data-tree-path="assets/cover.png"]')!
      .click();
    await settle();

    expect(host.textContent).toContain("无法预览此类型的文件");
    expect(host.textContent).toContain("cover.png · 2.0 KB");
    expect(host.querySelector('[role="tab"]')?.textContent).toContain("cover.png");

    button("用默认应用打开").click();
    await settle();
    expect(mocks.openWithDefaultApp).toHaveBeenCalledWith(
      "assets/cover.png",
      1,
    );
    buttons("显示")[0]!.click();
    await settle();
    expect(mocks.revealEntry).toHaveBeenCalledWith("assets/cover.png", 1);
  });

  it("does not open two folder pickers at once", async () => {
    const pick = deferred<{ path: string; canceled: boolean }>();
    mocks.pickFolder.mockImplementation(() => pick.promise);
    button("打开文件夹").click();
    button("打开文件夹").click();
    await settle();
    expect(mocks.pickFolder).toHaveBeenCalledOnce();
    pick.resolve({ path: "/notes", canceled: true });
    await settle();
    expect(mocks.openFolder).not.toHaveBeenCalled();
  });

  it("keeps edits when the folder picker is canceled after a failed save", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValue(new Error("read-only"));
    replaceEditorText("# Changed\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(host.textContent).toContain("保存失败");

    mocks.pickFolder.mockResolvedValue({ path: "", canceled: true });
    sidebarButton("打开文件夹").click();
    await settle();
    expect(dialog()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("# Changed\n");
    expect(mocks.openFolder).toHaveBeenCalledTimes(1);
  });

  it("saves edits typed while the folder picker is open", async () => {
    await openFile();
    const pick = deferred<{ path: string; canceled: boolean }>();
    mocks.pickFolder.mockImplementation(() => pick.promise);
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("打开文件夹").click();
    await settle();

    replaceEditorText("# Typed during picker\n");
    pick.resolve({ path: "/second", canceled: false });
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "# Typed during picker\n",
      1,
    );
    expect(dialog()?.textContent).toContain("切换到“second”");
    dialogButton("切换").click();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledWith("/second");
  });

  it("uses a single document tab and switches modes", async () => {
    await openFile();
    expect(host.querySelector('[role="tablist"]')?.textContent).toContain("a.md");
    expect(host.querySelectorAll('[role="tab"]').length).toBe(1);

    const source = buttons("源码").find((item) => item.closest("header"));
    source!.click();
    await settle();
    expect(source?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("saving and status", () => {
  it("shows editing, delays saving, and then shows saved", async () => {
    vi.useFakeTimers();
    await openFile();
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);

    replaceEditorText("# Edited\n");
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("编辑中");
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Edited\n", 1);
    await vi.advanceTimersByTimeAsync(299);
    expect(host.querySelector("footer")?.textContent).not.toContain("保存中");
    await vi.advanceTimersByTimeAsync(1);
    expect(host.querySelector("footer")?.textContent).toContain("保存中");

    write.resolve();
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
  });

  it("shows the save failure banner, tab dot and retries", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValueOnce(new Error("permission denied"));
    replaceEditorText("# Edited\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    expect(host.textContent).toContain("无法保存：permission denied");
    expect(host.textContent).toContain("重试");
    const tab = host.querySelector('[role="tab"]');
    expect(tab?.querySelector('[role="img"]')).not.toBeNull();

    mocks.writeFile.mockResolvedValue(undefined);
    button("重试").click();
    await settle();
    expect(host.textContent).not.toContain("无法保存");
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
  });

  it("does not autosave a mixed line-ending file", async () => {
    vi.useFakeTimers();
    await openFile("mixed.md", "a\r\nb\nc\r\n");
    expect(host.textContent).toContain("换行风格混合");
    replaceEditorText("a\r\nb\nc\r\nd\r\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("writes the original line-ending style", async () => {
    vi.useFakeTimers();
    await openFile("crlf.md", "a\r\nb\r\n");
    replaceEditorText("a\r\nb\r\nc\r\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "crlf.md",
      "a\r\nb\r\nc\r\n",
      1,
    );
  });
});

describe("external changes", () => {
  it("reloads an unedited file and ignores image create events for the document", async () => {
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries:
        path === "."
          ? [entry("a.md", "a.md")]
          : path === "assets"
            ? [entry("cover.png", "assets/cover.png", { isMarkdown: false })]
            : [],
    }));
    await openFile();
    const initialReads = mocks.readFile.mock.calls.length;

    openFileText = "# A\n\nimage\n";
    mocks.readFile.mockResolvedValue(openFileText);
    watchEvents?.([{ op: "create", path: "assets/cover.png", isDir: false }]);
    await settle();
    expect(mocks.readFile).toHaveBeenCalledTimes(initialReads);
    expect(host.textContent).not.toContain("已在 Nicole 之外被修改");

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(mocks.readFile).toHaveBeenCalledTimes(initialReads + 1);
    expect(editorView().state.doc.toString()).toBe(openFileText);
    expect(host.querySelector("footer")?.textContent).toContain(
      "已载入磁盘上的新内容",
    );
  });

  it("keeps an external change that arrives during a write", async () => {
    vi.useFakeTimers();
    await openFile();
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);

    replaceEditorText("# Mine\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    write.resolve();
    await settle();

    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    replaceEditorText("# After\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
  });

  it("does not replace input typed while an external version is loading", async () => {
    vi.useFakeTimers();
    await openFile();
    const reading = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => reading.promise);

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    replaceEditorText("# Typed while reading\n");
    reading.resolve("# Disk version\n");
    await settle();

    expect(editorView().state.doc.toString()).toBe("# Typed while reading\n");
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps autosave paused when typing continues after an external change", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# Mine\n");
    await settle();
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");

    replaceEditorText("# Mine again\n");
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    );
    await settle();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("maps the selection through an external insertion", async () => {
    await openFile("a.md", "one\ntwo\nthree\n");
    const view = editorView();
    const target = view.state.doc.toString().indexOf("three") + 2;
    view.dispatch({ selection: { anchor: target } });

    mocks.readFile.mockResolvedValue("zero\none\ntwo\nthree\n");
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(view.state.sliceDoc(view.state.selection.main.from - 2, view.state.selection.main.from)).toBe("th");
  });

  it("pauses autosave and offers both versions when local edits exist", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# Mine\n");
    await settle();
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    expect(host.textContent).toContain("载入磁盘版本");
    expect(host.textContent).toContain("保留我的版本");

    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    button("保留我的版本").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Mine\n", 1);
  });

  it("shows the deletion banner and recreates the file", async () => {
    await openFile();
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");
    button("重新保存").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A\n", 1);
    expect(host.textContent).not.toContain("此文件已在磁盘上被删除或移走");
  });
});

describe("renames", () => {
  it("keeps a folder rename from looking like an external deletion", async () => {
    tree = [
      entry("notes", "notes", { isDir: true }),
      entry("root.md", "root.md"),
    ];
    openFileText = "# A\n";
    mocks.listDirectory.mockImplementation(async (path: string) => {
      if (path === ".") return { path: ".", entries: tree };
      if (path === "notes") {
        return { path: "notes", entries: [entry("a.md", "notes/a.md")] };
      }
      return { path, entries: [] };
    });
    await openFolder();
    host.querySelector<HTMLElement>('[data-tree-path="notes"]')!.click();
    await settle();
    host.querySelector<HTMLElement>('[data-tree-path="notes/a.md"]')!.click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("# A\n");

    const rename = deferred<string>();
    mocks.renameEntry.mockReturnValue(rename.promise);
    mocks.popupNativeMenu.mockResolvedValue("rename");
    host
      .querySelector<HTMLElement>('[data-tree-path="notes"]')!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    await settle();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="重命名"]');
    if (!input) throw new Error("rename input not found");
    input.value = "notes2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();

    // The watcher can report the rename before RenameEntry resolves.
    watchEvents?.([
      { op: "rename", oldPath: "notes", path: "notes2", isDir: true },
    ]);
    await settle();
    expect(host.textContent).not.toContain("已在磁盘上被删除或移走");

    rename.resolve("notes2");
    await settle();
    expect(host.textContent).not.toContain("已在磁盘上被删除或移走");
    expect(host.querySelector('[role="tab"]')?.getAttribute("title")).toBe(
      "notes/notes2/a.md",
    );
  });
});

describe("single files and dialogs", () => {
  it("does not ask to discard after a successful save when switching", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# Edited\n");

    pendingFiles = ["/tmp/other.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Edited\n", 1);
    expect(dialog()).toBeNull();
    expect(host.querySelector('[role="tab"]')?.textContent).toContain("other.md");
  });

  it("dismisses a system-opened file when the dialog is canceled", async () => {
    await settle();
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("取消").click();
    await settle();

    expect(mocks.dismissOfferedFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(mocks.acceptSingleFile).not.toHaveBeenCalled();
  });

  it("opens a file outside the workspace after confirmation and saves it", async () => {
    vi.useFakeTimers();
    await settle();
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    expect(dialog()?.textContent).toContain("这个文件不在已打开的文件夹中");
    dialogButton("只打开这个文件").click();
    await settle();

    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(mocks.readSingleFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(host.textContent).toContain("这个文件不在已打开的文件夹中");
    expect(host.querySelector('[role="tab"]')?.textContent).toContain("single.md");

    replaceEditorText("# Single edited\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeSingleFile).toHaveBeenCalledWith(
      "/tmp/single.md",
      "# Single edited\n",
    );
  });

  it("keeps the current document when a single-file replacement is canceled", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValue(new Error("read-only"));
    replaceEditorText("# Unsaved\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();
    expect(dialog()?.textContent).toContain("放弃未保存的更改");
    dialogButton("取消").click();
    await settle();

    expect(mocks.acceptSingleFile).not.toHaveBeenCalled();
    expect(editorView().state.doc.toString()).toBe("# Unsaved\n");
  });

  it("keeps a single-file tab when another folder opens", async () => {
    await settle();
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    await settle();
    button("打开文件夹").click();
    await settle();
    expect(dialog()).toBeNull();
    expect(mocks.openFolder).toHaveBeenCalledWith("/notes");
    expect(editorView().state.doc.toString()).toBe("# Single\n");
  });

  it("closes a mixed-ending tab only after confirmation", async () => {
    await openFile("mixed.md", "a\r\nb\n");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
    );
    await settle();
    expect(dialog()?.textContent).toContain("换行风格混合");
    dialogButton("取消").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("a\nb\n");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
    );
    await settle();
    dialogButton("放弃更改并关闭").click();
    await settle();
    expect(host.textContent).toContain("选择一个文件开始写作");
  });

  it("closes an open page dialog before a window close request", async () => {
    await openFile();
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("打开文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();

    await closeHandler?.(7);
    await settle();
    expect(dialog()).toBeNull();
    expect(mocks.finishClose).toHaveBeenCalledWith(7, true);
  });
});

describe("theme and accessibility", () => {
  it("toggles an explicit theme from the status bar", async () => {
    await settle();
    const themeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    themeButton!.click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("follows the system appearance while the theme stays system", async () => {
    app?.unmount();
    const listeners: ((event: MediaQueryListEvent) => void)[] = [];
    const state = { matches: false };
    const media = {
      get matches() {
        return state.matches;
      },
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
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

    state.matches = true;
    listeners[0]?.({ matches: true } as MediaQueryListEvent);
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setTheme).not.toHaveBeenCalled();
  });

  it("toggles the sidebar with Ctrl+Cmd+S instead of saving", async () => {
    await openFile();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    );
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("runs native Undo through CodeMirror and ignores it during composition", async () => {
    await openFile();
    const view = editorView();
    view.focus();
    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    window.dispatchEvent(
      new CustomEvent("nicole:edit-command", { detail: "undo" }),
    );
    await settle();
    expect(view.state.doc.toString()).toBe("# A\n");

    view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    window.dispatchEvent(
      new CustomEvent("nicole:edit-command", { detail: "undo" }),
    );
    await settle();
    expect(view.state.doc.toString()).toBe("# A\n!");
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    window.dispatchEvent(
      new CustomEvent("nicole:edit-command", { detail: "undo" }),
    );
    await settle();
    expect(view.state.doc.toString()).toBe("# A\n");
  });

  it("has named icon-only buttons and a tree", async () => {
    await openFile();
    const tree = host.querySelector('[role="tree"]');
    expect(tree).not.toBeNull();
    expect(tree?.querySelectorAll('[role="treeitem"]').length).toBe(1);
    const sidebarButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="隐藏侧栏"]',
    );
    expect(sidebarButton).not.toBeNull();
    expect(sidebarButton?.getAttribute("aria-label")).toContain("⌃⌘S");
    const themeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="切换到"]',
    );
    expect(themeButton).not.toBeNull();
  });
});
