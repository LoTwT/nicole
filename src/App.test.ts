import { EditorView } from "@codemirror/view";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  pickFolder: vi.fn(),
  openFolder: vi.fn(),
  openDroppedFolder: vi.fn(),
  closeWorkspace: vi.fn(),
  listFiles: vi.fn(),
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
  revealSingleFile: vi.fn(),
  getWorkspaceTabs: vi.fn(),
  saveWorkspaceTabs: vi.fn(),
  saveRecovery: vi.fn(),
  deleteRecovery: vi.fn(),
  discardRecovery: vi.fn(),
  listRecovery: vi.fn(),
  restoreRecoverySingleFile: vi.fn(),
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
  openDroppedFolder: mocks.openDroppedFolder,
  closeWorkspace: mocks.closeWorkspace,
  listFiles: mocks.listFiles,
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
  revealSingleFile: mocks.revealSingleFile,
}));
vi.mock("./services/tabs", () => ({
  getWorkspaceTabs: mocks.getWorkspaceTabs,
  saveWorkspaceTabs: mocks.saveWorkspaceTabs,
}));
vi.mock("./services/recovery", () => ({
  saveRecovery: mocks.saveRecovery,
  deleteRecovery: mocks.deleteRecovery,
  discardRecovery: mocks.discardRecovery,
  listRecovery: mocks.listRecovery,
  restoreRecoverySingleFile: mocks.restoreRecoverySingleFile,
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

const slashMocks = vi.hoisted(() => ({ destroy: vi.fn() }));
const headingMocks = vi.hoisted(() => ({
  extract: vi.fn(),
}));

vi.mock("./editor/headings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor/headings")>();
  headingMocks.extract.mockImplementation(actual.extractHeadingsWithStatus);
  return {
    ...actual,
    extractHeadingsWithStatus: (
      ...args: Parameters<typeof actual.extractHeadingsWithStatus>
    ) => headingMocks.extract(...args),
  };
});

vi.mock("./editor/slash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./editor/slash")>();
  return {
    ...actual,
    createSlashMenu: (
      options: Parameters<typeof actual.createSlashMenu>[0],
    ) => {
      const controller = actual.createSlashMenu(options);
      return {
        ...controller,
        destroy() {
          slashMocks.destroy();
          controller.destroy();
        },
      };
    },
  };
});

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
let exposedApp: { value: any } | null = null;
let tree: ReturnType<typeof entry>[] = [];
let openFileText = "";
let watchEvents: ((events: import("./services/mygo").WorkspaceFileEvent[]) => void) | null =
  null;
let dropHandler: ((drop: import("./services/mygo").AssetDrop) => void) | null =
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

/** Advances the command palette's clear-before-write announcement delay. */
async function settlePaletteAnnouncement() {
  await settle();
  await vi.advanceTimersByTimeAsync(50);
  await settle();
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
    (item) =>
      item.textContent?.replace(/\s+/g, "").includes(label) ||
      item.getAttribute("aria-label")?.replace(/\s+/g, "").includes(label),
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

function typeSlashAtEnd() {
  const view = editorView();
  const at = view.state.doc.length;
  view.dispatch({
    changes: { from: at, insert: "/" },
    selection: { anchor: at + 1 },
    userEvent: "input.type",
  });
}

function pressMod(key: string, code: string) {
  editorView().contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      ctrlKey: true,
      metaKey: navigator.platform.startsWith("Mac"),
      bubbles: true,
      cancelable: true,
    }),
  );
}

function slashMenuElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Slash 命令"]',
  );
}

function paletteInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    '[role="combobox"][aria-label^="命令面板"]',
  );
  if (!input) throw new Error("command palette input not found");
  return input;
}

function paletteOptions(): HTMLButtonElement[] {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[role="listbox"] [role="option"]',
    ),
  ];
}

function paletteAnnouncement(): HTMLParagraphElement {
  const region = document.querySelector<HTMLParagraphElement>(
    '[role="dialog"] [role="status"][aria-live="polite"]',
  );
  if (!region) throw new Error("palette announcement region not found");
  return region;
}

function typePalette(value: string) {
  const input = paletteInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressAppShortcut(key: string, shift = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

function pressPaletteShortcut(key: string) {
  return pressAppShortcut(key, true);
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
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function mountAppWithApi() {
  await settle();
  app?.unmount();
  app = null;
  exposedApp = null;
  const Wrapper = defineComponent({
    setup() {
      const inner = ref<any>(null);
      exposedApp = inner;
      return () => h(App, { ref: inner });
    },
  });
  app = createApp(Wrapper);
  app.mount(host);
  await settle();
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
  dropHandler = null;
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
  mocks.openDroppedFolder.mockResolvedValue(folder("/dropped"));
  mocks.closeWorkspace.mockResolvedValue(undefined);
  mocks.readFile.mockImplementation(async () => openFileText);
  mocks.listFiles.mockResolvedValue([]);
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
  mocks.revealSingleFile.mockResolvedValue(undefined);
  mocks.getWorkspaceTabs.mockResolvedValue({ tabs: [], active: "" });
  mocks.saveWorkspaceTabs.mockResolvedValue(undefined);
  mocks.saveRecovery.mockResolvedValue("0123456789abcdef");
  mocks.deleteRecovery.mockResolvedValue(undefined);
  mocks.discardRecovery.mockResolvedValue(undefined);
  mocks.listRecovery.mockResolvedValue({ items: [], otherFolders: 0 });
  mocks.restoreRecoverySingleFile.mockImplementation(async (id: string) => ({
    path: `/tmp/${id}.md`,
    name: `${id}.md`,
  }));
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
  mocks.onWindowFileDrop.mockImplementation(
    (handler: (drop: import("./services/mygo").AssetDrop) => void) => {
      dropHandler = handler;
      return () => {
        dropHandler = null;
      };
    },
  );
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

  exposedApp = null;
  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  exposedApp = null;
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

  it("shows the last folder as missing only for the fixed missing-folder error", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
    });
    mocks.openFolder.mockRejectedValue(
      new Error("workspace: folder does not exist"),
    );
    await settle();
    app = createApp(App);
    app.mount(host);
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledWith("/gone");
    expect(host.textContent).toContain("上次打开的文件夹“gone”已不存在");
    expect(host.textContent).not.toContain("workspace: folder does not exist");
  });

  it("does not mark the last folder missing for other startup failures", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
    });
    mocks.openFolder.mockRejectedValue(new Error("open /blocked: permission denied"));
    await settle();
    app = createApp(App);
    app.mount(host);
    await settle();

    const open = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label^="打开 "]',
    )!;
    expect(open.disabled).toBe(false);
    expect(open.getAttribute("aria-label")).not.toContain("已不存在");
    expect(host.textContent).not.toContain("上次打开的文件夹");
    expect(host.textContent).toContain("没有权限打开这个文件夹");
    expect(host.textContent).not.toContain("permission denied");
    expect(
      host
        .querySelector<HTMLElement>("footer span[title]")
        ?.getAttribute("title"),
    ).toBe("open /blocked: permission denied");
  });

  it("maps every folder-open failure to Chinese and keeps the raw error", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    app = createApp(App);
    app.mount(host);
    await settle();

    const cases = [
      ['workspace: not a folder: "/blocked"', "所选项目不是文件夹"],
      [
        'workspace: folder cannot be opened as a workspace: "/blocked"',
        "不能把这个文件夹作为工作区",
      ],
      [
        'workspace: folder was not chosen by the user: "/blocked"',
        "无法打开这个文件夹",
      ],
      ['workspace: folder is not absolute: "blocked"', "无法打开这个文件夹"],
      ["boom: unexpected failure", "打开文件夹失败，请稍后重试"],
    ] as const;

    for (const [error, message] of cases) {
      mocks.openFolder.mockRejectedValueOnce(new Error(error));
      host
        .querySelector<HTMLButtonElement>(
          '[data-recent-item] button[aria-label^="打开 "]',
        )!
        .click();
      await settle();
      const footer = host.querySelector<HTMLElement>("footer")!;
      expect(footer.textContent).toContain(message);
      expect(footer.textContent).not.toContain("workspace:");
      expect(footer.textContent).not.toContain("boom:");
      expect(
        footer.querySelector("span[title]")?.getAttribute("title"),
      ).toBe(error);
    }
  });

  it("keeps a folder-open detail notice visible for eight seconds", async () => {
    vi.useFakeTimers();
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValue(new Error("permission denied"));
    app = createApp(App);
    app.mount(host);
    await settle();

    host
      .querySelector<HTMLButtonElement>(
        '[data-recent-item] button[aria-label^="打开 "]',
      )!
      .click();
    await settle();
    expect(host.textContent).toContain("没有权限打开这个文件夹");

    await vi.advanceTimersByTimeAsync(7999);
    await settle();
    expect(host.textContent).toContain("没有权限打开这个文件夹");

    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(host.textContent).not.toContain("没有权限打开这个文件夹");
  });

  it("keeps notices without a detail at three seconds", async () => {
    vi.useFakeTimers();
    await openFolder();
    const reopen = pressAppShortcut("T", true);
    await settle();
    expect(reopen.defaultPrevented).toBe(true);
    expect(host.textContent).toContain("没有可重新打开的标签页");

    await vi.advanceTimersByTimeAsync(2999);
    await settle();
    expect(host.textContent).toContain("没有可重新打开的标签页");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(host.textContent).not.toContain("没有可重新打开的标签页");
  });

  it("clears an open-failure notice when the retry succeeds", async () => {
    vi.useFakeTimers();
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValueOnce(new Error("permission denied"));
    app = createApp(App);
    app.mount(host);
    await settle();

    const recentOpen = () =>
      host.querySelector<HTMLButtonElement>(
        '[data-recent-item] button[aria-label^="打开 "]',
      )!;

    recentOpen().click();
    await settle();
    expect(host.textContent).toContain("没有权限打开这个文件夹");

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    mocks.openFolder.mockResolvedValueOnce(folder("/blocked"));
    recentOpen().click();
    await settle();

    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).not.toContain("没有权限打开这个文件夹");
    expect(host.querySelector("footer span[title]")).toBeNull();

    await vi.advanceTimersByTimeAsync(7000);
    await settle();
    expect(host.textContent).not.toContain("没有权限打开这个文件夹");
  });

  it("keeps an unrelated notice that replaces an open failure", async () => {
    vi.useFakeTimers();
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValueOnce(new Error("permission denied"));
    app = createApp(App);
    app.mount(host);
    await settle();

    const recentOpen = () =>
      host.querySelector<HTMLButtonElement>(
        '[data-recent-item] button[aria-label^="打开 "]',
      )!;

    recentOpen().click();
    await settle();
    expect(host.textContent).toContain("没有权限打开这个文件夹");

    dropHandler?.({ token: "image", x: 10, y: 10 });
    await settle();
    expect(host.textContent).toContain("只能拖入一个文件夹");
    expect(host.textContent).not.toContain("没有权限打开这个文件夹");

    mocks.openFolder.mockResolvedValueOnce(folder("/blocked"));
    recentOpen().click();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).toContain("只能拖入一个文件夹");

    await vi.advanceTimersByTimeAsync(2999);
    await settle();
    expect(host.textContent).toContain("只能拖入一个文件夹");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(host.textContent).not.toContain("只能拖入一个文件夹");
  });

  it("clears the old notice timer when a later notice is shown", async () => {
    vi.useFakeTimers();
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValueOnce(new Error("permission denied"));
    app = createApp(App);
    app.mount(host);
    await settle();

    host
      .querySelector<HTMLButtonElement>(
        '[data-recent-item] button[aria-label^="打开 "]',
      )!
      .click();
    await settle();
    expect(host.textContent).toContain("没有权限打开这个文件夹");

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    mocks.openFolder.mockResolvedValueOnce(folder("/blocked"));
    host
      .querySelector<HTMLButtonElement>(
        '[data-recent-item] button[aria-label^="打开 "]',
      )!
      .click();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).not.toContain("没有权限打开这个文件夹");

    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    pressAppShortcut("T", true);
    await settle();
    expect(host.textContent).toContain("没有可重新打开的标签页");

    await vi.advanceTimersByTimeAsync(2999);
    await settle();
    expect(host.textContent).toContain("没有可重新打开的标签页");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(host.textContent).not.toContain("没有可重新打开的标签页");
  });

  it("keeps an open-failure notice when the switch dialog is cancelled", async () => {
    await openFolder();
    mocks.pickFolder.mockRejectedValueOnce(
      new Error("dialog: native picker failed"),
    );
    sidebarButton("切换文件夹").click();
    await settle();
    expect(host.textContent).toContain("打开文件夹失败，请稍后重试");

    mocks.pickFolder.mockResolvedValueOnce({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("切换到“second”");
    dialogButton("取消").click();
    await settle();

    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).toContain("打开文件夹失败，请稍后重试");
  });

  it("clears a drag-open failure when a later drag succeeds", async () => {
    await settle();
    mocks.openDroppedFolder.mockRejectedValueOnce(
      new Error('workspace: folder cannot be opened as a workspace: "/"'),
    );
    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(host.textContent).toContain("不能把这个文件夹作为工作区");
    expect(host.textContent).not.toContain("folder cannot be opened");
    expect(
      host.querySelector<HTMLElement>("footer span[title]")?.getAttribute("title"),
    ).toBe('workspace: folder cannot be opened as a workspace: "/"');

    mocks.openDroppedFolder.mockResolvedValueOnce(folder("/dropped"));
    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).not.toContain("不能把这个文件夹作为工作区");
  });

  it("clears a picker failure when the picker later succeeds", async () => {
    await settle();
    mocks.pickFolder.mockRejectedValueOnce(
      new Error("dialog: native picker failed"),
    );
    button("打开文件夹").click();
    await settle();
    expect(host.textContent).toContain("打开文件夹失败，请稍后重试");
    expect(host.textContent).not.toContain("native picker failed");
    expect(
      host.querySelector<HTMLElement>("footer span[title]")?.getAttribute("title"),
    ).toBe("dialog: native picker failed");

    mocks.pickFolder.mockResolvedValueOnce({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValueOnce(folder("/notes"));
    button("打开文件夹").click();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).not.toContain("打开文件夹失败，请稍后重试");
  });

  it("confirms a folder switch and keeps the current file on cancel", async () => {
    await openFile();
    expect(host.textContent).toContain("a.md");

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("切换到“second”");
    expect(dialogButton("切换").className).toContain("button-primary");
    expect(dialogButton("切换").className).not.toContain(
      "border-[var(--accent-primary)]",
    );
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
    sidebarButton("切换文件夹").click();
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
    sidebarButton("切换文件夹").click();
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

    expect(host.textContent).toContain("没有权限保存这个文件");
    expect(host.textContent).not.toContain("permission denied");
    expect(
      host.querySelector('[role="status"] span[title]')?.getAttribute("title"),
    ).toContain("permission denied");
    expect(host.textContent).toContain("重试");
    const tab = host.querySelector('[role="tab"]');
    expect(tab?.querySelector('[role="img"]')).not.toBeNull();

    mocks.writeFile.mockResolvedValue(undefined);
    button("重试").click();
    await settle();
    expect(host.textContent).not.toContain("没有权限保存这个文件");
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

describe("autosave during IME composition", () => {
  function startComposition() {
    const view = editorView();
    view.focus();
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    return view;
  }

  function endComposition() {
    editorView().contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  }

  it("holds a due save while composing and restarts the delay after it ends", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 光X标\n");
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("编辑中");

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    // The retry keeps rechecking instead of dropping the save.
    await vi.advanceTimersByTimeAsync(4500);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(host.querySelector("footer")?.textContent).toContain("编辑中");

    endComposition();
    await settle();
    // Restarted from the composition end, not from the pending recheck.
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 光X标\n", 1);
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
  });

  it("does not save when a cancelled composition restores the disk text", async () => {
    vi.useFakeTimers();
    await openFile();
    const view = startComposition();
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, insert: "拼" },
      selection: { anchor: at + 1 },
      userEvent: "input.type.compose",
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    view.dispatch({
      changes: { from: at, to: at + 1 },
      userEvent: "input.type.compose",
    });
    await settle();
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
  });

  it("only holds the composing tab, not another tab's autosave", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    replaceEditorText("# B changed\n");
    tabNamed("a.md").click();
    await settle();
    startComposition();
    replaceEditorText("# A changed\n");
    await settle();

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("b.md", "# B changed\n", 1);

    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A changed\n", 1);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  });

  it("resumes saving after a tab switch when compositionend never arrives", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    // The view is destroyed while CodeMirror still reports a composition;
    // no compositionend ever comes for it.
    tabNamed("b.md").click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
  });

  it("resumes saving after the editor loses focus without compositionend", async () => {
    vi.useFakeTimers();
    await openFile();
    const view = startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    view.contentDOM.blur();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
  });

  it("saves the composing text when the tab closes", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    tabNamed("a.md")
      .querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!
      .click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
    expect(tabElements()).toHaveLength(0);
  });

  it("saves the composing text when switching folders", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    const pick = deferred<{ path: string; canceled: boolean }>();
    mocks.pickFolder.mockImplementation(() => pick.promise);
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    pick.resolve({ path: "/second", canceled: false });
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
    expect(dialog()?.textContent).toContain("切换到“second”");
    dialogButton("取消").click();
    await settle();
  });

  it("saves the composing text when the page hides", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
  });

  it("saves the composing text when the window close is requested", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    await closeHandler?.(31);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
    expect(mocks.finishClose).toHaveBeenCalledWith(31, true);
  });

  it("keeps writing recovery copies with the composing text", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ text: "# 拼\n" }),
      1,
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps external-modification pausing in effect across a composition", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");

    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
  });

  it("leaves the global shortcut behavior during composition unchanged", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");

    const save = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(save);
    await settle();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
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

  it("does not write queued edits after a write-time external change", async () => {
    vi.useFakeTimers();
    await openFile();
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);

    replaceEditorText("# First\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    replaceEditorText("# Second\n");
    await settle();
    write.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it("does not recreate a file removed during a write", async () => {
    vi.useFakeTimers();
    await openFile();
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);

    replaceEditorText("# First\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    replaceEditorText("# Second\n");
    await settle();
    write.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it("stops a forced save after a newer external event", async () => {
    vi.useFakeTimers();
    await openFile();
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");

    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);
    button("重新保存").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    replaceEditorText("# Typed during forced save\n");
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    write.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
  });

  it("uses the revision from when keep-mine was clicked", async () => {
    vi.useFakeTimers();
    await openFile();
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);

    replaceEditorText("# Mine\n");
    await vi.advanceTimersByTimeAsync(1000);
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    button("保留我的版本").click();
    await settle();

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    write.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    expect(host.querySelector("footer")?.textContent).toContain(
      "已暂停自动保存",
    );
  });

  it("does not accept a forced resave that raced an external rebuild", async () => {
    vi.useFakeTimers();
    await openFile();
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");

    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);
    button("重新保存").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    watchEvents?.([{ op: "create", path: "a.md", isDir: false }]);
    await settle();
    write.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    expect(host.querySelector("footer")?.textContent).toContain(
      "已暂停自动保存",
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
    );
    await settle();
    expect(dialog()?.textContent).toContain("关闭");
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

  it("shows the deletion banner and puts the recreated file back in the tree", async () => {
    await openFile();
    tree = [];
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");
    expect(host.querySelector('[data-tree-path="a.md"]')).toBeNull();

    tree = [entry("a.md", "a.md")];
    button("重新保存").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A\n", 1);
    expect(host.textContent).not.toContain("此文件已在磁盘上被删除或移走");
    expect(host.querySelector('[data-tree-path="a.md"]')).not.toBeNull();
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
  it("prunes deleted and non-markdown renamed files from recent files", async () => {
    await setupWorkspace({
      "a.md": "# A\n",
      "b.md": "# B\n",
      "notes/c.md": "# C\n",
      "notes-old/a.md": "# Old A\n",
    });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    await openPath("/notes/notes/c.md");
    await openPath("/notes/notes-old/a.md");
    await vi.waitFor(() => {
      expect(mocks.saveWorkspaceTabs.mock.calls.at(-1)?.[3]).toEqual([
        "notes-old/a.md",
        "notes/c.md",
        "b.md",
        "a.md",
      ]);
    });

    watchEvents?.([{ op: "remove", path: "notes", isDir: true }]);
    await settle();
    await vi.waitFor(() => {
      expect(mocks.saveWorkspaceTabs.mock.calls.at(-1)?.[3]).toEqual([
        "notes-old/a.md",
        "b.md",
        "a.md",
      ]);
    });

    watchEvents?.([
      { op: "rename", oldPath: "a.md", path: "a.txt", isDir: false },
    ]);
    await settle();
    await vi.waitFor(() => {
      expect(mocks.saveWorkspaceTabs.mock.calls.at(-1)?.[3]).toEqual([
        "notes-old/a.md",
        "b.md",
      ]);
    });

    watchEvents?.([
      { op: "rename", oldPath: "b.md", path: "d.md", isDir: false },
    ]);
    await settle();
    await vi.waitFor(() => {
      expect(mocks.saveWorkspaceTabs.mock.calls.at(-1)?.[3]).toEqual([
        "notes-old/a.md",
        "d.md",
      ]);
    });
  });

  it("clears the expected rename when RenameEntry fails", async () => {
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

    mocks.renameEntry.mockRejectedValue(new Error("exists"));
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

    watchEvents?.([
      { op: "rename", oldPath: "notes", path: "notes2", isDir: true },
    ]);
    await settle();
    expect(host.textContent).not.toContain("此文件已在磁盘上被删除或移走");
    expect(host.querySelector('[role="tab"]')?.getAttribute("title")).toBe(
      "notes/notes2/a.md",
    );
  });
});

describe("single files and dialogs", () => {
  it("opens a single file as a tab without discarding the workspace tab", async () => {
    await openFile();
    replaceEditorText("# Edited\n");

    pendingFiles = ["/tmp/other.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    expect(dialog()).toBeNull();
    const tabNames = [...host.querySelectorAll('[role="tab"]')].map(
      (tab) => tab.textContent ?? "",
    );
    expect(tabNames.some((name) => name.includes("a.md"))).toBe(true);
    expect(tabNames.some((name) => name.includes("other.md"))).toBe(true);
    expect(host.querySelectorAll(".cm-editor").length).toBe(1);
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

  it("keeps the outline toggle and close-tab command for a single-file tab", async () => {
    await settle();
    expect(
      host.querySelector('button[aria-label^="显示或隐藏大纲"]'),
    ).toBeNull();

    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    expect(host.textContent).not.toContain("开始写作");
    const outline = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="显示或隐藏大纲"]',
    );
    expect(outline).not.toBeNull();
    expect(outline!.disabled).toBe(true);

    pressPaletteShortcut("P");
    await settle();
    typePalette("标签页");
    await settle();
    expect(
      paletteOptions().some((item) => item.textContent?.includes("关闭标签页")),
    ).toBe(true);
    expect(
      paletteOptions().some((item) =>
        item.textContent?.includes("重新打开关闭的标签页"),
      ),
    ).toBe(false);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();

    const close = pressAppShortcut("w");
    await settle();
    expect(close.defaultPrevented).toBe(true);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(host.textContent).toContain("开始写作");
    expect(
      host.querySelector('button[aria-label^="显示或隐藏大纲"]'),
    ).toBeNull();
  });

  it("opens a single-file tab even when another tab has a save failure", async () => {
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

    expect(dialog()).toBeNull();
    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(editorView().state.doc.toString()).toBe("# Single\n");
    expect(host.querySelectorAll('[role="tab"]').length).toBe(2);
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
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();

    await closeHandler?.(7);
    await settle();
    expect(dialog()).toBeNull();
    expect(mocks.finishClose).toHaveBeenCalledWith(7, true);
  });
});

describe("theme and accessibility", () => {
  it("toggles an explicit theme from the sidebar footer", async () => {
    await settle();
    const startTheme = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(startTheme).not.toBeNull();
    expect(host.querySelector("aside")).toBeNull();
    await openFile();
    expect(
      host.querySelector('aside button[aria-label="切换到暗色主题"]'),
    ).not.toBeNull();
    const themeButtons = host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(themeButtons).toHaveLength(1);
    expect(
      host.querySelector('footer button[aria-label^="切换到"]'),
    ).toBeNull();
    themeButtons[0]!.click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("keeps the sidebar theme toggle on a non-Markdown placeholder", async () => {
    tree = [
      entry("cover.png", "cover.png", { isMarkdown: false, size: 2048 }),
    ];
    await openFolder();
    host.querySelector<HTMLElement>('[data-tree-path="cover.png"]')!.click();
    await settle();
    expect(host.textContent).toContain("无法预览此类型的文件");
    expect(
      host.querySelector('aside button[aria-label="切换到暗色主题"]'),
    ).not.toBeNull();
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

  it("dispatches open-folder and new-file from the registry", async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "o",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(mocks.pickFolder).toHaveBeenCalledOnce();
    expect(mocks.openFolder).toHaveBeenCalledWith("/notes");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="新建文件"]'),
    ).not.toBeNull();
  });

  it("saves immediately with the registry shortcut", async () => {
    await openFile();
    replaceEditorText("# Saved now\n");
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Saved now\n", 1);
  });

  it("switches modes with registry shortcuts", async () => {
    await openFile();
    const press = (key: string) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );

    press("2");
    await settle();
    expect(
      buttons("沉浸").find((item) => item.closest("header"))?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");

    press("3");
    await settle();
    expect(
      buttons("源码").find((item) => item.closest("header"))?.getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("does not run editor shortcuts while the file tree has focus", async () => {
    await openFile();
    const row = host.querySelector<HTMLElement>('[data-tree-path="a.md"]');
    expect(row).not.toBeNull();
    row!.focus();
    row!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("skips unavailable placeholder shortcuts", async () => {
    await openFile();
    const search = new KeyboardEvent("keydown", {
      key: "f",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(search);
    expect(search.defaultPrevented).toBe(false);

    const outline = new KeyboardEvent("keydown", {
      key: "o",
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(outline);
    expect(outline.defaultPrevented).toBe(false);
  });

  it("swallows tab shortcuts when their commands cannot run", async () => {
    await settle();
    const startClose = pressAppShortcut("w");
    const startReopen = pressAppShortcut("T", true);
    await settle();
    expect(startClose.defaultPrevented).toBe(true);
    expect(startReopen.defaultPrevented).toBe(true);
    expect(host.textContent).not.toContain("没有可重新打开的标签页");

    await openFolder();
    const emptyClose = pressAppShortcut("w");
    await settle();
    expect(emptyClose.defaultPrevented).toBe(true);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("ignores Escape during composition when the sidebar is an overlay", async () => {
    await openFile();
    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
      await settle();
      expect(host.querySelector("aside")).toBeNull();

      host.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")!.click();
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(escape);
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(escape.defaultPrevented).toBe(false);
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
  });

  it("keeps the overlay sidebar beneath a dialog and restores focus after cancel", async () => {
    await openFile();
    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
      await settle();
      host.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")!.click();
      await settle();
      const switchFolder = sidebarButton("切换文件夹");
      switchFolder.focus();

      mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
      switchFolder.click();
      await settle();
      const aside = host.querySelector<HTMLElement>("aside");
      expect(aside).not.toBeNull();
      expect(aside?.classList.contains("sidebar--overlay")).toBe(true);
      expect(dialog()).not.toBeNull();
      expect(document.activeElement).toBe(dialogButton("取消"));

      dialogButton("取消").click();
      await settle();
      expect(host.querySelector("aside")).toBe(aside);
      expect(document.activeElement).toBe(switchFolder);
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
  });

  it("restores focus to the file tree after cancelling folder deletion", async () => {
    tree = [entry("old", "old", { isDir: true })];
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries: path === "." ? tree : [],
    }));
    await openFolder();
    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
      await settle();
      host.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")!.click();
      await settle();
      const row = host.querySelector<HTMLElement>('[data-tree-path="old"]');
      expect(row).not.toBeNull();
      row!.focus();
      row!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Backspace",
          code: "Backspace",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(dialog()).not.toBeNull();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(dialogButton("取消"));

      dialogButton("取消").click();
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(row);
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
  });

  it("isolates CodeMirror layers inside the editor host", async () => {
    await openFile();
    const editorHost = host.querySelector<HTMLElement>("[data-editor-host]");
    expect(editorHost).not.toBeNull();
    expect(editorHost?.classList.contains("isolate")).toBe(true);
  });

  it("ignores app shortcuts while a dialog is open", async () => {
    await openFile();
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(host.querySelectorAll('[role="tab"]').length).toBe(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "w",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(dialog()).not.toBeNull();
    expect(host.querySelectorAll('[role="tab"]').length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("closes only the tab with Ctrl+W on Windows", async () => {
    app?.unmount();
    mocks.getAppInfo.mockResolvedValue({
      version: "0.0.1",
      os: "win32",
      arch: "x64",
      goVersion: "go1.27",
      homeDir: "C:\\Users\\tester",
    });
    app = createApp(App);
    app.mount(host);
    await settle();
    await openFile();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "w",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(tabElements().length).toBe(0);
    expect(host.querySelector("aside")).not.toBeNull();
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

async function setupWorkspace(
  files: Record<string, string>,
  root = "/notes",
): Promise<void> {
  tree = Object.keys(files).map((path) => entry(path.split("/").at(-1)!, path));
  mocks.listFiles.mockResolvedValue(Object.keys(files));
  mocks.readFile.mockImplementation(async (path: string) => files[path] ?? "");
  mocks.listDirectory.mockImplementation(async (path: string) => ({
    path,
    entries: path === "." ? tree : [],
  }));
  mocks.pickFolder.mockResolvedValue({ path: root, canceled: false });
  mocks.openFolder.mockResolvedValue(folder(root));
  await openFolder();
}

async function openPath(path: string): Promise<void> {
  pendingFiles = [path];
  openHandler?.();
  await settle();
}

function tabElements(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function tabNamed(name: string): HTMLElement {
  const found = tabElements().find((tab) =>
    tab.textContent?.replace(/\s+/g, "").includes(name),
  );
  if (!found) throw new Error(`tab ${name} not found`);
  return found;
}

describe("multi-tab shell", () => {
  it("keeps one editor view, restores selection and undo history", async () => {
    await setupWorkspace({ "a.md": "one\ntwo\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    let view = editorView();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "three\n" },
      selection: { anchor: 6, head: 9 },
    });
    await settle();

    tabNamed("b.md").click();
    await settle();
    expect(host.querySelectorAll(".cm-editor").length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# B\n");

    tabNamed("a.md").click();
    await settle();
    view = editorView();
    expect(host.querySelectorAll(".cm-editor").length).toBe(1);
    expect(view.state.doc.toString()).toBe("one\ntwo\nthree\n");
    expect(view.state.selection.main.from).toBe(6);
    expect(view.state.selection.main.to).toBe(9);

    view.focus();
    window.dispatchEvent(
      new CustomEvent("nicole:edit-command", { detail: "undo" }),
    );
    await settle();
    expect(editorView().state.doc.toString()).toBe("one\ntwo\n");
  });

  it("restores the scroll position of a background tab", async () => {
    await setupWorkspace({ "a.md": "one\ntwo\nthree\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();

    const blockForSecondLine = (view: EditorView) => {
      const line = view.state.doc.line(2);
      return {
        from: line.from,
        to: line.to,
        top: 10,
        bottom: 24,
        height: 14,
      };
    };
    const height = vi
      .spyOn(EditorView.prototype, "lineBlockAtHeight")
      .mockImplementation(function (this: EditorView) {
        return blockForSecondLine(this) as never;
      });
    const block = vi
      .spyOn(EditorView.prototype, "lineBlockAt")
      .mockImplementation(function (this: EditorView, pos: number) {
        const line = this.state.doc.lineAt(pos);
        return {
          from: line.from,
          to: line.to,
          top: 10,
          bottom: 24,
          height: 14,
        } as never;
      });
    // jsdom has no layout. Pin the padding instead of letting the new view
    // measure a different value than the view that recorded the position.
    const padding = vi
      .spyOn(EditorView.prototype, "documentPadding", "get")
      .mockReturnValue({ top: 48, bottom: 112 });
    try {
      const first = editorView();
      first.scrollDOM.scrollTop = 24;
      tabNamed("b.md").click();
      await settle();
      tabNamed("a.md").click();
      await settle();
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const restored = editorView();
      const restoredBlock = blockForSecondLine(restored);
      expect(restored.scrollDOM.scrollTop).toBe(24);
      expect(restored.state.doc.lineAt(restoredBlock.from).number).toBe(2);
    } finally {
      height.mockRestore();
      block.mockRestore();
      padding.mockRestore();
    }
  });

  it("saves the model's own path while another tab is active", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    tabNamed("a.md").click();
    await settle();
    replaceEditorText("# Mine\n");
    const write = deferred<void>();
    mocks.writeFile.mockImplementation(() => write.promise);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Mine\n", 1);

    tabNamed("b.md").click();
    await settle();
    write.resolve();
    await settle();
    expect(editorView().state.doc.toString()).toBe("# B\n");
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    for (const call of mocks.writeFile.mock.calls) {
      expect(call[0]).toBe("a.md");
    }
  });

  it("saves a background tab to its own path when its autosave fires", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    replaceEditorText("# Background save\n");
    tabNamed("b.md").click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "# Background save\n",
      1,
    );
    expect(editorView().state.doc.toString()).toBe("# B\n");
  });

  it("confirms closing a failed tab from the dot, shortcut, middle click and menu", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    mocks.writeFile.mockRejectedValue(new Error("permission denied"));
    replaceEditorText("# Unsaved\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    const dot = tabNamed("a.md").querySelector<HTMLButtonElement>(
      'button[aria-label^="关闭"]',
    );
    expect(dot).not.toBeNull();
    dot!.click();
    await settle();
    expect(dialog()?.textContent).toContain("关闭“a.md”");
    dialogButton("取消").click();
    await settle();
    expect(tabElements().length).toBe(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", metaKey: true, bubbles: true }),
    );
    await settle();
    expect(dialog()).not.toBeNull();
    dialogButton("取消").click();
    await settle();

    tabNamed("a.md").dispatchEvent(
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(dialog()).not.toBeNull();
    dialogButton("取消").click();
    await settle();

    mocks.popupNativeMenu.mockResolvedValue("close-tab");
    tabNamed("a.md").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    await settle();
    expect(dialog()).not.toBeNull();
    dialogButton("放弃更改并关闭").click();
    await settle();
    expect(tabElements().length).toBe(0);
    expect(host.textContent).toContain("选择一个文件开始写作");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await settle();
    expect(tabElements().length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("confirms closing a tab from the deletion banner", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    button("关闭标签页").click();
    await settle();
    expect(dialog()?.textContent).toContain("文件已在磁盘上被删除或移走");
    dialogButton("取消").click();
    await settle();
    expect(tabElements().length).toBe(1);
  });

  it("confirms a batch close that contains a failed tab", async () => {
    vi.useFakeTimers();
    await setupWorkspace({
      "a.md": "# A\n",
      "b.md": "# B\n",
      "c.md": "# C\n",
    });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    await openPath("/notes/c.md");
    mocks.writeFile.mockImplementation(async (path: string) => {
      if (path === "b.md") throw new Error("read-only");
    });
    tabNamed("b.md").click();
    await settle();
    replaceEditorText("# B edited\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    tabNamed("a.md").click();
    await settle();
    mocks.popupNativeMenu.mockResolvedValue("close-other-tabs");
    tabNamed("a.md").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    await settle();
    expect(dialog()?.textContent).toContain("关闭这些标签页");
    expect(dialog()?.textContent).toContain("b.md");
    expect(dialog()?.textContent).toContain("保存失败");
    dialogButton("取消").click();
    await settle();
    expect(tabElements().length).toBe(3);

    tabNamed("a.md").dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    await settle();
    dialogButton("放弃更改并关闭").click();
    await settle();
    expect(tabElements().length).toBe(1);
    expect(tabNamed("a.md")).not.toBeNull();
  });

  it("remembers tabs per root and restores the active selection", async () => {
    const stored = new Map<
      string,
      { tabs: import("./services/tabs").StoredTab[]; active: string }
    >();
    mocks.getWorkspaceTabs.mockImplementation(
      async (root: string) => stored.get(root) ?? { tabs: [], active: "" },
    );
    mocks.saveWorkspaceTabs.mockImplementation(
      async (
        root: string,
        tabs: import("./services/tabs").StoredTab[],
        active: string,
      ) => {
        stored.set(root, { tabs, active });
      },
    );
    await setupWorkspace({ "a.md": "alpha\nbeta\n", "b.md": "one\ntwo\n" });
    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    const view = editorView();
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("当前文件夹的 2 个标签页会关闭");
    expect(dialog()?.textContent).toContain("切回“notes”时会恢复这些标签页");
    dialogButton("切换").click();
    await settle();
    expect(host.textContent).toContain("选择一个文件开始写作");
    expect(stored.get("/notes")?.active).toBe("b.md");
    expect(stored.get("/notes")?.tabs.map((tab) => tab.path)).toEqual([
      "a.md",
      "b.md",
    ]);

    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();

    expect(tabElements().length).toBe(2);
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("one\ntwo\n");
    expect(editorView().state.selection.main.from).toBe(4);
    expect(editorView().state.selection.main.to).toBe(7);
  });

  it("restores tabs and selection after a restart", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "a.md" ? "alpha\nbeta\n" : "one\ntwo\n",
    );
    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [
        {
          kind: "markdown",
          path: "a.md",
          selection: { ranges: [{ anchor: 3, head: 5 }], main: 0 },
          scrollTopLine: 1,
          scrollTopOffset: 0,
        },
        { kind: "markdown", path: "b.md" },
      ],
      active: "b.md",
    });

    app = createApp(App);
    app.mount(host);
    await settle();

    expect(tabElements().length).toBe(2);
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("one\ntwo\n");
  });

  it("keeps single-file tabs out of the remembered workspace layout", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await openPath("/tmp/single.md");
    dialogButton("只打开这个文件").click();
    await settle();
    expect(tabElements().length).toBe(2);

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("1 个标签页会关闭");
    dialogButton("切换").click();
    await settle();

    expect(tabElements().length).toBe(1);
    expect(tabNamed("single.md")).not.toBeNull();
    expect(editorView().state.doc.toString()).toBe("# Single\n");
    const notesCall = mocks.saveWorkspaceTabs.mock.calls.find(
      (call) => call[0] === "/notes",
    );
    expect(notesCall).not.toBeUndefined();
    expect(notesCall![1].map((tab: { path: string }) => tab.path)).toEqual([
      "a.md",
    ]);
    expect(JSON.stringify(notesCall)).not.toContain("single.md");

    await closeTabNamed("single.md");
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/tmp/single.md");
  });

  it("follows an external rename of a background tab and saves to the new path", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    watchEvents?.([{ op: "rename", oldPath: "a.md", path: "c.md", isDir: false }]);
    await settle();
    expect(tabNamed("c.md").getAttribute("title")).toBe("notes/c.md");
    expect(host.textContent).not.toContain("已删除或移走");

    tabNamed("c.md").click();
    await settle();
    replaceEditorText("# Renamed\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledWith("c.md", "# Renamed\n", 1);
  });

  it("loads an external change into a background tab and marks deletion", async () => {
    await setupWorkspace({ "a.md": "one\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "a.md" ? "disk version\n" : "# B\n",
    );
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(host.textContent).not.toContain("已在 Nicole 之外被修改");
    tabNamed("a.md").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("disk version\n");

    tabNamed("b.md").click();
    await settle();
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(tabNamed("a.md").querySelector('[role="img"]')).not.toBeNull();
    tabNamed("a.md").click();
    await settle();
    expect(host.textContent).toContain("此文件已在磁盘上被删除或移走");
  });

  it("pauses a dirty background tab on an external change", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    replaceEditorText("# Mine\n");
    tabNamed("b.md").click();
    await settle();

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    tabNamed("a.md").click();
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps the top bar usable with fifteen tabs", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 15; index++) {
      files[`note-${index}.md`] = `# ${index}\n`;
    }
    await setupWorkspace(files);
    const scroll = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      for (const path of Object.keys(files)) {
        await openPath(`/notes/${path}`);
      }
      expect(tabElements().length).toBe(15);
      expect(tabElements().at(-1)?.getAttribute("aria-selected")).toBe("true");
      expect(
        host
          .querySelector('[role="tablist"]')
          ?.className.includes("overflow-x-auto"),
      ).toBe(true);
      expect(scroll).toHaveBeenCalled();
      expect(
        host.querySelector('[role="group"][aria-label="编辑模式"]'),
      ).not.toBeNull();
    } finally {
      if (original) {
        HTMLElement.prototype.scrollIntoView = original;
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown })
          .scrollIntoView;
      }
    }
  });

  it("moves tab focus with the arrow keys and activates with Enter", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    const first = tabElements()[0]!;
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.activeElement).toBe(tabElements()[1]);
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(tabElements()[1]!.getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# B\n");
  });

  it("shows the same-name disambiguation suffix", async () => {
    tree = [
      entry("essay", "essay", { isDir: true }),
      entry("travel", "travel", { isDir: true }),
    ];
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries:
        path === "."
          ? tree
          : path === "essay"
            ? [entry("README.md", "essay/README.md")]
            : path === "travel"
              ? [entry("README.md", "travel/README.md")]
              : [],
    }));
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "essay/README.md" ? "essay\n" : "travel\n",
    );
    await openFolder();
    host.querySelector<HTMLElement>('[data-tree-path="essay"]')!.click();
    await settle();
    host.querySelector<HTMLElement>('[data-tree-path="travel"]')!.click();
    await settle();
    host.querySelector<HTMLElement>('[data-tree-path="essay/README.md"]')!.click();
    await settle();
    host.querySelector<HTMLElement>('[data-tree-path="travel/README.md"]')!.click();
    await settle();

    const labels = tabElements().map((tab) =>
      [...tab.querySelectorAll("span")]
        .map((span) => span.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" "),
    );
    expect(labels).toEqual(["README.md essay", "README.md travel"]);
  });
});

async function closeTabNamed(name: string): Promise<void> {
  const tab = tabNamed(name);
  const close = tab.querySelector<HTMLButtonElement>("button:not([role])");
  if (close) {
    close.click();
  } else {
    tab.dispatchEvent(
      new MouseEvent("auxclick", {
        button: 1,
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  await settle();
}

describe("tab persistence on close", () => {
  it("writes the active tab and selection before finishing a window close", async () => {
    let savedLayout:
      | {
          root: string;
          tabs: import("./services/tabs").StoredTab[];
          active: string;
        }
      | undefined;
    mocks.getWorkspaceTabs.mockResolvedValue({ tabs: [], active: "" });
    mocks.saveWorkspaceTabs.mockImplementation(
      async (
        root: string,
        tabs: import("./services/tabs").StoredTab[],
        active: string,
      ) => {
        savedLayout = { root, tabs, active };
      },
    );
    await setupWorkspace({ "a.md": "# A\n", "b.md": "one\ntwo\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    editorView().dispatch({ selection: { anchor: 1, head: 4 } });
    await settle();

    await closeHandler?.(9);
    await settle();

    expect(mocks.finishClose).toHaveBeenCalledWith(9, true);
    expect(savedLayout?.root).toBe("/notes");
    expect(savedLayout?.active).toBe("b.md");
    expect(savedLayout?.tabs.map((tab) => tab.path)).toEqual(["a.md", "b.md"]);
    expect(savedLayout?.tabs[1]?.selection).toEqual({
      ranges: [{ anchor: 1, head: 4 }],
      main: 0,
    });
  });
});

describe("folder switch with problem tabs", () => {
  it("lists save failures and uses the discard label", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    mocks.writeFile.mockRejectedValue(new Error("read-only"));
    replaceEditorText("# Unsaved\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()?.textContent).toContain("放弃更改并切换");
    expect(dialog()?.textContent).toContain("a.md：保存失败");
    dialogButton("取消").click();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledTimes(1);
    expect(editorView().state.doc.toString()).toBe("# Unsaved\n");
  });
});

describe("review round 1 fixes", () => {
  it("opens one workspace tab when the same file is clicked twice during a read", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "a.md" ? read.promise : Promise.resolve(""),
    );
    const row = host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!;
    row.click();
    row.click();
    await settle();
    expect(mocks.readFile).toHaveBeenCalledTimes(1);

    read.resolve("# A\n");
    await settle();
    expect(tabElements().length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("opens one single-file tab for concurrent requests", async () => {
    await mountAppWithApi();
    const read = deferred<string>();
    mocks.readSingleFile.mockImplementation(() => read.promise);

    const first = exposedApp!.value.openSingleFile("/tmp/single.md", "single.md");
    const second = exposedApp!.value.openSingleFile("/tmp/single.md", "single.md");
    await settle();
    expect(mocks.acceptSingleFile).toHaveBeenCalledTimes(1);
    expect(mocks.readSingleFile).toHaveBeenCalledTimes(1);

    read.resolve("# Single\n");
    await Promise.all([first, second]);
    await settle();
    expect(tabElements().length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# Single\n");
  });

  it("does not reuse an old root's read for the same path in a new root", async () => {
    await setupWorkspace({ "a.md": "# Old\n" });
    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    const oldRead = deferred<string>();
    const newRead = deferred<string>();
    let reads = 0;
    mocks.readFile.mockImplementation((path: string) => {
      if (path !== "a.md") return Promise.resolve("");
      reads += 1;
      return reads === 1 ? oldRead.promise : newRead.promise;
    });

    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();

    const newRow = host.querySelector<HTMLElement>('[data-tree-path="a.md"]');
    expect(newRow).not.toBeNull();
    newRow!.click();
    await settle();
    expect(reads).toBe(2);

    oldRead.resolve("# Old\n");
    await settle();
    expect(tabElements().length).toBe(0);
    newRead.resolve("# New\n");
    await settle();
    expect(tabElements().length).toBe(1);
    expect(editorView().state.doc.toString()).toBe("# New\n");
    expect(tabNamed("a.md").getAttribute("title")).toBe("second/a.md");
  });

  it("drops a workspace read that finishes after the folder changed", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "a.md" ? read.promise : Promise.resolve(""),
    );
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(host.textContent).toContain("选择一个文件开始写作");

    read.resolve("# A\n");
    await settle();
    expect(tabElements().length).toBe(0);
    expect(host.textContent).toContain("选择一个文件开始写作");
  });

  it("does not show a read error from a folder that is no longer current", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "a.md" ? read.promise : Promise.resolve(""),
    );
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();

    read.reject(new Error("gone"));
    await settle();
    expect(host.textContent).not.toContain("读取失败");
    expect(tabElements().length).toBe(0);
  });

  it("drops a reopened read that finishes after the folder changed", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await closeTabNamed("a.md");
    expect(tabElements().length).toBe(0);

    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "a.md" ? read.promise : Promise.resolve(""),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    read.resolve("# A\n");
    await settle();
    expect(tabElements().length).toBe(0);
    expect(host.textContent).toContain("选择一个文件开始写作");
  });

  it("saves to the new path when a rename lands during a write", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    replaceEditorText("# Edited\n");

    const firstWrite = deferred<void>();
    let held = true;
    mocks.writeFile.mockImplementation(() => {
      if (held) {
        held = false;
        return firstWrite.promise;
      }
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# Edited\n", 1);

    watchEvents?.([{ op: "rename", oldPath: "a.md", path: "b.md", isDir: false }]);
    await settle();
    firstWrite.resolve();
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledWith("b.md", "# Edited\n", 1);
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
    expect(tabNamed("b.md").getAttribute("title")).toBe("notes/b.md");
  });

  it("does not persist an empty layout while restoring tabs", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [
        { kind: "markdown", path: "a.md" },
        { kind: "markdown", path: "b.md" },
      ],
      active: "a.md",
    });
    const first = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "a.md" ? first.promise : Promise.resolve("# B\n"),
    );

    app = createApp(App);
    app.mount(host);
    await settle();

    const hidden = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(
      mocks.saveWorkspaceTabs.mock.calls.some(
        (call) =>
          call[0] === "/notes" &&
          Array.isArray(call[1]) &&
          call[1].length === 0,
      ),
    ).toBe(false);
    hidden.mockRestore();

    first.resolve("# A\n");
    await settle();
    expect(tabElements().length).toBe(2);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
  });

  it("serializes startup restore with a folder operation", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    const opening = deferred<ReturnType<typeof folder>>();
    mocks.openFolder.mockReturnValue(opening.promise);

    app = createApp(App);
    app.mount(host);
    await settle();
    button("打开文件夹").click();
    await settle();
    expect(mocks.pickFolder).not.toHaveBeenCalled();

    opening.resolve(folder("/notes"));
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
  });

  it("saves every dirty tab before finishing a window close", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    tabNamed("a.md").click();
    await settle();
    replaceEditorText("# A edited\n");
    tabNamed("b.md").click();
    await settle();
    replaceEditorText("# B edited\n");

    await openPath("/tmp/single.md");
    dialogButton("只打开这个文件").click();
    await settle();
    replaceEditorText("# Single edited\n");

    await closeHandler?.(55);
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A edited\n", 1);
    expect(mocks.writeFile).toHaveBeenCalledWith("b.md", "# B edited\n", 1);
    expect(mocks.writeSingleFile).toHaveBeenCalledWith(
      "/tmp/single.md",
      "# Single edited\n",
    );
    expect(mocks.finishClose).toHaveBeenCalledWith(55, true);
  });
});

describe("review round 2 fixes", () => {
  it("releases a single-file grant when the read fails", async () => {
    await mountAppWithApi();
    mocks.readSingleFile.mockRejectedValue(new Error("gone"));

    const opened = await exposedApp!.value.openSingleFile(
      "/tmp/single.md",
      "single.md",
    );
    await settle();

    expect(opened).toBe(false);
    expect(host.textContent).toContain("读取失败：gone");
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/tmp/single.md");
    expect(tabElements().length).toBe(0);
  });

  it("reuses the single-file tab when the same file is opened as a workspace file", async () => {
    await mountAppWithApi();
    const opened = exposedApp!.value.openSingleFile("/notes/s.md", "s.md");
    await settle();
    await opened;
    expect(tabElements().length).toBe(1);

    tree = [entry("s.md", "s.md")];
    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    await exposedApp!.value.chooseFolder();
    await settle();
    mocks.readFile.mockClear();

    await openPath("/notes/s.md");
    expect(tabElements().length).toBe(1);
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(tabNamed("s.md").getAttribute("aria-selected")).toBe("true");
  });

  it("keeps one workspace tab when a file inside the root is opened as a single file", async () => {
    await mountAppWithApi();
    await setupWorkspace({ "s.md": "# S\n" });
    await openPath("/notes/s.md");
    expect(tabElements().length).toBe(1);

    mocks.acceptSingleFile.mockClear();
    const opened = await exposedApp!.value.openSingleFile(
      "/notes/s.md",
      "s.md",
    );
    await settle();

    expect(opened).toBe(true);
    expect(mocks.acceptSingleFile).not.toHaveBeenCalled();
    expect(tabElements().length).toBe(1);
  });

  it("does not duplicate a file opened while its tab is being restored", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    const stored = deferred<{
      tabs: import("./services/tabs").StoredTab[];
      active: string;
    }>();
    mocks.getWorkspaceTabs.mockReturnValue(stored.promise);
    mocks.readFile.mockResolvedValue("# A\n");

    await mountAppWithApi();
    await vi.waitFor(() =>
      expect(mocks.getWorkspaceTabs).toHaveBeenCalledWith("/notes"),
    );
    expect(tabElements().length).toBe(0);

    const opened = exposedApp!.value.openWorkspaceFile("a.md", "a.md");
    await settle();
    expect(tabElements().length).toBe(1);

    stored.resolve({
      tabs: [{ kind: "markdown", path: "a.md" }],
      active: "a.md",
    });
    await opened;
    await settle();

    expect(tabElements().length).toBe(1);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });
});

describe("review round 3 fixes", () => {
  it("restores a single-file tab instead of a duplicate workspace tab", async () => {
    await mountAppWithApi();
    const opened = exposedApp!.value.openSingleFile("/notes/sub/s.md", "s.md");
    await settle();
    await opened;
    expect(tabElements().length).toBe(1);

    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [{ kind: "markdown", path: "sub/s.md" }],
      active: "sub/s.md",
    });
    mocks.readFile.mockResolvedValue("# S\n");
    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    await exposedApp!.value.chooseFolder();
    await settle();

    expect(tabElements().length).toBe(1);
    expect(tabElements()[0]!.getAttribute("title")).toBe("/notes/sub/s.md");
    expect(tabElements()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("activates the single-file tab that replaces the restored active tab", async () => {
    await mountAppWithApi();
    tree = [entry("x.md", "x.md")];
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "x.md" ? "# X\n" : "",
    );
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries: path === "." ? tree : [],
    }));
    mocks.pickFolder.mockResolvedValue({ path: "/other", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/other"));
    button("打开文件夹").click();
    await settle();
    host.querySelector<HTMLElement>('[data-tree-path="x.md"]')!.click();
    await settle();

    const opened = exposedApp!.value.openSingleFile("/notes/sub/s.md", "s.md");
    await settle();
    await opened;
    tabNamed("x.md").click();
    await settle();

    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [{ kind: "markdown", path: "sub/s.md" }],
      active: "sub/s.md",
    });
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "sub/s.md" ? "# S\n" : "# X\n",
    );
    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/notes", 2));
    const switching = exposedApp!.value.chooseFolder();
    await settle();
    dialogButton("切换").click();
    await switching;
    await settle();

    expect(tabElements().length).toBe(1);
    expect(tabElements()[0]!.getAttribute("title")).toBe("/notes/sub/s.md");
    expect(tabElements()[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps a tab opened during restore active when nothing is remembered", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    const stored = deferred<{
      tabs: import("./services/tabs").StoredTab[];
      active: string;
    }>();
    mocks.getWorkspaceTabs.mockReturnValue(stored.promise);
    mocks.readFile.mockResolvedValue("# C\n");

    await mountAppWithApi();
    await vi.waitFor(() =>
      expect(mocks.getWorkspaceTabs).toHaveBeenCalledWith("/notes"),
    );
    const opened = exposedApp!.value.openWorkspaceFile("c.md", "c.md");
    await settle();
    await opened;
    expect(tabNamed("c.md").getAttribute("aria-selected")).toBe("true");

    stored.resolve({ tabs: [], active: "" });
    await settle();

    expect(tabElements().length).toBe(1);
    expect(tabNamed("c.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# C\n");
  });

  it("keeps a tab opened during restore active when another tab is remembered", async () => {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    const stored = deferred<{
      tabs: import("./services/tabs").StoredTab[];
      active: string;
    }>();
    mocks.getWorkspaceTabs.mockReturnValue(stored.promise);
    mocks.readFile.mockImplementation(async (path: string) =>
      path === "a.md" ? "# A\n" : "# C\n",
    );

    await mountAppWithApi();
    await vi.waitFor(() =>
      expect(mocks.getWorkspaceTabs).toHaveBeenCalledWith("/notes"),
    );
    const opened = exposedApp!.value.openWorkspaceFile("c.md", "c.md");
    await settle();
    await opened;

    stored.resolve({
      tabs: [{ kind: "markdown", path: "a.md" }],
      active: "a.md",
    });
    await settle();

    expect(tabElements().length).toBe(2);
    expect(tabNamed("c.md").getAttribute("aria-selected")).toBe("true");
    expect(tabNamed("a.md").getAttribute("aria-selected")).not.toBe("true");
    expect(editorView().state.doc.toString()).toBe("# C\n");
  });
});

describe("command palette", () => {
  it("runs a pinyin command against the saved selection and remembers it", async () => {
    await openFile("a.md", "Alpha selection here\n");
    const view = editorView();
    const start = view.state.doc.toString().indexOf("selection");
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + "selection".length } });
    await settle();

    pressPaletteShortcut("P");
    await settle();
    expect(paletteInput().value).toBe("");
    expect(paletteOptions().some((item) => item.textContent?.includes("加粗"))).toBe(
      true,
    );
    expect(paletteOptions().some((item) => item.textContent?.includes("设置"))).toBe(
      false,
    );
    expect(
      paletteOptions().some((item) => item.textContent?.includes("全文搜索")),
    ).toBe(false);
    expect(
      paletteOptions().some((item) => item.textContent?.includes("重命名")),
    ).toBe(false);

    typePalette("jiacu");
    await vi.waitFor(() =>
      expect(paletteOptions()[0]?.textContent ?? "").toContain("加粗"),
    );
    // The palette must restore the selection captured on open instead of
    // trusting whatever position the editor had while the input held focus.
    editorView().dispatch({ selection: { anchor: 0 } });
    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();

    expect(editorView().state.doc.toString()).toBe(
      "Alpha **selection** here\n",
    );
    expect(localStorage.getItem("nicole:commands:recent")).toContain(
      "format.bold",
    );

    pressPaletteShortcut("P");
    await settle();
    expect(paletteOptions()[0]?.textContent ?? "").toContain("加粗");
  });

  it("does not offer editor commands without a Markdown tab", async () => {
    await settle();
    expect(
      host.querySelector('button[aria-label^="显示或隐藏大纲"]'),
    ).toBeNull();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOptions().some((item) => item.textContent?.includes("打开文件夹"))).toBe(
      true,
    );
    expect(paletteOptions().some((item) => item.textContent?.includes("加粗"))).toBe(
      false,
    );
    expect(
      paletteOptions().some((item) => item.textContent?.includes("关闭标签页")),
    ).toBe(false);
    expect(
      paletteOptions().some((item) =>
        item.textContent?.includes("重新打开关闭的标签页"),
      ),
    ).toBe(false);
  });

  it("offers tab commands once a tab is open", async () => {
    await openFile();
    pressPaletteShortcut("P");
    await settle();
    expect(
      paletteOptions().some((item) => item.textContent?.includes("关闭标签页")),
    ).toBe(true);
    expect(
      paletteOptions().some((item) =>
        item.textContent?.includes("重新打开关闭的标签页"),
      ),
    ).toBe(true);
  });

  it("lists markdown files with recent ones first and reuses an open tab", async () => {
    await setupWorkspace({
      "a.md": "# A\n",
      "b.md": "# B\n",
      "notes/c.md": "# C\n",
    });
    await openPath("/notes/b.md");
    await openPath("/notes/a.md");
    tabNamed("b.md");
    await settle();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(paletteInput().value).toBe("");
    expect(mocks.listFiles).toHaveBeenCalled();
    const labels = paletteOptions().map((item) =>
      item.querySelector(".truncate")?.textContent,
    );
    expect(labels).toEqual(["a.md", "b.md", "c.md"]);

    const bOption = paletteOptions().find((item) =>
      item.textContent?.includes("b.md"),
    );
    bOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(tabElements().length).toBe(2);
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");

    await vi.waitFor(() => {
      const latest = mocks.saveWorkspaceTabs.mock.calls.at(-1);
      expect(latest?.[0]).toBe("/notes");
      expect(latest?.[3]).toEqual(["b.md", "a.md"]);
    });
  });

  it("restores the recent file order from tabs.json after switching roots", async () => {
    const stored = new Map<
      string,
      {
        tabs: import("./services/tabs").StoredTab[];
        active: string;
        recentFiles?: string[];
      }
    >();
    mocks.getWorkspaceTabs.mockImplementation(
      async (root: string) => stored.get(root) ?? { tabs: [], active: "" },
    );
    mocks.saveWorkspaceTabs.mockImplementation(
      async (
        root: string,
        tabs: import("./services/tabs").StoredTab[],
        active: string,
        recentFiles: string[],
      ) => {
        stored.set(root, { tabs, active, recentFiles });
      },
    );
    await setupWorkspace({
      "a.md": "# A\n",
      "b.md": "# B\n",
      "c.md": "# C\n",
    });
    mocks.openFolder.mockImplementation(async (path: string) =>
      folder(path, path === "/notes" ? 1 : 2),
    );
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    await vi.waitFor(() => {
      expect(mocks.saveWorkspaceTabs.mock.calls.at(-1)?.[3]).toEqual([
        "b.md",
        "a.md",
      ]);
    });

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(stored.get("/notes")?.recentFiles).toEqual(["b.md", "a.md"]);

    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();

    pressAppShortcut("p");
    await settle();
    const labels = paletteOptions().map((item) =>
      item.querySelector(".truncate")?.textContent,
    );
    expect(labels).toEqual(["b.md", "a.md", "c.md"]);
  });

  it("lists headings by level and jumps to the selected line", async () => {
    const text = "# One\n\n## Two\n\n### Three\n";
    await openFile("a.md", text);
    const view = editorView();
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    const dispatch = vi.spyOn(view, "dispatch");
    pressPaletteShortcut("O");
    await settle();
    expect(paletteInput().value).toBe("");
    expect(paletteOptions().map((item) => item.textContent)).toEqual([
      expect.stringContaining("One"),
      expect.stringContaining("Two"),
      expect.stringContaining("Three"),
    ]);
    expect(paletteOptions()[1]?.getAttribute("style")).toContain(
      "padding-left: 20px",
    );

    paletteOptions()[1]!.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await settle();
    expect(editorView().state.selection.main.head).toBe(text.indexOf("## Two"));
    expect(scroll).toHaveBeenCalledWith(text.indexOf("## Two"), {
      y: "start",
    });
    const scrollEffect = scroll.mock.results[0]?.value;
    expect(
      dispatch.mock.calls.some(([spec]) => spec?.effects === scrollEffect),
    ).toBe(true);
    expect(
      editorView().dom.contains(document.activeElement),
    ).toBe(true);
  });

  it("extracts headings on the first heading mode and caches them", async () => {
    await openFile("a.md", "# Old\n");
    pressAppShortcut("p");
    await settle();
    expect(paletteInput().value).toBe("");
    expect(headingMocks.extract).not.toHaveBeenCalled();

    typePalette("@");
    await settle();
    expect(headingMocks.extract).toHaveBeenCalledTimes(1);
    expect(paletteInput().value).toBe("");
    expect(paletteOptions().map((item) => item.textContent)).toEqual([
      expect.stringContaining("Old"),
    ]);

    pressAppShortcut("p");
    await settle();
    pressAppShortcut("O", true);
    await settle();
    expect(headingMocks.extract).toHaveBeenCalledTimes(1);
    expect(paletteOptions().map((item) => item.textContent)).toEqual([
      expect.stringContaining("Old"),
    ]);
  });

  it("closes the palette when an external load changes the active document", async () => {
    await openFile("a.md", "# One\n\n## Two\n");
    pressPaletteShortcut("O");
    await settle();
    expect(paletteInput()).not.toBeNull();

    mocks.readFile.mockResolvedValue(
      "Intro paragraph\n\n# One\n\n## Two\n",
    );
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    await vi.waitFor(() => {
      expect(
        document.querySelector(
          '[role="combobox"][aria-label^="命令面板"]',
        ),
      ).toBeNull();
    });
  });

  it("does not jump to a heading position after an external change", async () => {
    const text = "# One\n\n## Two\n";
    await openFile("a.md", text);
    pressPaletteShortcut("O");
    await settle();
    const two = paletteOptions().find((item) =>
      item.textContent?.includes("Two"),
    );
    if (!two) throw new Error("heading option not found");

    const updated = `Intro paragraph\n\n${text}`;
    replaceEditorText(updated);
    const headAfterChange = editorView().state.selection.main.head;
    two.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(editorView().state.doc.toString()).toBe(updated);
    expect(editorView().state.selection.main.head).toBe(headAfterChange);
  });

  it("does not run an editor command against stale selection positions", async () => {
    await openFile("a.md", "abc def\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    await settle();

    pressPaletteShortcut("P");
    await settle();
    typePalette("jiacu");
    await vi.waitFor(() => {
      expect(paletteOptions()[0]?.textContent ?? "").toContain("加粗");
    });
    const bold = paletteOptions()[0]!;

    const updated = "XXXX abc def\n";
    replaceEditorText(updated);
    bold.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(editorView().state.doc.toString()).toBe(updated);
  });

  it("reports a partial heading extraction", async () => {
    await openFile("a.md", "# A\n");
    headingMocks.extract.mockReturnValueOnce({
      headings: [{ level: 1, text: "A", position: 0, line: 1 }],
      complete: false,
    });
    pressPaletteShortcut("O");
    await settle();
    expect(document.body.textContent).toContain(
      "文档较大，部分标题尚未解析",
    );
  });

  it("switches modes with shortcuts while keeping the query", async () => {
    await openFile("a.md", "# Heading\n");
    pressAppShortcut("p");
    await settle();
    typePalette("a");
    await settle();

    const command = pressAppShortcut("P", true);
    await settle();
    expect(command.defaultPrevented).toBe(true);
    expect(paletteInput().value).toBe("a");
    expect(paletteInput().getAttribute("aria-label")).toContain("命令");

    pressAppShortcut("O", true);
    await settle();
    expect(paletteInput().value).toBe("a");
    expect(paletteInput().getAttribute("aria-label")).toContain("标题");

    const file = pressAppShortcut("p");
    await settle();
    expect(file.defaultPrevented).toBe(true);
    expect(paletteInput().value).toBe("a");
    expect(paletteInput().getAttribute("aria-label")).toContain("文件名");

    pressAppShortcut("p");
    await settle();
    expect(paletteInput().value).toBe("a");
    expect(paletteInput().getAttribute("aria-label")).toContain("文件名");
  });

  it("announces modes switched by palette shortcuts", async () => {
    await openFile("a.md", "# Heading\n");
    pressAppShortcut("p");
    await settle();
    const region = paletteAnnouncement();
    vi.useFakeTimers();
    await settlePaletteAnnouncement();
    expect(region.textContent).toBe("");

    pressAppShortcut("P", true);
    await settlePaletteAnnouncement();
    expect(region.textContent).toBe("命令模式");

    pressAppShortcut("O", true);
    await settlePaletteAnnouncement();
    expect(region.textContent).toBe("标题模式");

    pressAppShortcut("p");
    await settlePaletteAnnouncement();
    expect(region.textContent).toBe("文件模式");

    pressAppShortcut("p");
    await settle();
    expect(region.textContent).toBe("");
    await settlePaletteAnnouncement();
    expect(region.textContent).toBe("文件模式");
  });

  it("does not close the tab with the palette open outside the input", async () => {
    await openFile();
    pressAppShortcut("p");
    await settle();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    pressAppShortcut("w");
    await settle();
    expect(tabElements().length).toBe(1);
    expect(paletteInput()).not.toBeNull();
  });

  it("does not open the palette while a modal dialog is showing", async () => {
    await openFile();
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    sidebarButton("切换文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();

    pressAppShortcut("p");
    pressAppShortcut("P", true);
    pressAppShortcut("O", true);
    await settle();

    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();
  });

  it("closes popovers when opened and consumes Escape itself", async () => {
    await openFile();
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    pressPaletteShortcut("P");
    await settle();
    expect(slashMenuElement()).toBeNull();
    expect(paletteInput()).not.toBeNull();

    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();
    expect(editorView().state.doc.toString()).toBe("# A\n/");
  });

  it("closes the compact mode menu before opening the palette", async () => {
    const originalWidth = window.innerWidth;
    try {
      await openFile();
      window.innerWidth = 700;
      window.dispatchEvent(new Event("resize"));
      await settle();
      const modeButton = host.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      expect(modeButton).not.toBeNull();
      modeButton!.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();

      pressPaletteShortcut("P");
      await settle();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(paletteInput()).not.toBeNull();
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
  });
});

describe("slash menu with tabs", () => {
  it("destroys the previous slash controller when switching tabs", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    const destroyedBefore = slashMocks.destroy.mock.calls.length;
    tabNamed("a.md").click();
    await settle();
    expect(slashMenuElement()).toBeNull();
    expect(slashMocks.destroy.mock.calls.length).toBe(destroyedBefore + 1);
  });

  it("closes the slash menu when an external change replaces the document", async () => {
    vi.useFakeTimers();
    await openFile("a.md", "# A\n");
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();
    // Save the trigger character first so the tab is clean and the external
    // change takes the automatic replaceDocument path.
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalled();

    openFileText = "# Disk\n";
    mocks.readFile.mockResolvedValue(openFileText);
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();

    expect(slashMenuElement()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("# Disk\n");
  });

  it("closes the slash menu and recreates it when switching tabs", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    tabNamed("a.md").click();
    await settle();
    expect(slashMenuElement()).toBeNull();

    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();
  });

  it("keeps slash commands and format shortcuts on a restored tab", async () => {
    await setupWorkspace({ "a.md": "one\ntwo\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: 0, insert: "X" } });
    expect(view.state.doc.toString()).toBe("Xone\ntwo\n");

    tabNamed("b.md").click();
    await settle();
    tabNamed("a.md").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("Xone\ntwo\n");

    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    editorView().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(slashMenuElement()).toBeNull();

    const restored = editorView();
    restored.dispatch({ selection: { anchor: 1, head: 4 } });
    pressMod("b", "KeyB");
    await settle();
    expect(restored.state.doc.toString()).toContain("X**one**\ntwo\n");
  });
});

describe("crash recovery", () => {
  function recoveryItem(
    overrides: Partial<import("./services/mygo").RecoveryItem> = {},
  ): import("./services/mygo").RecoveryItem {
    return {
      id: "0123456789abcdef",
      kind: "workspace",
      root: "/notes",
      path: "a.md",
      name: "a.md",
      savedAt: new Date().toISOString(),
      lineEnding: "\n",
      text: "# A\nmore\n",
      diskText: "# A\n",
      diskState: "same",
      restorable: true,
      ...overrides,
    };
  }

  async function mountWithRecovery(
    items: import("./services/mygo").RecoveryItem[],
    otherFolders = 0,
  ) {
    app?.unmount();
    app = null;
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.listRecovery.mockResolvedValue({ items, otherFolders });
    app = createApp(App);
    app.mount(host);
    await settle();
  }

  it("shows copies at startup without writing the files", async () => {
    await mountWithRecovery([recoveryItem()], 1);

    expect(dialog()?.textContent).toContain("发现未保存的内容");
    expect(dialog()?.textContent).toContain("a.md");
    expect(dialog()?.textContent).toContain("多 1 字");
    expect(dialog()?.textContent).toContain("另外 1 个文件夹");
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.listRecovery).toHaveBeenCalledWith(1);
  });

  it("ignores the native close-workspace command behind the recovery dialog", async () => {
    await mountWithRecovery([recoveryItem()]);
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();
  });

  it("ignores a folder drop while startup recovery is still checking", async () => {
    app?.unmount();
    const listing = deferred<{ items: unknown[]; otherFolders: number }>();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.listRecovery.mockReturnValue(listing.promise);
    app = createApp(App);
    app.mount(host);
    await settle();

    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(mocks.openDroppedFolder).not.toHaveBeenCalled();

    listing.resolve({ items: [], otherFolders: 0 });
    await settle();
  });

  it("ignores a folder drop while the recovery dialog is open", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.listRecovery.mockResolvedValue({ items: [recoveryItem()], otherFolders: 0 });
    app = createApp(App);
    app.mount(host);
    await settle();
    expect(dialog()?.textContent).toContain("发现未保存的内容");
    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(mocks.openDroppedFolder).not.toHaveBeenCalled();
  });

  it("does not dispatch app shortcuts behind the recovery dialog", async () => {
    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [
        { kind: "markdown", path: "a.md" },
        { kind: "markdown", path: "b.md" },
      ],
      active: "a.md",
    });
    await mountWithRecovery([recoveryItem()]);
    expect(dialog()?.textContent).toContain("发现未保存的内容");
    expect(tabElements()).toHaveLength(2);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      window.dispatchEvent(event);
      return event;
    };
    const close = press({ key: "w", metaKey: true });
    const open = press({ key: "o", metaKey: true });
    const create = press({ key: "n", metaKey: true });
    const save = press({ key: "s", metaKey: true });
    const next = press({ key: "Tab", ctrlKey: true });
    await settle();

    expect(close.defaultPrevented).toBe(false);
    expect(open.defaultPrevented).toBe(false);
    expect(create.defaultPrevented).toBe(false);
    expect(save.defaultPrevented).toBe(false);
    expect(next.defaultPrevented).toBe(false);
    expect(mocks.pickFolder).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="新建文件"]'),
    ).toBeNull();
    expect(tabElements()).toHaveLength(2);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(dialog()).not.toBeNull();
  });

  it("does not open the palette behind the recovery dialog", async () => {
    await mountWithRecovery([recoveryItem()]);
    expect(dialog()?.textContent).toContain("发现未保存的内容");

    const press = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      window.dispatchEvent(event);
      return event;
    };
    const quickOpen = press({ key: "p", metaKey: true });
    const command = press({ key: "P", metaKey: true, shiftKey: true });
    const heading = press({ key: "O", metaKey: true, shiftKey: true });
    await settle();

    expect(quickOpen.defaultPrevented).toBe(false);
    expect(command.defaultPrevented).toBe(false);
    expect(heading.defaultPrevented).toBe(false);
    expect(dialog()?.textContent).toContain("发现未保存的内容");
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();
  });

  it("closes the palette when the recovery dialog appears", async () => {
    await mountAppWithApi();
    pressPaletteShortcut("P");
    await settle();
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).not.toBeNull();

    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.listRecovery.mockResolvedValue({
      items: [recoveryItem()],
      otherFolders: 0,
    });
    await exposedApp!.value.chooseFolder();
    await settle();

    expect(dialog()?.textContent).toContain("发现未保存的内容");
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();
  });

  it("does not open the palette while recovery is being listed", async () => {
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    const pending = deferred<{
      items: import("./services/mygo").RecoveryItem[];
      otherFolders: number;
    }>();
    mocks.listRecovery.mockReturnValue(pending.promise);

    await mountAppWithApi();
    exposedApp!.value.openCommandPalette("command");
    await settle();
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();

    pending.resolve({ items: [], otherFolders: 0 });
    await settle();
  });

  it("does not open the palette directly while the recovery dialog is shown", async () => {
    await mountAppWithApi();
    mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.listRecovery.mockResolvedValue({
      items: [recoveryItem()],
      otherFolders: 0,
    });
    await exposedApp!.value.chooseFolder();
    await settle();
    expect(dialog()).not.toBeNull();

    // The modal DOM guard already blocks this path; hide it for one call so
    // the explicit recovery-state guard is exercised on its own.
    const querySelector = vi
      .spyOn(document, "querySelector")
      .mockReturnValue(null);
    exposedApp!.value.openCommandPalette("command");
    querySelector.mockRestore();
    await settle();

    expect(dialog()).not.toBeNull();
    expect(
      document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
    ).toBeNull();
  });

  it("marks changed and missing copies instead of a word difference", async () => {
    await mountWithRecovery([
      recoveryItem({
        id: "1111111111111111",
        path: "b.md",
        name: "b.md",
        diskState: "changed",
      }),
      recoveryItem({
        id: "2222222222222222",
        path: "c.md",
        name: "c.md",
        diskState: "missing",
        diskText: "",
      }),
    ]);
    const text = dialog()?.textContent ?? "";
    expect(text).toContain("磁盘上的文件已更改");
    expect(text).toContain("文件已不存在");
    expect(text).not.toContain("多 1 字");
  });

  it("restores unchanged copies and writes them back after the dialog closes", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([recoveryItem()]);

    expect(dialogButton("全部恢复").className).toContain("button-primary");
    expect(dialogButton("全部恢复").className).not.toContain(
      "border-[var(--accent-primary)]",
    );
    dialogButton("全部恢复").click();
    await settle();
    expect(dialog()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("# A\nmore\n");
    expect(mocks.writeFile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A\nmore\n", 1);
    expect(mocks.deleteRecovery).toHaveBeenCalledWith(
      "0123456789abcdef",
      1,
    );
  });

  it("keeps changed copies from being saved automatically", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([
      recoveryItem({ diskState: "changed", diskText: "# Disk\n" }),
    ]);

    dialogButton("全部恢复").click();
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    replaceEditorText("# A\nmore\nedited\n");
    await vi.advanceTimersByTimeAsync(2000);
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ baselineUnconfirmed: true }),
      1,
    );

    mocks.readFile.mockResolvedValue("# Disk\n");
    button("载入磁盘版本").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("# Disk\n");
    expect(mocks.deleteRecovery).toHaveBeenCalledWith(
      "0123456789abcdef",
      1,
    );
  });

  it("restores a deleted file and reaches the delete banner", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([
      recoveryItem({ diskState: "missing", diskText: "" }),
    ]);

    dialogButton("全部恢复").click();
    await settle();
    expect(host.textContent).toContain(
      "此文件已在磁盘上被删除或移走",
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    button("重新保存").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A\nmore\n", 1);
  });

  it("reviews copies behind the restored banner and keeps them on request", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([recoveryItem()]);

    dialogButton("逐个查看").click();
    await settle();
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("这是恢复的内容");
    expect(host.textContent).toContain("保留恢复内容");
    expect(host.textContent).toContain("使用磁盘版本");
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    button("保留恢复内容").click();
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A\nmore\n", 1);
    expect(mocks.deleteRecovery).toHaveBeenCalledWith(
      "0123456789abcdef",
      1,
    );
  });

  it("treats Esc as review without writing", async () => {
    await mountWithRecovery([recoveryItem()]);
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(dialog()).toBeNull();
    expect(host.textContent).toContain("这是恢复的内容");
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.discardRecovery).not.toHaveBeenCalled();
    expect(mocks.restoreRecoverySingleFile).not.toHaveBeenCalled();
  });

  it("discards only the listed copies", async () => {
    await mountWithRecovery([
      recoveryItem({ id: "1111111111111111", path: "b.md", name: "b.md" }),
      recoveryItem({ id: "2222222222222222", path: "c.md", name: "c.md" }),
    ]);
    dialogButton("全部丢弃").click();
    await settle();
    expect(mocks.discardRecovery).toHaveBeenCalledWith(
      ["1111111111111111", "2222222222222222"],
      1,
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("re-authorizes a single file through its copy", async () => {
    vi.useFakeTimers();
    const item = recoveryItem({
      id: "3333333333333333",
      kind: "single",
      root: "",
      path: "/tmp/note.md",
      name: "note.md",
      diskText: "old\n",
      text: "new\n",
    });
    await mountWithRecovery([item]);

    dialogButton("全部恢复").click();
    await settle();
    expect(mocks.restoreRecoverySingleFile).toHaveBeenCalledWith(
      "3333333333333333",
    );
    expect(host.querySelector('[role="tab"]')?.textContent).toContain(
      "note.md",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeSingleFile).toHaveBeenCalledWith("/tmp/note.md", "new\n");
  });

  it("writes a copy two seconds after becoming dirty, then every five seconds", async () => {
    vi.useFakeTimers();
    await openFile();
    // Keep the model dirty without an autosave success so the timer can be
    // observed over several intervals.
    mocks.writeFile.mockImplementation(() => new Promise<void>(() => {}));
    replaceEditorText("# A\n0\n");
    await settle();
    for (let step = 1; step <= 3; step++) {
      await vi.advanceTimersByTimeAsync(500);
      replaceEditorText(`# A\n${step}\n`);
      await settle();
    }
    await vi.advanceTimersByTimeAsync(499);
    expect(mocks.saveRecovery).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.saveRecovery).toHaveBeenCalledTimes(1);

    for (let step = 4; step <= 12; step++) {
      await vi.advanceTimersByTimeAsync(500);
      replaceEditorText(`# A\n${step}\n`);
      await settle();
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.saveRecovery).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.saveRecovery).toHaveBeenCalledTimes(2);
  });

  it("writes a copy immediately when a save fails", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValueOnce(new Error("read-only"));
    replaceEditorText("# Changed\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(host.textContent).toContain("保存失败");
    expect(mocks.saveRecovery).toHaveBeenCalled();
  });

  it("removes the copy after the user discards changes on close", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValue(new Error("read-only"));
    replaceEditorText("# Changed\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();

    tabNamed("a.md")
      .querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')
      ?.click();
    await settle();
    expect(dialog()?.textContent).toContain("放弃更改并关闭");
    dialogButton("放弃更改并关闭").click();
    await settle();
    expect(mocks.deleteRecovery).toHaveBeenCalled();
  });

  it("shows the dialog again after opening a folder that has copies", async () => {
    await openFile();
    mocks.listRecovery.mockImplementation(async (generation: number) =>
      generation === 2
        ? {
            items: [
              recoveryItem({
                root: "/second",
                path: "b.md",
                name: "b.md",
              }),
            ],
            otherFolders: 0,
          }
        : { items: [], otherFolders: 0 },
    );
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(dialog()?.textContent).toContain("发现未保存的内容");
    expect(dialog()?.textContent).toContain("b.md");
  });

  it("keeps the copy when the close save fails and the user still closes", async () => {
    await openFile();
    mocks.writeFile.mockRejectedValue(new Error("read-only"));
    replaceEditorText("# Changed\n");
    await closeHandler?.(42);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();
    expect(mocks.finishClose).toHaveBeenCalledWith(42, false);
    expect(mocks.deleteRecovery).not.toHaveBeenCalled();
  });

  it("does not rewrite an untouched restored copy when the window closes", async () => {
    await mountWithRecovery([recoveryItem()]);
    dialogButton("逐个查看").click();
    await settle();
    mocks.saveRecovery.mockClear();

    await closeHandler?.(9);
    await settle();
    expect(mocks.saveRecovery).not.toHaveBeenCalled();
    expect(mocks.finishClose).toHaveBeenCalledWith(9, false);
  });

  it("rechecks disk state when restoring after the dialog opened", async () => {
    await mountWithRecovery([recoveryItem()]);
    mocks.listRecovery.mockResolvedValue({
      items: [recoveryItem({ diskState: "changed", diskText: "# New\n" })],
      otherFolders: 0,
    });
    vi.useFakeTimers();
    dialogButton("全部恢复").click();
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    expect(editorView().state.doc.toString()).toBe("# A\nmore\n");
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not replace a newer baseline while the dialog is open", async () => {
    mocks.getWorkspaceTabs.mockResolvedValue({
      tabs: [{ kind: "markdown", path: "a.md" }],
      active: "a.md",
    });
    openFileText = "# Disk\n";
    await mountWithRecovery([
      recoveryItem({ diskText: "# Disk\n", text: "# Disk\nrecovered\n" }),
    ]);
    openFileText = "# Pulled\n";
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(editorView().state.doc.toString()).toBe("# Pulled\n");

    vi.useFakeTimers();
    dialogButton("全部恢复").click();
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rechecks before keeping restored content", async () => {
    await mountWithRecovery([recoveryItem()]);
    dialogButton("逐个查看").click();
    await settle();
    mocks.listRecovery.mockResolvedValue({
      items: [recoveryItem({ diskState: "changed", diskText: "# New\n" })],
      otherFolders: 0,
    });

    button("保留恢复内容").click();
    await settle();
    expect(host.textContent).toContain("此文件已在 Nicole 之外被修改");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("writes reviewed edits when List only reports a lost baseline hash", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([recoveryItem()]);
    dialogButton("逐个查看").click();
    await settle();
    replaceEditorText("# A\nmore!\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "# A\nmore!\n",
        baselineUnconfirmed: true,
      }),
      1,
    );

    // Editing rewrote the copy without a disk hash, so List cannot say "same"
    // even though the file still holds the baseline the review started from.
    mocks.listRecovery.mockResolvedValue({
      items: [
        recoveryItem({
          text: "# A\nmore!\n",
          diskText: "# A\n",
          diskState: "changed",
        }),
      ],
      otherFolders: 0,
    });
    button("保留恢复内容").click();
    await settle();
    expect(host.textContent).not.toContain(
      "此文件已在 Nicole 之外被修改",
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "# A\nmore!\n",
      1,
    );
  });

  it("reports a real disk change after editing a reviewed copy", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([recoveryItem()]);
    dialogButton("逐个查看").click();
    await settle();
    replaceEditorText("# A\nmore!\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    mocks.listRecovery.mockResolvedValue({
      items: [
        recoveryItem({
          text: "# A\nmore!\n",
          diskText: "# Disk\n",
          diskState: "changed",
        }),
      ],
      otherFolders: 0,
    });
    button("保留恢复内容").click();
    await settle();
    expect(host.textContent).toContain(
      "此文件已在 Nicole 之外被修改",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not save over a watcher update while rechecking restored content", async () => {
    await mountWithRecovery([recoveryItem()]);
    dialogButton("逐个查看").click();
    await settle();

    const pending = deferred<{
      items: import("./services/mygo").RecoveryItem[];
      otherFolders: number;
    }>();
    mocks.listRecovery.mockReturnValueOnce(pending.promise);
    button("保留恢复内容").click();
    await settle();

    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    pending.resolve({
      items: [recoveryItem({ diskState: "changed" })],
      otherFolders: 0,
    });
    await settle();

    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "此文件已在 Nicole 之外被修改",
    );
  });

  it("does not write when rechecking makes the copy unrestorable", async () => {
    await mountWithRecovery([
      recoveryItem({ text: "# A\nmore\n", diskText: "" }),
    ]);
    dialogButton("逐个查看").click();
    await settle();

    mocks.listRecovery.mockResolvedValue({
      items: [
        recoveryItem({
          text: "# A\nmore\n",
          diskText: "",
          diskState: "changed",
          restorable: false,
          reason: "无法读取文件",
        }),
      ],
      otherFolders: 0,
    });
    button("保留恢复内容").click();
    await settle();
    expect(host.textContent).toContain(
      "此文件已在 Nicole 之外被修改",
    );
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("does not restore from the old list when rechecking fails", async () => {
    vi.useFakeTimers();
    await mountWithRecovery([recoveryItem()]);
    mocks.listRecovery.mockRejectedValueOnce(new Error("unavailable"));

    dialogButton("全部恢复").click();
    await settle();
    expect(host.textContent).toContain("无法确认恢复内容");
    expect(dialog()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rewrites a copy when only the baseline flag changes", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockImplementation(() => new Promise<void>(() => {}));
    replaceEditorText("# A\nchanged\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ baselineUnconfirmed: false }),
      1,
    );

    mocks.saveRecovery.mockClear();
    watchEvents?.([{ op: "remove", path: "a.md", isDir: false }]);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "# A\nchanged\n",
        baselineUnconfirmed: true,
      }),
      1,
    );
  });

  it("moves a dirty tab's copy when its path changes", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockImplementation(() => new Promise<void>(() => {}));
    replaceEditorText("# A\nchanged\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();

    mocks.deleteRecovery.mockClear();
    mocks.saveRecovery.mockClear();
    watchEvents?.([{ op: "rename", oldPath: "a.md", path: "b.md", isDir: false }]);
    await settle();
    expect(mocks.deleteRecovery).toHaveBeenCalledWith(
      "0123456789abcdef",
      1,
    );
    expect(mocks.saveRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "b.md",
        text: "# A\nchanged\n",
      }),
      1,
    );
    expect(host.querySelector('[role="tab"]')?.textContent).toContain("b.md");
  });

  it("keeps autosaving other tabs while the recovery dialog is open", async () => {
    vi.useFakeTimers();
    await mountAppWithApi();
    await exposedApp!.value.openSingleFile("/tmp/single.md", "single.md");
    await settle();
    replaceEditorText("# Single changed\n");
    await settle();

    mocks.listRecovery.mockResolvedValue({
      items: [recoveryItem()],
      otherFolders: 0,
    });
    mocks.openFolder.mockResolvedValue(folder("/notes", 1));
    button("打开文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeSingleFile).toHaveBeenCalledWith(
      "/tmp/single.md",
      "# Single changed\n",
    );
  });

  it("does not save a listed file while the dialog is open", async () => {
    vi.useFakeTimers();
    await mountAppWithApi();
    await exposedApp!.value.openSingleFile("/tmp/single.md", "single.md");
    await settle();
    replaceEditorText("# Single changed\n");
    await settle();

    mocks.listRecovery.mockResolvedValue({
      items: [
        recoveryItem({
          kind: "single",
          root: "",
          path: "/tmp/single.md",
          name: "single.md",
          text: "# Copy\n",
          diskText: "# Single\n",
        }),
      ],
      otherFolders: 0,
    });
    mocks.openFolder.mockResolvedValue(folder("/notes", 1));
    button("打开文件夹").click();
    await settle();
    expect(dialog()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeSingleFile).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    await settle();
    expect(mocks.writeSingleFile).not.toHaveBeenCalled();
  });

  it("waits for recovery writes before completing the close", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# Changed\n");
    const copy = deferred<string>();
    mocks.saveRecovery.mockReturnValue(copy.promise);

    const closing = closeHandler?.(12);
    await settle();
    expect(mocks.finishClose).not.toHaveBeenCalled();

    copy.resolve("0123456789abcdef");
    await closing;
    await settle();
    expect(mocks.finishClose).toHaveBeenCalledWith(12, true);
  });

  it("bounds the wait for a stuck recovery write", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# Changed\n");
    mocks.saveRecovery.mockImplementation(() => new Promise<string>(() => {}));

    const closing = closeHandler?.(13);
    await settle();
    expect(mocks.finishClose).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(mocks.finishClose).toHaveBeenCalledWith(13, true);
  });

  it("waits for the recovery decision before handling an opened file", async () => {
    await mountWithRecovery([recoveryItem()]);
    mocks.takePendingOpenedFiles.mockClear();
    pendingFiles = ["/notes/b.md"];
    openHandler?.();
    await settle();
    expect(mocks.takePendingOpenedFiles).not.toHaveBeenCalled();

    dialogButton("逐个查看").click();
    await settle();
    expect(mocks.takePendingOpenedFiles).toHaveBeenCalled();
  });

  it("does not delete a copy when new input follows a successful save", async () => {
    vi.useFakeTimers();
    await openFile();
    const first = deferred<void>();
    const second = deferred<void>();
    mocks.writeFile
      .mockReturnValueOnce(first.promise)
      .mockReturnValue(second.promise);
    replaceEditorText("# First\n");
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();

    replaceEditorText("# Second\n");
    first.resolve();
    await settle();
    expect(mocks.deleteRecovery).not.toHaveBeenCalled();

    second.resolve();
    await settle();
    expect(mocks.deleteRecovery).toHaveBeenCalledWith(
      "0123456789abcdef",
      1,
    );
  });
});

describe("start page and workspace lifecycle", () => {
  it("saves, closes the workspace and returns to the start page", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();

    expect(dialog()).toBeNull();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A changed\n", 1);
    expect(mocks.saveWorkspaceTabs).toHaveBeenCalledWith(
      "/notes",
      [expect.objectContaining({ kind: "markdown", path: "a.md" })],
      "a.md",
      expect.any(Array),
    );
    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(host.querySelector("aside")).toBeNull();
    expect(host.textContent).toContain("开始写作");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(
      document.activeElement?.getAttribute("aria-label"),
    ).toBe("打开文件夹 ⌘O");
  });

  it("waits for recovery deletes before closing the workspace", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();

    const deletion = deferred<void>();
    mocks.deleteRecovery.mockReturnValue(deletion.promise);
    dialogButton("放弃更改并关闭工作区").click();
    await settle();
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();

    deletion.resolve();
    await settle();
    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(mocks.deleteRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeWorkspace.mock.invocationCallOrder[0]!,
    );
  });

  it("waits for recovery deletes before switching folders", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));

    sidebarButton("切换文件夹").click();
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();
    const deletion = deferred<void>();
    mocks.deleteRecovery.mockReturnValue(deletion.promise);
    dialogButton("放弃更改并切换").click();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledTimes(1);

    deletion.resolve();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledTimes(2);
    expect(mocks.deleteRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.openFolder.mock.invocationCallOrder[1]!,
    );
  });

  it("keeps single-file grants until the workspace close succeeds", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);

    mocks.closeWorkspace.mockRejectedValueOnce(new Error("backend down"));
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(mocks.releaseSingleFile).not.toHaveBeenCalled();

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/tmp/single.md");
  });

  it("restarts recovery copies when the workspace close fails", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));
    mocks.closeWorkspace.mockRejectedValue(new Error("backend down"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    dialogButton("放弃更改并关闭工作区").click();
    await settle();

    expect(mocks.saveRecovery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector("aside")).not.toBeNull();
    expect(editorView().state.doc.toString()).toBe("# A changed\n");
  });

  it("cancels a workspace close when recovery operations exceed the timeout", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.saveRecovery).toHaveBeenCalled();
    const deletion = deferred<void>();
    mocks.deleteRecovery.mockReturnValue(deletion.promise);

    vi.useFakeTimers();
    dialogButton("放弃更改并关闭工作区").click();
    await settle();
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).toContain("关闭工作区失败：恢复副本仍在写入");
    expect(mocks.saveRecovery.mock.calls.length).toBe(1);

    deletion.resolve();
    await settle();
    expect(mocks.saveRecovery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.deleteRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveRecovery.mock.invocationCallOrder[1]!,
    );
  });

  it("cancels a folder switch when recovery operations exceed the timeout", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockClear();
    const deletion = deferred<void>();
    mocks.deleteRecovery.mockReturnValue(deletion.promise);

    sidebarButton("切换文件夹").click();
    await settle();
    vi.useFakeTimers();
    dialogButton("放弃更改并切换").click();
    await settle();
    expect(mocks.openFolder).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    await settle();
    expect(mocks.openFolder).not.toHaveBeenCalled();
    expect(host.textContent).toContain("切换文件夹失败：恢复副本仍在写入");
    expect(mocks.saveRecovery.mock.calls.length).toBe(1);

    deletion.resolve();
    await settle();
    expect(mocks.saveRecovery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(mocks.deleteRecovery.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveRecovery.mock.invocationCallOrder[1]!,
    );
  });

  it("restores dirty recovery copies when opening the next folder fails", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockRejectedValueOnce(new Error("permission denied"));

    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("放弃更改并切换").click();
    await settle();

    expect(mocks.saveRecovery.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector("aside")).not.toBeNull();
    expect(editorView().state.doc.toString()).toBe("# A changed\n");
    expect(host.textContent).toContain("没有权限打开这个文件夹");
    expect(host.textContent).not.toContain("permission denied");
    expect(
      host
        .querySelector<HTMLElement>("footer span[title]")
        ?.getAttribute("title"),
    ).toBe("permission denied");
  });

  it("marks a recent folder missing for Go's fixed missing-folder error", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValue(
      new Error("workspace: folder does not exist"),
    );
    app = createApp(App);
    app.mount(host);
    await settle();

    host.querySelector<HTMLButtonElement>("[data-recent-item] button")!.click();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledWith("/gone");
    const missingButton = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label="打开 gone（/gone），已不存在，点击重试"]',
    )!;
    expect(missingButton.disabled).toBe(false);
    expect(host.textContent).toContain("文件夹已不存在");
    expect(host.textContent).not.toContain("workspace: folder does not exist");
  });

  it("clears the missing marker after a successful retry", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder
      .mockRejectedValueOnce(new Error("workspace: folder does not exist"))
      .mockResolvedValueOnce(folder("/gone"));
    app = createApp(App);
    app.mount(host);
    await settle();

    const open = host.querySelector<HTMLButtonElement>(
      "[data-recent-item] button",
    )!;
    open.click();
    await settle();
    expect(
      host.querySelector(
        '[data-recent-item] button[aria-label="打开 gone（/gone），已不存在，点击重试"]',
      ),
    ).not.toBeNull();

    host.querySelector<HTMLButtonElement>("[data-recent-item] button")!.click();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    const retried = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label^="打开 gone"]',
    )!;
    expect(retried.getAttribute("aria-label")).not.toContain("已不存在");
  });

  it("keeps the missing marker and focus when retry still finds no folder", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValue(
      new Error("workspace: folder does not exist"),
    );
    app = createApp(App);
    app.mount(host);
    await settle();

    host.querySelector<HTMLButtonElement>("[data-recent-item] button")!.click();
    await settle();
    const missingButton = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label="打开 gone（/gone），已不存在，点击重试"]',
    )!;
    missingButton.blur();
    expect(document.activeElement).not.toBe(missingButton);
    missingButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(mocks.openFolder).toHaveBeenCalledTimes(2);
    expect(missingButton.isConnected).toBe(true);
    expect(missingButton.getAttribute("aria-label")).toContain(
      "已不存在，点击重试",
    );
    expect(document.activeElement).toBe(missingButton);
  });

  it("keeps an existing missing marker for other retry errors", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/gone"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder
      .mockRejectedValueOnce(new Error("workspace: folder does not exist"))
      .mockRejectedValueOnce(new Error("permission denied"));
    app = createApp(App);
    app.mount(host);
    await settle();

    host.querySelector<HTMLButtonElement>("[data-recent-item] button")!.click();
    await settle();
    const missingButton = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label="打开 gone（/gone），已不存在，点击重试"]',
    )!;
    missingButton.blur();
    missingButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(missingButton.getAttribute("aria-label")).toContain("已不存在");
    expect(document.activeElement).toBe(missingButton);
    expect(host.textContent).toContain("没有权限打开这个文件夹");
    expect(host.textContent).not.toContain("permission denied");
    expect(
      host
        .querySelector<HTMLElement>("footer span[title]")
        ?.getAttribute("title"),
    ).toBe("permission denied");
  });

  it("does not mark a localized not-found message or other open failures", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/blocked"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    mocks.openFolder.mockRejectedValue(new Error("系统找不到指定的文件。"));
    app = createApp(App);
    app.mount(host);
    await settle();

    const open = host.querySelector<HTMLButtonElement>(
      '[data-recent-item] button[aria-label^="打开 "]',
    )!;
    open.click();
    await settle();
    expect(mocks.openFolder).toHaveBeenCalledWith("/blocked");
    expect(open.disabled).toBe(false);
    expect(open.getAttribute("aria-label")).not.toContain("已不存在");
    expect(host.textContent).not.toContain("已不存在");
  });

  it("keeps the workspace when the close confirmation is cancelled", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();

    expect(dialog()?.textContent).toContain("关闭工作区？");
    expect(dialog()?.textContent).toContain("a.md：保存失败");
    expect(dialog()?.textContent).toContain(
      "当前文件夹的 1 个标签页会关闭，下次打开“notes”时会恢复这些标签页",
    );
    dialogButton("取消").click();
    await settle();

    expect(mocks.closeWorkspace).not.toHaveBeenCalled();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(editorView().state.doc.toString()).toBe("# A changed\n");
    expect(tabElements()).toHaveLength(1);
  });

  it("closes after the user gives up a failed save", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    replaceEditorText("# A changed\n");
    mocks.writeFile.mockRejectedValue(new Error("read only"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    dialogButton("放弃更改并关闭工作区").click();
    await settle();

    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(host.querySelector("aside")).toBeNull();
    expect(host.textContent).toContain("开始写作");
  });

  it("offers close workspace only while a folder is open", async () => {
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.closeWorkspace).not.toHaveBeenCalled();

    pressPaletteShortcut("P");
    await settle();
    typePalette("关闭工作区");
    await settle();
    expect(paletteOptions()).toHaveLength(0);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    await openFile();

    pressPaletteShortcut("P");
    await settle();
    typePalette("关闭工作区");
    await settle();
    const option = paletteOptions().find((item) =>
      item.textContent?.includes("关闭工作区"),
    );
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();
    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("开始写作");
  });

  it("starts on the start page when the workspace was closed before exit", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
      workspaceClosed: true,
    });
    app = createApp(App);
    app.mount(host);
    await settle();

    expect(mocks.openFolder).not.toHaveBeenCalled();
    expect(host.textContent).toContain("开始写作");
    expect(host.querySelector("aside")).toBeNull();
  });

  it("still restores the last folder when the workspace was not closed", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
      workspaceClosed: false,
    });
    app = createApp(App);
    app.mount(host);
    await settle();

    expect(mocks.openFolder).toHaveBeenCalledWith("/notes");
    expect(host.querySelector("aside")).not.toBeNull();
  });

  it("shows five recent folders on the start page while storing ten", async () => {
    app?.unmount();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [
        "/a",
        "/b",
        "/c",
        "/d",
        "/e",
        "/f",
        "/g",
        "/h",
        "/i",
        "/j",
      ],
      expandedFolders: {},
      workspaceClosed: true,
    });
    app = createApp(App);
    app.mount(host);
    await settle();

    expect(host.querySelectorAll("[data-recent-item]")).toHaveLength(5);
    expect(host.textContent).toContain("a");
    expect(host.textContent).toContain("e");
    expect(host.textContent).not.toContain("f");
  });

  it("reveals the workspace root from the palette", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    pressPaletteShortcut("P");
    await settle();
    typePalette("显示工作区文件夹");
    await settle();
    const option = paletteOptions().find((item) =>
      item.textContent?.includes("显示工作区文件夹"),
    );
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();
    expect(mocks.revealEntry).toHaveBeenCalledWith(".", 1);
  });

  it("collapses folders through settings when the sidebar is hidden", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    const originalWidth = window.innerWidth;
    window.innerWidth = 700;
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    pressPaletteShortcut("P");
    await settle();
    typePalette("全部折叠");
    await settle();
    const option = paletteOptions().find((item) =>
      item.textContent?.includes("全部折叠"),
    );
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();
    expect(mocks.setExpandedFolders).toHaveBeenCalledWith("/notes", []);
    window.innerWidth = originalWidth;
  });

  it("runs the collapse-all command from the palette", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    pressPaletteShortcut("P");
    await settle();
    typePalette("全部折叠");
    await settle();
    const option = paletteOptions().find((item) =>
      item.textContent?.includes("全部折叠"),
    );
    expect(option).not.toBeUndefined();
    expect(option!.querySelector("kbd")).toBeNull();
    option!.click();
    await settle();
    expect(mocks.setExpandedFolders).toHaveBeenCalledWith("/notes", []);
  });

  it("opens the file palette from the empty folder state", async () => {
    await openFolder();
    const quick = button("快速打开");
    expect(quick.querySelector("kbd")).toBeNull();
    expect(quick.getAttribute("aria-label")).toBe("快速打开 ⌘P");
    quick.click();
    await settle();
    expect(paletteInput().getAttribute("aria-label")).toBe(
      "命令面板，输入文件名",
    );
    expect(
      document.querySelector('[role="listbox"]')?.textContent,
    ).not.toContain("关闭工作区");
  });

  it("toggles the theme from the start page", async () => {
    await settle();
    const theme = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(theme).not.toBeNull();
    theme!.click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(
      host.querySelector('button[aria-label="切换到亮色主题"]'),
    ).not.toBeNull();
  });

  it("opens a single dropped folder and rejects other drops", async () => {
    await settle();
    dropHandler?.({ token: "image", x: 10, y: 10 });
    await settle();
    expect(host.textContent).toContain("只能拖入一个文件夹");
    expect(mocks.openDroppedFolder).not.toHaveBeenCalled();

    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();

    expect(mocks.openDroppedFolder).toHaveBeenCalledWith("folder-drop");
    expect(host.querySelector("aside")).not.toBeNull();
    expect(host.textContent).toContain("选择一个文件开始写作");
  });

  it("ignores a dropped folder while a workspace is open", async () => {
    await openFile();
    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(mocks.openDroppedFolder).not.toHaveBeenCalled();
  });

  it("ignores a dropped folder while a page dialog is open", async () => {
    pendingFiles = ["/tmp/note.md"];
    openHandler?.();
    await settle();
    expect(dialog()).not.toBeNull();
    dropHandler?.({
      token: "image",
      folderToken: "folder-drop",
      x: 10,
      y: 10,
    });
    await settle();
    expect(mocks.openDroppedFolder).not.toHaveBeenCalled();
  });

  it("shows the folder drop hint while dragging files", async () => {
    await settle();
    const root = host.firstElementChild as HTMLElement;
    const dragEvent = new Event("dragenter", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(dragEvent, "dataTransfer", {
      value: { types: ["Files"], dropEffect: "none" },
    });
    root.dispatchEvent(dragEvent);
    await settle();
    expect(host.textContent).toContain("松开以打开文件夹");

    const leave = new Event("dragleave", { bubbles: true });
    Object.defineProperty(leave, "dataTransfer", {
      value: { types: ["Files"], dropEffect: "none" },
    });
    root.dispatchEvent(leave);
    await settle();
    expect(host.textContent).not.toContain("松开以打开文件夹");
  });

  it("shows shortcuts as plain muted text in menus and the palette", async () => {
    await openFile();
    pressPaletteShortcut("P");
    await settle();
    const command = paletteOptions()[0]!;
    expect(command.querySelector("kbd")).toBeNull();
    const hint = command.querySelector<HTMLElement>(".text-right");
    expect(hint?.textContent?.trim()).toMatch(/[⌘⇧⌃]|Ctrl/);
    expect(hint?.className).toContain("text-[var(--text-muted)]");
    expect(hint?.className).not.toContain("border");
    expect(command.getAttribute("aria-label")).toContain(
      hint?.textContent?.trim(),
    );

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    typeSlashAtEnd();
    await settle();
    const slash = slashMenuElement();
    expect(slash).not.toBeNull();
    expect(slash!.querySelector("kbd")).toBeNull();
    expect(slash!.querySelector(".text-right")?.textContent?.trim()).toMatch(
      /[⌘⇧⌃]|Ctrl/,
    );

    const originalWidth = window.innerWidth;
    try {
      const close = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      });
      document.dispatchEvent(close);
      window.innerWidth = 700;
      window.dispatchEvent(new Event("resize"));
      await settle();
      const modeButton = host.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      );
      modeButton!.click();
      await settle();
      const menu = host.querySelector('[role="menu"]');
      expect(menu).not.toBeNull();
      expect(menu!.querySelector("kbd")).toBeNull();
      expect(menu!.querySelector(".text-right")?.textContent?.trim()).toMatch(
        /[⌘⇧⌃]|Ctrl/,
      );
      expect(
        menu!.querySelector('[role="menuitemradio"]')?.getAttribute("aria-label"),
      ).toMatch(/[⌘⇧⌃]|Ctrl/);
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
  });
});
