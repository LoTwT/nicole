import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import type { AppPlatform } from "./app/platform";
import type {
  SearchPart,
  SearchRequest,
  WorkspaceSnippets,
} from "./services/mygo";
import { searchFingerprint, searchLineFromPart } from "./app/workspace-search";

// jsdom reports an empty navigator.platform, which CodeMirror treats as
// non-Mac when it resolves `Mod` at module load. Pin it so `Mod` follows the
// macOS platform this suite declares.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});

const mocks = vi.hoisted(() => ({
  getAppInfo: vi.fn(),
  openExternalURL: vi.fn(),
  pickFolder: vi.fn(),
  openFolder: vi.fn(),
  openDroppedFolder: vi.fn(),
  closeWorkspace: vi.fn(),
  listFiles: vi.fn(),
  listSnippets: vi.fn(),
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
  revealImage: vi.fn(),
  popupNativeMenu: vi.fn(),
  copyText: vi.fn(),
  getSettings: vi.fn(),
  migrateLegacyTheme: vi.fn(),
  setTheme: vi.fn(),
  setEditorMode: vi.fn(),
  setOutlineVisible: vi.fn(),
  setFormatToolbarVisible: vi.fn(),
  setFonts: vi.fn(),
  setShowAllFiles: vi.fn(),
  setHideMarkdownExtension: vi.fn(),
  setSlashEnabled: vi.fn(),
  setSettingsAccelerator: vi.fn(),
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
  searchWorkspace: vi.fn(),
}));

vi.mock("./services/app", () => ({
  getAppInfo: mocks.getAppInfo,
  openExternalURL: mocks.openExternalURL,
}));
vi.mock("./services/workspace", () => ({
  pickFolder: mocks.pickFolder,
  openFolder: mocks.openFolder,
  openDroppedFolder: mocks.openDroppedFolder,
  closeWorkspace: mocks.closeWorkspace,
  listFiles: mocks.listFiles,
  listSnippets: mocks.listSnippets,
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
  revealImage: mocks.revealImage,
}));
vi.mock("./services/menu", () => ({
  popupNativeMenu: mocks.popupNativeMenu,
  setSettingsAccelerator: mocks.setSettingsAccelerator,
}));
vi.mock("./services/clipboard", () => ({ copyText: mocks.copyText }));
vi.mock("./services/settings", () => ({
  getSettings: mocks.getSettings,
  migrateLegacyTheme: mocks.migrateLegacyTheme,
  setTheme: mocks.setTheme,
  setEditorMode: mocks.setEditorMode,
  setOutlineVisible: mocks.setOutlineVisible,
  setFormatToolbarVisible: mocks.setFormatToolbarVisible,
  setFonts: mocks.setFonts,
  setShowAllFiles: mocks.setShowAllFiles,
  setHideMarkdownExtension: mocks.setHideMarkdownExtension,
  setSlashEnabled: mocks.setSlashEnabled,
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
vi.mock("./services/search", () => ({
  searchWorkspace: mocks.searchWorkspace,
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

interface FakeSearchSession {
  request: SearchRequest;
  onLine: (part: SearchPart) => void;
  resolve: (summary: {
    files: number;
    matches: number;
    truncated: boolean;
  }) => void;
  reject: (error: unknown) => void;
  close: ReturnType<typeof vi.fn>;
}

let searchSessions: FakeSearchSession[] = [];

async function settle() {
  for (let index = 0; index < 20; index++) {
    await Promise.resolve();
    await nextTick();
  }
}

/** Waits for a macrotask, such as the delayed focus settlement. */
async function nextTask() {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await settle();
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

function typeIntoEditor(text: string, compose = false) {
  const view = editorView();
  const at = view.state.selection.main.to;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: compose ? "input.type.compose" : "input.type",
  });
}

function pressMod(
  key: string,
  code: string,
  platform: AppPlatform,
  shift = false,
) {
  editorView().contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      code,
      shiftKey: shift,
      ctrlKey: platform !== "macos",
      metaKey: platform === "macos",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function typeDirect(character: string) {
  const view = editorView();
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: character,
      code: character === "[" ? "BracketLeft" : "Digit8",
      bubbles: true,
      cancelable: true,
    }),
  );
  const range = view.state.selection.main;
  return view.state.facet(EditorView.inputHandler).some((handler) =>
    handler(view, range.from, range.to, character, () =>
      view.state.update({
        changes: { from: range.from, to: range.to, insert: character },
        selection: { anchor: range.from + character.length },
      }),
    ),
  );
}

function slashMenuElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Slash 命令"]',
  );
}

function slashOption(label: string): HTMLButtonElement | undefined {
  return [
    ...(slashMenuElement()?.querySelectorAll<HTMLButtonElement>(
      '[role="option"]',
    ) ?? []),
  ].find((item) => item.textContent?.includes(label));
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

function paletteOffers(label: string): boolean {
  return paletteOptions().some((item) => item.textContent?.includes(label));
}

function linkImageDialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-link-image-editor]");
}

function linkImageInput(label: string): HTMLInputElement {
  const input = linkImageDialog()?.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  if (!input) throw new Error(`link image input ${label} not found`);
  return input;
}

function typeLinkImageField(label: string, value: string) {
  const input = linkImageInput(label);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(input: HTMLElement) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function pressEscape(target: EventTarget) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function clickElementAt(
  element: Element,
  position: number,
  modifiers: MouseEventInit = {},
) {
  const view = editorView();
  vi.spyOn(view, "posAtCoords").mockReturnValue(position);
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: 10,
      clientY: 10,
      ...modifiers,
    }),
  );
}

function clickEditorAt(position: number, modifiers: MouseEventInit = {}) {
  clickElementAt(editorView().contentDOM, position, modifiers);
}

function clickEditorSequenceAt(
  position: number,
  modifiers: MouseEventInit = {},
) {
  const view = editorView();
  vi.spyOn(view, "posAtCoords").mockReturnValue(position);
  vi.spyOn(view as any, "posAndSideAtCoords").mockReturnValue({
    pos: position,
    assoc: 1,
  });
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    view.contentDOM.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        button: 0,
        buttons: type === "mousedown" ? 1 : 0,
        detail: 1,
        ...modifiers,
      }),
    );
  }
}

/** Dispatches the browser's complete pointer-to-click sequence for a button. */
async function pointerClick(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  const down = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
  });
  element.dispatchEvent(down);
  // jsdom does not perform the browser's default mousedown focus action.
  if (!down.defaultPrevented) element.focus();
  element.dispatchEvent(
    new MouseEvent("pointerup", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  element.dispatchEvent(
    new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  element.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  await settle();
  return down.defaultPrevented;
}

/** Reads the mounted App's setup state for lifecycle snapshot assertions. */
function appSetupState(): Record<string, any> {
  const instance = (
    app as unknown as {
      _instance?: { setupState: Record<string, any> };
    } | null
  )?._instance;
  if (!instance) throw new Error("app instance not mounted");
  return instance.setupState;
}

function findPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-find-replace]");
}

function findInput(): HTMLInputElement {
  const input = findPanel()?.querySelector<HTMLInputElement>(
    'input[aria-label="查找"]',
  );
  if (!input) throw new Error("find input not found");
  return input;
}

function findReplaceInput(): HTMLInputElement {
  const input = findPanel()?.querySelector<HTMLInputElement>(
    'input[aria-label="替换为"]',
  );
  if (!input) throw new Error("replace input not found");
  return input;
}

function typeFind(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findButton(label: string): HTMLButtonElement {
  const button = [...(findPanel()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label")?.startsWith(label),
  );
  if (!button) throw new Error(`find button ${label} not found`);
  return button;
}

async function closePalette() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  await settle();
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

function searchInput(): HTMLInputElement {
  const field = host.querySelector<HTMLInputElement>(
    'input[aria-label="搜索工作区"]',
  );
  if (!field) throw new Error("workspace search input not found");
  return field;
}

function typeSearch(value: string) {
  const field = searchInput();
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function lastSearch(): FakeSearchSession {
  const session = searchSessions.at(-1);
  if (!session) throw new Error("workspace search was not started");
  return session;
}

function searchLine(
  path: string,
  line: number,
  text: string,
  column: number,
  matchText: string,
  fullLine = text,
): SearchPart {
  return {
    type: "line",
    path,
    line,
    text,
    lineFingerprint: searchFingerprint(fullLine),
    matches: [
      {
        column,
        length: matchText.length,
        fingerprint: searchFingerprint(matchText),
        endLine: line,
        endLineFingerprint: searchFingerprint(fullLine),
        startsAtDocumentStart: false,
        startsAtLineStart: column === 0,
        endsAtDocumentEnd: false,
        endsAtLineEnd: column + matchText.length === fullLine.length,
        highlightStart: column,
        highlightEnd: column + matchText.length,
      },
    ],
  };
}

function pressPaletteShortcut(key: string) {
  return pressAppShortcut(key, true);
}

function pressSidebarShortcut() {
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function themeToggle(where: "sidebar" | "status"): HTMLButtonElement {
  const toggle = host.querySelector<HTMLButtonElement>(
    `[data-theme-toggle="${where}"]`,
  );
  if (!toggle) throw new Error(`${where} theme toggle not found`);
  return toggle;
}

function outlineToggle(): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>(
    'button[aria-label^="显示或隐藏大纲"]',
  );
}

function outlinePanel(): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-outline-panel]");
}

function outlineHeadingButtons(): HTMLButtonElement[] {
  return [
    ...host.querySelectorAll<HTMLButtonElement>("[data-outline-heading]"),
  ];
}

function outlineHeadingTexts(): string[] {
  return [
    ...host.querySelectorAll<HTMLElement>("[data-outline-heading]"),
  ].map((button) => button.textContent?.trim() ?? "");
}

function startDeadKeyComposition(view: EditorView) {
  view.contentDOM.dispatchEvent(
    new CompositionEvent("compositionstart", { bubbles: true }),
  );
  view.contentDOM.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "x",
    }),
  );
}

function sidebarToggle(which: "show" | "hide"): HTMLButtonElement {
  const selector =
    which === "show" ? "[data-sidebar-toggle]" : "[data-sidebar-hide]";
  const toggle = host.querySelector<HTMLButtonElement>(selector);
  if (!toggle) throw new Error(`${which} sidebar toggle not found`);
  return toggle;
}

function treeRow(path: string): HTMLElement {
  const row = host.querySelector<HTMLElement>(`[data-tree-path="${path}"]`);
  if (!row) throw new Error(`tree row ${path} not found`);
  return row;
}

async function resizeTo(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
  await settle();
}

async function withViewportWidth<T>(
  width: number,
  run: () => Promise<T>,
): Promise<T> {
  const original = window.innerWidth;
  try {
    await resizeTo(width);
    return await run();
  } finally {
    await resizeTo(original);
  }
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

async function remountWithSettings(overrides: Record<string, unknown> = {}) {
  app?.unmount();
  mocks.getSettings.mockResolvedValue({
    theme: "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
    ...overrides,
  });
  app = createApp(App);
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

beforeEach(async () => {
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
  searchSessions = [];

  vi.clearAllMocks();
  mocks.getAppInfo.mockResolvedValue({
    version: "0.0.1",
    os: "darwin",
    arch: "arm64",
    goVersion: "go1.27",
    homeDir: "/Users/tester",
  });
  mocks.openExternalURL.mockResolvedValue(undefined);
  mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
  mocks.openFolder.mockResolvedValue(folder("/notes"));
  mocks.openDroppedFolder.mockResolvedValue(folder("/dropped"));
  mocks.closeWorkspace.mockResolvedValue(undefined);
  mocks.readFile.mockImplementation(async () => openFileText);
  mocks.listFiles.mockResolvedValue([]);
  mocks.listSnippets.mockResolvedValue({ snippets: [], warnings: [] });
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
  mocks.revealImage.mockResolvedValue(undefined);
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
  mocks.setEditorMode.mockResolvedValue(undefined);
  mocks.setOutlineVisible.mockResolvedValue(undefined);
  mocks.setFormatToolbarVisible.mockResolvedValue(undefined);
  mocks.setFonts.mockResolvedValue(undefined);
  mocks.setShowAllFiles.mockResolvedValue(undefined);
  mocks.setHideMarkdownExtension.mockResolvedValue(undefined);
  mocks.setSlashEnabled.mockResolvedValue(undefined);
  mocks.setSettingsAccelerator.mockResolvedValue(undefined);
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
  mocks.searchWorkspace.mockImplementation(
    (request: SearchRequest, onLine: (part: SearchPart) => void) => {
      let resolve!: FakeSearchSession["resolve"];
      let reject!: FakeSearchSession["reject"];
      const result = new Promise<{
        files: number;
        matches: number;
        truncated: boolean;
      }>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      searchSessions.push({
        request,
        onLine,
        resolve,
        reject,
        close: vi.fn(),
      });
      return { result, close: searchSessions.at(-1)!.close };
    },
  );

  exposedApp = null;
  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
  // Startup ends with TakePendingOpenedFiles. Waiting for it here keeps the
  // real-clock startup out of tests that then install fake timers or swap the
  // mocks; otherwise the old instance keeps reading the new values.
  await vi.waitFor(
    () => expect(mocks.takePendingOpenedFiles).toHaveBeenCalled(),
    { interval: 1, timeout: 4000 },
  );
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

  it("does not show a notice when there is nothing to reopen", async () => {
    await openFolder();
    const reopen = pressAppShortcut("T", true);
    await settle();
    expect(reopen.defaultPrevented).toBe(true);
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
    mocks.revealEntry.mockRejectedValueOnce(new Error("no such folder"));
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.reveal-workspace",
      }),
    );
    await settle();
    expect(host.textContent).toContain("无法显示：no such folder");

    await vi.advanceTimersByTimeAsync(2999);
    await settle();
    expect(host.textContent).toContain("无法显示：no such folder");
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(host.textContent).not.toContain("无法显示：no such folder");
  });

  it("keeps an open-failure notice when the switch dialog is cancelled", async () => {
    await openFile();
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
    expect(dialogButton("取消").className).toContain("button-secondary");
    dialogButton("取消").click();
    await settle();

    expect(mocks.openFolder).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("a.md");
    expect(editorView().state.doc.toString()).toBe("# A\n");
  });

  it("switches folders without confirmation when no tabs will close", async () => {
    await openFolder();
    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));

    sidebarButton("切换文件夹").click();
    await settle();

    expect(dialog()).toBeNull();
    expect(mocks.openFolder).toHaveBeenLastCalledWith("/second");
    expect(host.querySelector("aside")).not.toBeNull();
  });

  it("switches folders without confirmation when only a single-file tab is open", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/tmp/single.md");
    dialogButton("只打开这个文件").click();
    await settle();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();

    expect(dialog()).toBeNull();
    expect(mocks.openFolder).toHaveBeenLastCalledWith("/second");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(1);
    expect(tabNamed("single.md")).toBeDefined();
    expect(editorView().state.doc.toString()).toBe("# Single\n");
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
    expect(button("用默认应用打开").className).toContain("button-secondary");
    expect(buttons("显示")[0]!.className).toContain("button-secondary");

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
    expect(mocks.setEditorMode).toHaveBeenCalledOnce();
    expect(mocks.setEditorMode).toHaveBeenCalledWith("source");
  });
});

describe("editor mode settings", () => {
  const modeDoc = "# A\n\n[link](target)\n";

  for (const [stored, label] of [
    ["immersive", "沉浸"],
    ["source", "源码"],
  ] as const) {
    it(`restores ${stored} before the editor is created`, async () => {
      await remountWithSettings({ editorMode: stored });
      await openFile("a.md", modeDoc);

      expect(
        buttons(label)
          .find((item) => item.closest("header"))
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
      const rendered = editorView().contentDOM.textContent ?? "";
      if (stored === "immersive") {
        expect(rendered).not.toContain("# A");
      } else {
        expect(rendered).toContain("# A");
        expect(rendered).toContain("target");
      }
      expect(mocks.setEditorMode).not.toHaveBeenCalled();
    });
  }

  for (const [name, overrides] of [
    ["missing", {}],
    ["invalid", { editorMode: "sepia" }],
  ] as const) {
    it(`starts live when the stored mode is ${name}`, async () => {
      await remountWithSettings(overrides);
      await openFile("a.md", modeDoc);

      expect(
        buttons("预览")
          .find((item) => item.closest("header"))
          ?.getAttribute("aria-pressed"),
      ).toBe("true");
      const rendered = editorView().contentDOM.textContent ?? "";
      expect(rendered).toContain("# A");
      expect(rendered).not.toContain("target");
      expect(mocks.setEditorMode).not.toHaveBeenCalled();
    });
  }

  it("applies the mode returned by legacy theme migration", async () => {
    localStorage.setItem("nicole-theme", "dark");
    mocks.migrateLegacyTheme.mockResolvedValue({
      theme: "dark",
      editorMode: "source",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
    });
    app?.unmount();
    app = createApp(App);
    app.mount(host);
    await settle();

    await openFile("a.md", modeDoc);
    expect(
      buttons("源码")
        .find((item) => item.closest("header"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(editorView().contentDOM.textContent).toContain("target");
    expect(localStorage.getItem("nicole-theme")).toBeNull();
    expect(mocks.setEditorMode).not.toHaveBeenCalled();
  });

  it("applies a late saved mode without rebuilding the view or moving focus", async () => {
    const settings = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => settings.promise);
    await mountAppWithApi();
    mocks.readSingleFile.mockResolvedValue(modeDoc);
    await exposedApp!.value.openSingleFile("/tmp/late.md", "late.md");
    await settle();

    const view = editorView();
    expect(view.contentDOM.textContent).toContain("# A");
    const otherControl = buttons("源码").find((item) =>
      item.closest("header"),
    )!;
    otherControl.focus();
    expect(document.activeElement).toBe(otherControl);
    expect(document.activeElement).not.toBe(view.contentDOM);

    settings.resolve({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      editorMode: "immersive",
    });
    await settle();

    expect(editorView()).toBe(view);
    expect(document.activeElement).toBe(otherControl);
    expect(view.contentDOM.textContent).not.toContain("# A");
    expect(
      buttons("沉浸")
        .find((item) => item.closest("header"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(mocks.setEditorMode).not.toHaveBeenCalled();
  });

  it("keeps a mode chosen while settings load and still applies other settings", async () => {
    const settings = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => settings.promise);
    await mountAppWithApi();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "2",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(mocks.setEditorMode).toHaveBeenCalledOnce();
    expect(mocks.setEditorMode).toHaveBeenCalledWith("immersive");

    mocks.readSingleFile.mockResolvedValue(modeDoc);
    await exposedApp!.value.openSingleFile("/tmp/chosen.md", "chosen.md");
    await settle();
    expect(editorView().contentDOM.textContent).not.toContain("# A");

    settings.resolve({
      theme: "dark",
      sidebarWidth: 300,
      recentFolders: [],
      expandedFolders: {},
      editorMode: "source",
    });
    await settle();

    expect(
      buttons("沉浸")
        .find((item) => item.closest("header"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(editorView().contentDOM.textContent).not.toContain("# A");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(
      (host.firstElementChild as HTMLElement).style.getPropertyValue(
        "--sidebar-width",
      ),
    ).toBe("300px");
    expect(mocks.setEditorMode).toHaveBeenCalledOnce();
  });

  it("keeps the new mode when saving it fails", async () => {
    await openFile("a.md", modeDoc);
    mocks.setEditorMode.mockRejectedValue(new Error("disk full"));

    buttons("源码").find((item) => item.closest("header"))!.click();
    await settle();

    expect(
      buttons("源码")
        .find((item) => item.closest("header"))
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(editorView().contentDOM.textContent).toContain("target");
  });

  it("saves once from the compact mode menu", async () => {
    await openFile("a.md", modeDoc);
    await withViewportWidth(700, async () => {
      const toggle = host.querySelector<HTMLButtonElement>(
        '[aria-label^="编辑模式："]',
      );
      expect(toggle).not.toBeNull();
      toggle!.click();
      await settle();

      const item = [
        ...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
      ].find((entry) => entry.textContent?.includes("源码"));
      expect(item).toBeDefined();
      item!.click();
      await settle();

      expect(mocks.setEditorMode).toHaveBeenCalledOnce();
      expect(mocks.setEditorMode).toHaveBeenCalledWith("source");
    });
  });

  it("saves once from the mode shortcut", async () => {
    await openFile("a.md", modeDoc);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "3",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();

    expect(mocks.setEditorMode).toHaveBeenCalledOnce();
    expect(mocks.setEditorMode).toHaveBeenCalledWith("source");
  });

  it("saves once from the command palette", async () => {
    await openFile("a.md", modeDoc);
    pressPaletteShortcut("P");
    await settle();
    typePalette("源码");
    await vi.waitFor(() =>
      expect(paletteOptions()[0]?.textContent ?? "").toContain("源码"),
    );
    paletteOptions()
      .find((option) => option.textContent?.includes("源码"))!
      .click();
    await settle();

    expect(mocks.setEditorMode).toHaveBeenCalledOnce();
    expect(mocks.setEditorMode).toHaveBeenCalledWith("source");
  });
});

describe("fixed format toolbar", () => {
  function toolbar(): HTMLElement | null {
    return host.querySelector<HTMLElement>("[data-format-toolbar]");
  }

  function toolbarButton(id: string): HTMLButtonElement {
    const buttonElement = toolbar()?.querySelector<HTMLButtonElement>(
      `[data-format-command="${id}"]`,
    );
    if (!buttonElement) throw new Error(`toolbar command ${id} not found`);
    return buttonElement;
  }

  async function runPaletteCommand(label: string) {
    pressPaletteShortcut("P");
    await settle();
    typePalette(label);
    await vi.waitFor(() => expect(paletteOffers(label)).toBe(true));
    paletteOptions()
      .find((option) => option.textContent?.includes(label))!
      .click();
    await settle();
  }

  it("keeps the global choice while non-Markdown panes hide the toolbar", async () => {
    await remountWithSettings();
    expect(toolbar()).toBeNull();

    // The app command works without an editor instance and only remembers the
    // preference; the start page still has no Markdown editor to decorate.
    await runPaletteCommand("显示格式工具栏");
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledWith(true);
    expect(toolbar()).toBeNull();

    await openFile("a.md", "hello\n");
    expect(toolbar()).not.toBeNull();
    expect(toolbar()!.className).toContain("h-9");
    expect(toolbar()!.className).toContain("border-b");

    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("隐藏格式工具栏")).toBe(true);
    expect(paletteOffers("显示格式工具栏")).toBe(false);
    await closePalette();

    await runPaletteCommand("隐藏格式工具栏");
    expect(mocks.setFormatToolbarVisible).toHaveBeenLastCalledWith(false);
    expect(toolbar()).toBeNull();
  });

  it("keeps a toolbar choice made while settings are still loading", async () => {
    const settings = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => settings.promise);
    await mountAppWithApi();

    await runPaletteCommand("显示格式工具栏");
    await openFile("a.md", "hello\n");
    expect(toolbar()).not.toBeNull();
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledOnce();

    settings.resolve({
      theme: "dark",
      editorMode: "source",
      outlineVisible: false,
      formatToolbarVisible: false,
      sidebarWidth: 300,
      recentFolders: [],
      expandedFolders: {},
    });
    await settle();

    expect(toolbar()).not.toBeNull();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledOnce();
  });

  it("writes repeated toggles in order and keeps the last intent", async () => {
    await openFile("a.md", "hello\n");
    const first = deferred<void>();
    mocks.setFormatToolbarVisible
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);

    await runPaletteCommand("显示格式工具栏");
    expect(toolbar()).not.toBeNull();
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledOnce();

    await runPaletteCommand("隐藏格式工具栏");
    expect(toolbar()).toBeNull();
    // The second write waits for the first instead of racing it.
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledOnce();

    first.resolve();
    await vi.waitFor(() =>
      expect(mocks.setFormatToolbarVisible).toHaveBeenCalledTimes(2),
    );
    expect(mocks.setFormatToolbarVisible).toHaveBeenNthCalledWith(1, true);
    expect(mocks.setFormatToolbarVisible).toHaveBeenNthCalledWith(2, false);
    expect(toolbar()).toBeNull();
  });

  it("runs the live selection, keeps focus and refreshes highlights and undo", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "hello\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    await settle();

    toolbarButton("format.bold").click();
    await settle();

    expect(editorView()).toBe(view);
    expect(view.state.doc.toString()).toBe("**hello**\n");
    expect(view.state.selection.main.from).toBe(2);
    expect(view.state.selection.main.to).toBe(7);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(toolbarButton("format.bold").dataset.active).toBe("");

    view.dispatch({ selection: { anchor: 9 } });
    await settle();
    expect(toolbarButton("format.bold").dataset.active).toBeUndefined();

    view.dispatch({ selection: { anchor: 2, head: 7 } });
    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(view.state.doc.toString()).toBe("hello\n");

    await runPaletteCommand("隐藏格式工具栏");
    expect(toolbar()).toBeNull();
    await runPaletteCommand("显示格式工具栏");
    expect(toolbar()).not.toBeNull();
    expect(editorView()).toBe(view);
  });

  it("disables every toolbar action during an IME composition", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "hello\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: 0, head: 5 } });

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    await settle();
    expect(toolbarButton("format.bold").disabled).toBe(true);
    expect(
      toolbar()!.querySelector<HTMLButtonElement>(
        "[data-format-paragraph-trigger]",
      )!.disabled,
    ).toBe(true);
    toolbarButton("format.bold").click();
    await settle();
    expect(view.state.doc.toString()).toBe("hello\n");

    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "h" }),
    );
    await settle();
    expect(toolbarButton("format.bold").disabled).toBe(false);
    toolbarButton("format.bold").click();
    await settle();
    expect(view.state.doc.toString()).toBe("**hello**\n");
  });

  it("E3 R1: clears the bold highlight after a full pointer toggle-off", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "hello\n");
    const view = editorView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    await settle();

    expect(await pointerClick(toolbarButton("format.bold"))).toBe(true);
    expect(view.state.doc.toString()).toBe("**hello**\n");
    expect(toolbarButton("format.bold").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(view.contentDOM);

    expect(await pointerClick(toolbarButton("format.bold"))).toBe(true);
    expect(view.state.doc.toString()).toBe("hello\n");
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(5);
    expect(document.activeElement).toBe(view.contentDOM);
    expect(toolbarButton("format.bold").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("E3 R1: highlights an existing link from the live caret", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "[hello](https://example.com)\n");
    editorView().dispatch({ selection: { anchor: 3 } });
    await settle();

    expect(toolbarButton("format.link").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("E3 R1: lets the keyboard-opened floating outline replace the toolbar menu", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "# A\n\n## B\n");
    await withViewportWidth(800, async () => {
      const trigger = toolbar()!.querySelector<HTMLButtonElement>(
        "[data-format-paragraph-trigger]",
      )!;
      expect(await pointerClick(trigger)).toBe(true);
      const item = host.querySelector<HTMLElement>(
        '[data-format-menu="paragraph"] [role="menuitemradio"]',
      )!;
      expect(document.activeElement).toBe(item);

      item.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "o",
          code: "KeyO",
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();

      expect(outlinePanel()).not.toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("floating");
      expect(host.querySelector('[data-format-menu="paragraph"]')).toBeNull();
      expect(outlinePanel()?.contains(document.activeElement)).toBe(true);
    });
  });

  it("closes toolbar menus on tab switches and when another popover opens", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await settle();
    await openPath("/notes/b.md");
    await settle();
    tabNamed("a.md").click();
    await settle();

    const trigger = toolbar()!.querySelector<HTMLButtonElement>(
      "[data-format-paragraph-trigger]",
    )!;
    trigger.click();
    await settle();
    expect(host.querySelector('[data-format-menu="paragraph"]')).not.toBeNull();

    tabNamed("b.md").click();
    await settle();
    expect(host.querySelector('[data-format-menu="paragraph"]')).toBeNull();
    expect(editorView().state.doc.toString()).toBe("# B\n");
    expect(toolbar()).not.toBeNull();

    tabNamed("a.md").click();
    await settle();
    toolbar()!
      .querySelector<HTMLButtonElement>("[data-format-paragraph-trigger]")!
      .click();
    await settle();
    pressPaletteShortcut("P");
    await settle();
    expect(host.querySelector('[data-format-menu="paragraph"]')).toBeNull();
    expect(document.activeElement).toBe(paletteInput());
    await closePalette();
  });

  it("executes a command moved into More in the narrow real DOM", async () => {
    await remountWithSettings({ formatToolbarVisible: true });
    await openFile("a.md", "hello\n");
    await settle();

    const rect = (width: number) =>
      ({
        x: 0,
        y: 0,
        width,
        height: 28,
        top: 0,
        right: width,
        bottom: 28,
        left: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function getBoundingClientRect(this: HTMLElement) {
        if (this.hasAttribute("data-format-toolbar")) return rect(200);
        const key = this.getAttribute("data-measure-key");
        if (key === "__more") return rect(28);
        if (key === "paragraph") return rect(88);
        if (key !== null) return rect(28);
        return rect(0);
      });
    try {
      window.dispatchEvent(new Event("resize"));
      await settle();

      const more = toolbar()!.querySelector<HTMLButtonElement>(
        "[data-format-more]",
      )!;
      expect(more).not.toBeNull();
      expect(
        toolbar()!.querySelector('[data-format-command="insert.table"]'),
      ).toBeNull();
      more.click();
      await settle();
      const moved = host.querySelector<HTMLButtonElement>(
        '[data-format-menu="more"] [data-format-command="insert.table"]',
      );
      expect(moved).not.toBeNull();
      moved!.click();
      await settle();
      expect(editorView().state.doc.toString()).toContain(
        "| 列 1 | 列 2 |",
      );
      expect(document.activeElement).toBe(editorView().contentDOM);
    } finally {
      spy.mockRestore();
    }
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

  it("holds a timer that was armed before the composition started", async () => {
    vi.useFakeTimers();
    await openFile();
    replaceEditorText("# 已上屏\n");
    await settle();
    startComposition();

    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("rechecks composition before a second write in the same save", async () => {
    vi.useFakeTimers();
    await openFile();
    const first = deferred<void>();
    mocks.writeFile.mockImplementationOnce(() => first.promise);
    replaceEditorText("# 已上屏\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    startComposition();
    replaceEditorText("# 已上屏 pin\n");
    await settle();
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalledWith("a.md", "# 已上屏 pin\n", 1);
    expect(host.querySelector("footer")?.textContent).toContain("编辑中");

    // The first write kept the on-screen baseline; the committed text saves
    // once the composition ends.
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 已上屏 pin\n", 1);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  });

  it("rechecks composition when an autosave was queued behind another tab", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    const slow = deferred<void>();
    mocks.writeFile.mockImplementationOnce(() => slow.promise);

    replaceEditorText("# B2\n");
    tabNamed("a.md").click();
    await settle();
    await vi.advanceTimersByTimeAsync(600);
    replaceEditorText("# A2\n");
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    // A's timer has fired while B's write is still holding the queue.
    await vi.advanceTimersByTimeAsync(600);
    startComposition();
    replaceEditorText("# A2 pin\n");
    await settle();
    slow.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).not.toHaveBeenCalledWith("a.md", "# A2 pin\n", 1);

    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A2 pin\n", 1);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  });

  it("treats a plain key as the end of a stale composition", async () => {
    vi.useFakeTimers();
    await openFile();
    const view = startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    for (const key of ["Shift", "Meta", "Alt", "Control", "CapsLock"]) {
      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    }
    const composingKey = new KeyboardEvent("keydown", {
      key: "a",
      bubbles: true,
    });
    Object.defineProperty(composingKey, "keyCode", { value: 229 });
    view.contentDOM.dispatchEvent(composingKey);
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
  });

  it("resumes after refocus with a key and starts a new composition fresh", async () => {
    vi.useFakeTimers();
    await openFile();
    const view = startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    view.contentDOM.blur();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    // Focus is back but CodeMirror's flag is still set; a real key ends it.
    view.focus();
    replaceEditorText("# 拼 再输入\n");
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "# 拼 再输入\n",
      1,
    );

    // A new composition clears the invalidation and holds its text again.
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    replaceEditorText("# 拼 再输入 pin\n");
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
  });

  it("waits for a real pause across back-to-back compositions", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 一\n");
    for (let step = 0; step < 6; step++) {
      await vi.advanceTimersByTimeAsync(600);
      endComposition();
      await settle();
      replaceEditorText(`# 一${step}\n`);
      await vi.advanceTimersByTimeAsync(600);
      startComposition();
      replaceEditorText(`# 一${step} pin\n`);
      await settle();
      await vi.advanceTimersByTimeAsync(1200);
      expect(mocks.writeFile).not.toHaveBeenCalled();
    }
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshing recovery copies during a long composition", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼1\n");
    await vi.advanceTimersByTimeAsync(2000);
    replaceEditorText("# 拼2\n");
    await vi.advanceTimersByTimeAsync(5000);
    replaceEditorText("# 拼3\n");
    await vi.advanceTimersByTimeAsync(5000);

    const texts = mocks.saveRecovery.mock.calls.map((call) => call[0].text);
    expect(texts).toContain("# 拼2\n");
    expect(texts).toContain("# 拼3\n");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("keeps failed and mixed save states when a composition ends unchanged", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "mixed.md": "a\r\nb\nc\r\n" });
    await openPath("/notes/a.md");
    mocks.writeFile.mockRejectedValueOnce(new Error("permission denied"));
    replaceEditorText("# A changed\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    startComposition();
    endComposition();
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");

    await openPath("/notes/mixed.md");
    replaceEditorText("a\r\nb\nc\r\nd\r\n");
    await settle();
    expect(host.textContent).toContain("换行风格混合");
    startComposition();
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("换行风格混合");
  });

  it("does not retry a failed save when a composition ends without changes", async () => {
    vi.useFakeTimers();
    await openFile();
    mocks.writeFile.mockRejectedValueOnce(new Error("permission denied"));
    replaceEditorText("# X\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);

    startComposition();
    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");
  });

  it("treats window blur as the end of a composition", async () => {
    vi.useFakeTimers();
    await openFile();
    startComposition();
    replaceEditorText("# 拼\n");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# 拼\n", 1);
    hasFocus.mockRestore();
  });

  it("resumes a queued autosave after a composition with no document change", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    const slow = deferred<void>();
    mocks.writeFile.mockImplementationOnce(() => slow.promise);

    replaceEditorText("# B2\n");
    tabNamed("a.md").click();
    await settle();
    await vi.advanceTimersByTimeAsync(600);
    replaceEditorText("# A2\n");
    await vi.advanceTimersByTimeAsync(400);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    // A's timer has fired while B's write holds the queue.
    await vi.advanceTimersByTimeAsync(600);

    startComposition();
    slow.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(host.querySelector("footer")?.textContent).toContain("编辑中");

    endComposition();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenLastCalledWith("a.md", "# A2\n", 1);
    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    expect(host.querySelector("footer")?.textContent).toContain("已保存");
  });

  it("keeps a failed save failed when a queued autosave is blocked", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/b.md");
    await openPath("/notes/a.md");
    mocks.writeFile.mockRejectedValueOnce(new Error("permission denied"));
    replaceEditorText("# A1\n");
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");

    tabNamed("b.md").click();
    await settle();
    const slow = deferred<void>();
    mocks.writeFile.mockImplementationOnce(() => slow.promise);
    replaceEditorText("# B2\n");
    tabNamed("a.md").click();
    await settle();
    await vi.advanceTimersByTimeAsync(600);
    replaceEditorText("# A2\n");
    await vi.advanceTimersByTimeAsync(1000);
    startComposition();
    slow.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(mocks.writeFile).toHaveBeenCalledTimes(2);
    expect(host.querySelector("footer")?.textContent).toContain("保存失败");
  });

  it("keeps a restored paused tab paused after a composition ends", async () => {
    app?.unmount();
    app = null;
    vi.useFakeTimers();
    mocks.getSettings.mockResolvedValue({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/notes"],
      expandedFolders: {},
    });
    mocks.openFolder.mockResolvedValue(folder("/notes"));
    mocks.listRecovery.mockResolvedValue({
      items: [
        {
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
        },
      ],
      otherFolders: 0,
    });
    app = createApp(App);
    app.mount(host);
    // vi.waitFor advances fake timers by its interval on every check, so
    // queued editor timers run while the condition is being awaited.
    await vi.waitFor(
      () => {
        expect(dialogButton("逐个查看")).toBeTruthy();
      },
      { timeout: 4000 },
    );
    dialogButton("逐个查看").click();
    await vi.waitFor(
      () => {
        expect(host.querySelector("footer")?.textContent).toContain(
          "已暂停自动保存",
        );
      },
      { timeout: 4000 },
    );

    startComposition();
    endComposition();
    await settle();
    expect(host.querySelector("footer")?.textContent).toContain("已暂停自动保存");
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.querySelector("footer")?.textContent).toContain("已暂停自动保存");
    expect(mocks.writeFile).not.toHaveBeenCalled();
  }, 15000);

  it("does not let one tab's invalidation release another tab's composition", async () => {
    vi.useFakeTimers();
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    const view = startComposition();
    replaceEditorText("# A 拼\n");
    await settle();
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    tabNamed("a.md")
      .querySelector<HTMLButtonElement>('button[aria-label^="关闭"]')!
      .click();
    await settle();

    await openPath("/notes/b.md");
    startComposition();
    replaceEditorText("# B 拼\n");
    await settle();
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).not.toHaveBeenCalledWith("b.md", "# B 拼\n", 1);
  });

  it("follows the measured WKWebView sequence without writing pinyin", async () => {
    vi.useFakeTimers();
    await openFile();
    const view = editorView();
    view.focus();

    const update = (data: string) => {
      view.contentDOM.dispatchEvent(
        new CompositionEvent("compositionupdate", { data, bubbles: true }),
      );
      view.contentDOM.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          isComposing: true,
          data,
        }),
      );
    };
    const press = (
      key: string,
      keyCode: number,
      composing: boolean,
      metaKey = false,
    ) => {
      const event = new KeyboardEvent("keydown", {
        key,
        metaKey,
        isComposing: composing,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "keyCode", { value: keyCode });
      view.contentDOM.dispatchEvent(event);
    };

    // Measured order for the first letter: composition events and the
    // document update come before its 229/isComposing=true keydown.
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    update("n");
    replaceEditorText("# A n\n");
    press("n", 229, true);
    await settle();

    await vi.advanceTimersByTimeAsync(500);
    update("nihao");
    replaceEditorText("# A nihao\n");
    press("o", 229, true);
    // Shortcuts and navigation inside the composition are still 229/true.
    press("s", 229, true, true);
    press("Home", 229, true);
    press("F5", 229, true);
    await settle();
    await vi.advanceTimersByTimeAsync(1500);
    await settle();
    expect(mocks.writeFile).not.toHaveBeenCalled();

    // Commit: the text lands, compositionend, then the same key as a
    // 229/isComposing=false keydown.
    replaceEditorText("# A 你好\n");
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { data: "你好", bubbles: true }),
    );
    press(" ", 229, false);
    await settle();
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.writeFile).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "# A 你好\n", 1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.writeFile).toHaveBeenCalledTimes(1);
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

  it("toggles the outline from the registered macOS shortcut", async () => {
    await openFile("a.md", "# A\n\n## 一\n");
    const first = new KeyboardEvent("keydown", {
      key: "o",
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(first);
    await settle();
    expect(first.defaultPrevented).toBe(true);
    expect(outlinePanel()).not.toBeNull();
    expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("true");

    const second = new KeyboardEvent("keydown", {
      key: "o",
      ctrlKey: true,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(second);
    await settle();
    expect(second.defaultPrevented).toBe(true);
    expect(outlinePanel()).toBeNull();
    expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("false");
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
    expect(outline!.disabled).toBe(false);

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
  it("keeps exactly one theme toggle as the sidebar shows and hides", async () => {
    const themeToggles = () =>
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          'button[aria-label^="切换到"]',
        ),
      ];
    const statusToggle = () =>
      host.querySelector<HTMLButtonElement>('footer button[aria-label^="切换到"]');

    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(statusToggle()).not.toBeNull();
    expect(themeToggles()).toHaveLength(1);

    await openFile();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(statusToggle()).toBeNull();
    expect(themeToggles()).toHaveLength(1);

    sidebarButton("隐藏侧栏").click();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(statusToggle()).not.toBeNull();
    expect(themeToggles()).toHaveLength(1);

    const originalWidth = window.innerWidth;
    try {
      window.innerWidth = 800;
      window.dispatchEvent(new Event("resize"));
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(statusToggle()).not.toBeNull();
      expect(themeToggles()).toHaveLength(1);

      host.querySelector<HTMLButtonElement>("[data-sidebar-toggle]")!.click();
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(statusToggle()).toBeNull();
      expect(themeToggles()).toHaveLength(1);
      expect(themeToggles()[0]!.closest("aside")).not.toBeNull();

      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(statusToggle()).not.toBeNull();
      expect(themeToggles()).toHaveLength(1);
    } finally {
      window.innerWidth = originalWidth;
      window.dispatchEvent(new Event("resize"));
      await settle();
    }

    statusToggle()!.click();
    await settle();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(
      statusToggle()!.getAttribute("aria-label"),
    ).toBe("切换到亮色主题");
  });

  it("puts the only theme toggle in the status bar for a single-file tab", async () => {
    await settle();
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    expect(host.querySelector("aside")).toBeNull();
    const toggles = [
      ...host.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="切换到暗色主题"]',
      ),
    ];
    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.closest("footer")).not.toBeNull();
    expect(toggles[0]!.className).toContain("size-6");
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

  it("opens the settings tab from Mod-, without an editor command", async () => {
    await openFile();
    const settings = new KeyboardEvent("keydown", {
      key: ",",
      code: "Comma",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(settings);
    await settle();
    expect(settings.defaultPrevented).toBe(true);
    expect(tabNamed("设置")).toBeTruthy();
    expect(document.querySelector("[data-settings-view]")).not.toBeNull();
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
      os: "windows",
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

describe("sidebar focus", () => {
  it("swaps focus between the theme toggles as the sidebar shows and hides", async () => {
    await openFile();
    themeToggle("sidebar").focus();
    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(themeToggle("status"));

    themeToggle("status").focus();
    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(document.activeElement).toBe(themeToggle("sidebar"));
  });

  it("moves focus to the show button when a shortcut hides the sidebar", async () => {
    await openFile();
    treeRow("a.md").focus();
    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(sidebarToggle("show"));
  });

  it("moves focus to the show button when the sidebar hide button is used", async () => {
    await openFile();
    const hide = sidebarToggle("hide");
    hide.focus();
    hide.click();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(sidebarToggle("show"));
  });

  it("moves focus to the hide button when the show button opens the sidebar", async () => {
    await openFile();
    pressSidebarShortcut();
    await settle();
    const show = sidebarToggle("show");
    show.focus();
    show.click();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(document.activeElement).toBe(sidebarToggle("hide"));
  });

  it("moves focus to the show button when the palette hides the sidebar", async () => {
    await openFile();
    treeRow("a.md").focus();
    pressPaletteShortcut("p");
    await settle();
    expect(document.activeElement).toBe(paletteInput());
    typePalette("显示或隐藏侧栏");
    await settle();
    paletteOptions()
      .find((option) => option.textContent?.includes("显示或隐藏侧栏"))!
      .click();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(sidebarToggle("show"));
  });

  it("restores the pre-overlay focus when Escape closes the overlay sidebar", async () => {
    await openFile();
    const view = editorView();
    view.focus();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      expect(
        host.querySelector("aside")?.classList.contains("sidebar--overlay"),
      ).toBe(true);

      treeRow("a.md").focus();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);
    });
  });

  it("restores the pre-overlay focus when a click outside closes the overlay", async () => {
    await openFile();
    const view = editorView();
    view.focus();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      treeRow("a.md").focus();

      host
        .querySelector("[data-editor-host]")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);
    });
  });

  it("falls back to the show button when the pre-overlay focus is gone", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      pressSidebarShortcut();
      await settle();
      treeRow("a.md").focus();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("falls back to the show button when an outside click loses the pre-overlay focus", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      pressSidebarShortcut();
      await settle();
      treeRow("a.md").focus();

      host
        .querySelector("[data-editor-host]")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("moves focus from the status toggle when a wider window shows the sidebar", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      expect(host.querySelector("aside")).toBeNull();
      themeToggle("status").focus();
      await resizeTo(1024);
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(themeToggle("sidebar"));
    });
  });

  it("moves focus to the show button when a narrower window hides the sidebar", async () => {
    await openFile();
    treeRow("a.md").focus();
    await withViewportWidth(800, async () => {
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("leaves focus, selection and scroll alone when the sidebar hides", async () => {
    await openFile();
    const view = editorView();
    view.dispatch({ selection: { anchor: 2, head: 4 } });
    view.focus();
    view.scrollDOM.scrollTop = 24;
    const selection = view.state.selection;

    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(view.scrollDOM.scrollTop).toBe(24);
  });

  it("leaves focus, selection and scroll alone when the sidebar shows", async () => {
    await openFile();
    const view = editorView();
    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).toBeNull();

    view.dispatch({ selection: { anchor: 2, head: 4 } });
    view.focus();
    view.scrollDOM.scrollTop = 24;
    const selection = view.state.selection;

    pressSidebarShortcut();
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.selection.eq(selection)).toBe(true);
    expect(view.scrollDOM.scrollTop).toBe(24);
  });

  it("does not reuse a dismissal origin after the window widens", async () => {
    await openFile();
    const view = editorView();
    view.focus();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      await resizeTo(1024);
      expect(host.querySelector("aside")).not.toBeNull();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(view.contentDOM);

      treeRow("a.md").focus();
      pressSidebarShortcut();
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("leaves focus alone when Escape clears a leftover overlay flag in a wide window", async () => {
    await openFile();
    const view = editorView();
    view.focus();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      expect(
        host.querySelector("aside")?.classList.contains("sidebar--overlay"),
      ).toBe(true);

      await resizeTo(1024);
      expect(host.querySelector("aside")).not.toBeNull();
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(document.body);

      // The stale overlay flag is gone, so narrowing does not reopen it.
      await resizeTo(800);
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });
  });

  it("does not keep a dismissal target when the overlay reopens in the same tick", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      const row = treeRow("a.md");
      row.focus();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      pressSidebarShortcut();
      await settle();
      expect(host.querySelector("aside")).not.toBeNull();
      expect(document.activeElement).toBe(row);

      pressSidebarShortcut();
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("keeps editor focus and selection when the sidebar switches are clicked", async () => {
    await openFile();
    const view = editorView();
    view.dispatch({ selection: { anchor: 2, head: 3 } });
    view.focus();
    const selection = view.state.selection;

    const clickSwitch = (element: HTMLElement) => {
      const down = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      element.click();
    };

    clickSwitch(sidebarToggle("hide"));
    await settle();
    expect(host.querySelector("aside")).toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.selection.eq(selection)).toBe(true);

    clickSwitch(sidebarToggle("show"));
    await settle();
    expect(host.querySelector("aside")).not.toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.selection.eq(selection)).toBe(true);
  });

  it("does not pass focus through the show button when the palette opens", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      treeRow("a.md").focus();

      const seen: Element[] = [];
      const record = (event: FocusEvent) => {
        if (event.target instanceof Element) {
          seen.push(event.target);
        }
      };
      document.addEventListener("focusin", record);
      try {
        pressPaletteShortcut("p");
        await settle();
      } finally {
        document.removeEventListener("focusin", record);
      }
      expect(
        seen.some((element) => element.matches("[data-sidebar-toggle]")),
      ).toBe(false);
      expect(seen.at(-1)).toBe(paletteInput());
    });
  });

  it("returns focus to the overlay fallback after the palette closes", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      treeRow("a.md").focus();
      pressPaletteShortcut("p");
      await settle();
      expect(host.querySelector("aside")).toBeNull();
      expect(document.activeElement).toBe(paletteInput());

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(document.activeElement).toBe(sidebarToggle("show"));
    });
  });

  it("returns focus to the status theme toggle after the palette closes", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      pressSidebarShortcut();
      await settle();
      themeToggle("sidebar").focus();
      pressPaletteShortcut("p");
      await settle();
      expect(host.querySelector("aside")).toBeNull();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(document.activeElement).toBe(themeToggle("status"));
    });
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

function settingsTabs(): HTMLElement[] {
  return tabElements().filter((tab) =>
    (tab.textContent ?? "").replace(/\s+/g, "").startsWith("设置"),
  );
}

function settingsView(): HTMLElement | null {
  return host.querySelector<HTMLElement>("[data-settings-view]");
}

async function openSettingsFromShortcut() {
  pressAppShortcut(",");
  await settle();
}

function settingsCheckbox(group: string, index: number): HTMLInputElement {
  const boxes = host.querySelectorAll<HTMLInputElement>(
    `[data-settings-group="${group}"] input[type=checkbox]`,
  );
  const box = boxes[index];
  if (!box) throw new Error(`settings checkbox ${group}[${index}] not found`);
  return box;
}

function settingsFontInput(name: "ui" | "reading" | "code"): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(
    `#settings-${name}-font`,
  );
  if (!input) throw new Error(`${name} font input not found`);
  return input;
}

function typeSettingsFont(
  name: "ui" | "reading" | "code",
  value: string,
): void {
  const input = settingsFontInput(name);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("outline panel", () => {
  it("enables the outline only for an active Markdown tab", async () => {
    await settle();
    expect(outlineToggle()).toBeNull();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("显示或隐藏大纲")).toBe(false);
    await closePalette();

    await setupWorkspace({
      "a.md": "# A\n\n## 一\n",
      "cover.png": "",
    });
    expect(outlineToggle()).not.toBeNull();
    expect(outlineToggle()!.disabled).toBe(true);
    expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("false");
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("显示或隐藏大纲")).toBe(false);
    await closePalette();

    await openPath("/notes/cover.png");
    await settle();
    expect(host.textContent).toContain("无法预览此类型的文件");
    expect(outlineToggle()!.disabled).toBe(true);
    expect(outlinePanel()).toBeNull();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("显示或隐藏大纲")).toBe(false);
    await closePalette();

    await openPath("/notes/a.md");
    await settle();
    expect(outlineToggle()!.disabled).toBe(false);
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("显示或隐藏大纲")).toBe(true);
    await closePalette();
  });

  it("restores a fixed outline and persists wide-layout toggles", async () => {
    await withViewportWidth(1100, async () => {
      await remountWithSettings({ outlineVisible: true });
      await openFile("a.md", "# 文章\n\n## 一\n\n### 二\n");

      const toggle = outlineToggle()!;
      expect(toggle.disabled).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(outlinePanel()?.getAttribute("aria-label")).toBe("大纲");
      expect(outlineHeadingTexts()).toEqual(["一", "二"]);
      expect(mocks.setOutlineVisible).not.toHaveBeenCalled();

      toggle.click();
      await settle();
      expect(outlinePanel()).toBeNull();
      expect(mocks.setOutlineVisible).toHaveBeenLastCalledWith(false);
      expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("false");

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(mocks.setOutlineVisible).toHaveBeenLastCalledWith(true);
    });
  });

  it("refreshes a remounted fixed outline after a real dead-key composition", async () => {
    await withViewportWidth(1100, async () => {
      await remountWithSettings({ outlineVisible: true });
      await openFile("a.md", "# 文章\n\n## 第一节\n");
      expect(outlineHeadingTexts()).toEqual(["第一节"]);

      vi.useFakeTimers();
      await resizeTo(1000);
      expect(outlinePanel()).toBeNull();

      // The panel is closed when the edit arrives. Expanding the window before
      // CodeMirror's own 20ms ending mounts the outline with the stale pause.
      const view = editorView();
      startDeadKeyComposition(view);
      expect(view.compositionStarted).toBe(true);
      expect(view.composing).toBe(false);
      view.dispatch({
        changes: { from: view.state.doc.length, insert: "\n## 第二节\n" },
      });
      await settle();
      await resizeTo(1100);
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(outlineHeadingTexts()).toEqual([]);

      await vi.advanceTimersByTimeAsync(20);
      expect(view.compositionStarted).toBe(false);
      expect(view.composing).toBe(false);
      await vi.advanceTimersByTimeAsync(279);
      await settle();
      expect(outlineHeadingTexts()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(outlineHeadingTexts()).toEqual(["第一节", "第二节"]);
    });
  });

  it("keeps a fixed outline open beside find", async () => {
    await withViewportWidth(1100, async () => {
      await remountWithSettings({ outlineVisible: true });
      await openFile("a.md", "# 文章\n\n## 一\n");
      expect(outlinePanel()?.dataset.placement).toBe("fixed");

      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      expect(findPanel()).not.toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");

      findInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(findPanel()).toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
    });
  });

  it("keeps the floating outline and find mutually exclusive", async () => {
    await openFile("a.md", "# A\n\n## 一\n");
    await withViewportWidth(800, async () => {
      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      expect(findPanel()).not.toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(findPanel()).toBeNull();
      expect(outlinePanel()).not.toBeNull();
      expect(outlinePanel()?.contains(document.activeElement)).toBe(true);

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(outlinePanel()).toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();
      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      expect(outlinePanel()).toBeNull();
      expect(findPanel()).not.toBeNull();

      findInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(findPanel()).toBeNull();
      expect(outlinePanel()).toBeNull();
    });
  });

  it("hands Esc from slash to find without reopening the floating outline", async () => {
    await openFile("a.md", "hello\n");
    await withViewportWidth(800, async () => {
      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();

      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      expect(findPanel()).not.toBeNull();
      expect(outlinePanel()).toBeNull();

      editorView().focus();
      typeSlashAtEnd();
      await settle();
      expect(slashMenuElement()).not.toBeNull();
      expect(outlinePanel()).toBeNull();

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
      expect(findPanel()).not.toBeNull();

      editorView().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(findPanel()).toBeNull();
      expect(outlinePanel()).toBeNull();
    });
  });

  it("uses content width for the breakpoint and keeps the overlay temporary", async () => {
    await withViewportWidth(1100, async () => {
      await remountWithSettings();
      await openFile("a.md", "# 文章\n\n## 一\n\n### 二\n");

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(mocks.setOutlineVisible).toHaveBeenLastCalledWith(true);

      await resizeTo(1090);
      expect(outlinePanel()).toBeNull();
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("floating");
      expect(outlinePanel()?.contains(document.activeElement)).toBe(true);
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);
      expect(outlineToggle()!.getAttribute("aria-expanded")).toBe("true");

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(outlinePanel()).toBeNull();
      expect(editorView().dom.contains(document.activeElement)).toBe(true);
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);

      outlineToggle()!.click();
      await settle();
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      document.body.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
      );
      await nextTask();
      expect(outlinePanel()).toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("floating");
      await resizeTo(1100);
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);

      // At 1000px the content area is 748px even after the sidebar hides;
      // the outline must not jump to a fixed column just because the sidebar
      // stopped occupying the layout.
      await resizeTo(1000);
      expect(outlinePanel()).toBeNull();
      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("floating");
      pressSidebarShortcut();
      await settle();
      expect(host.querySelector("aside[aria-label=\"侧栏\"]")).toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("floating");
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps the compact mode menu and floating outline mutually exclusive", async () => {
    await openFile("a.md", "# A\n\n## 一\n");
    await withViewportWidth(700, async () => {
      const modeButton = host.querySelector<HTMLButtonElement>(
        'button[aria-haspopup="menu"]',
      )!;
      expect(modeButton).not.toBeNull();
      modeButton.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
      const menuItem = host.querySelector<HTMLButtonElement>(
        '[role="menu"] [role="menuitemradio"]',
      )!;
      menuItem.focus();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "o",
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(outlinePanel()).not.toBeNull();
      expect(outlinePanel()!.contains(document.activeElement)).toBe(true);

      // The focused menu item is unmounted with its menu; closing the outline
      // must fall back to a control that still exists.
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(outlinePanel()).toBeNull();
      expect(document.activeElement).toBe(outlineToggle());

      modeButton.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
      outlineToggle()!.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(outlinePanel()).not.toBeNull();

      modeButton.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
      pressPaletteShortcut("P");
      await settle();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      typePalette("大纲");
      await settle();
      paletteOptions()
        .find((item) => item.textContent?.includes("显示或隐藏大纲"))!
        .click();
      await settle();
      expect(
        document.querySelector('[role="combobox"][aria-label^="命令面板"]'),
      ).toBeNull();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(outlinePanel()).not.toBeNull();

      modeButton.click();
      await settle();
      expect(host.querySelector('[role="menu"]')).not.toBeNull();
      expect(outlinePanel()).toBeNull();
    });
  });

  it("settles focus after the full outside mouse sequence", async () => {
    await openFile("a.md", "# A\n\n## 一\n");

    const footer = host.querySelector("footer")!;
    outlineToggle()!.click();
    await settle();
    expect(outlinePanel()).not.toBeNull();
    footer.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(outlinePanel()).toBeNull();
    // The old microtask restore happened here and was then undone by the
    // browser's default mousedown focus action.
    expect(editorView().dom.contains(document.activeElement)).toBe(false);
    footer.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    // jsdom does not perform the browser's default blur for a non-focusable
    // mousedown target; apply it after dispatch to model that step.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    footer.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    footer.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await nextTask();
    expect(editorView().dom.contains(document.activeElement)).toBe(true);

    const focusTarget = document.createElement("button");
    focusTarget.textContent = "外部控件";
    document.body.append(focusTarget);
    outlineToggle()!.click();
    await settle();
    expect(outlinePanel()).not.toBeNull();
    focusTarget.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(outlinePanel()).toBeNull();
    expect(editorView().dom.contains(document.activeElement)).toBe(false);
    focusTarget.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    // jsdom does not apply mousedown's default focus action; focus after the
    // event dispatch models the browser's post-handler default.
    focusTarget.focus();
    focusTarget.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    focusTarget.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await nextTask();
    expect(document.activeElement).toBe(focusTarget);

    outlineToggle()!.click();
    await settle();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(outlinePanel()).toBeNull();
    expect(document.activeElement).toBe(focusTarget);

    outlineToggle()!.click();
    await settle();
    outlineHeadingButtons()[0]!.click();
    await settle();
    expect(outlinePanel()).toBeNull();
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(focusTarget);
  });

  it("cancels a pending focus restore when another owner appears", async () => {
    await openFile("a.md", "# A\n\n## 一\n");
    const footer = host.querySelector("footer")!;

    outlineToggle()!.click();
    await settle();
    footer.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(outlinePanel()).toBeNull();
    pressPaletteShortcut("P");
    await settle();
    const input = paletteInput();
    expect(document.activeElement).toBe(input);
    footer.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    footer.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    footer.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await nextTask();
    expect(document.activeElement).toBe(input);
    await closePalette();

    outlineToggle()!.click();
    await settle();
    footer.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await settle();
    outlineToggle()!.click();
    await settle();
    expect(outlinePanel()).not.toBeNull();
    footer.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    // jsdom does not perform the browser's default blur for a non-focusable
    // mousedown target; apply it after dispatch to model that step.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    footer.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    footer.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await nextTask();
    expect(outlinePanel()).not.toBeNull();
    expect(editorView().dom.contains(document.activeElement)).toBe(false);

    footer.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    await settle();
    app?.unmount();
    app = null;
    footer.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    footer.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    await nextTask();
    expect(document.activeElement).toBe(document.body);
  });

  it("jumps from the temporary outline and closes it", async () => {
    const doc = "# 文章\n\n## 第一节\n\n正文\n\n### 第二节\n";
    await openFile("a.md", doc);
    outlineToggle()!.click();
    await settle();
    const scroll = vi.spyOn(EditorView, "scrollIntoView");
    const target = host.querySelectorAll<HTMLButtonElement>(
      "[data-outline-heading]",
    )[1]!;

    target.click();
    await settle();

    const position = doc.indexOf("### 第二节");
    expect(editorView().state.selection.main.head).toBe(position);
    expect(scroll).toHaveBeenCalledWith(position, {
      y: "start",
      yMargin: 24,
    });
    expect(outlinePanel()).toBeNull();
    expect(editorView().dom.contains(document.activeElement)).toBe(true);
  });

  it("refreshes on tab switches and external loads without stale timers", async () => {
    await setupWorkspace({
      "a.md": "# A\n\n## A1\n",
      "b.md": "# B\n\n## B1\n",
    });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    outlineToggle()!.click();
    await settle();
    expect(outlineHeadingTexts()).toEqual(["A1"]);

    vi.useFakeTimers();
    const view = editorView();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "\n## A2\n" },
    });
    await settle();
    tabNamed("b.md").click();
    await settle();
    expect(outlineHeadingTexts()).toEqual(["B1"]);

    await vi.advanceTimersByTimeAsync(350);
    await settle();
    expect(outlineHeadingTexts()).toEqual(["B1"]);

    openFileText = "# B2 前言\n\n## B2\n";
    mocks.readFile.mockResolvedValue(openFileText);
    watchEvents?.([{ op: "write", path: "b.md", isDir: false }]);
    await settle();
    expect(outlineHeadingTexts()).toEqual(["B1"]);
    const beforeStaleClick = editorView().state.selection.main;
    host.querySelector<HTMLButtonElement>("[data-outline-heading]")!.click();
    await settle();
    expect(editorView().state.selection.main.eq(beforeStaleClick)).toBe(true);
    expect(outlinePanel()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(350);
    await settle();
    expect(outlineHeadingTexts()).toEqual(["B2"]);
    host.querySelector<HTMLButtonElement>("[data-outline-heading]")!.click();
    await settle();
    expect(editorView().state.selection.main.head).toBe(
      openFileText.indexOf("## B2"),
    );
  });

  it("closes the temporary outline before other overlays and dialogs", async () => {
    await openFile("a.md", "# A\n\n## 一\n");
    await withViewportWidth(800, async () => {
      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();
      pressPaletteShortcut("P");
      await settle();
      expect(paletteInput()).not.toBeNull();
      expect(outlinePanel()).toBeNull();
      await closePalette();
      expect(document.activeElement).toBe(outlineToggle());

      outlineToggle()!.click();
      await settle();
      pressSidebarShortcut();
      await settle();
      expect(host.querySelector("aside[aria-label=\"侧栏\"]")).not.toBeNull();
      expect(outlinePanel()).toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(outlinePanel()).toBeNull();
      expect(
        host.querySelector("aside[aria-label=\"侧栏\"]"),
      ).not.toBeNull();

      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector("aside[aria-label=\"侧栏\"]")).toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();
      pendingFiles = ["/tmp/offered.md"];
      openHandler?.();
      await settle();
      expect(dialog()).not.toBeNull();
      expect(outlinePanel()).toBeNull();
      dialogButton("取消").click();
      await settle();
    });
  });

  it("keeps an outline choice made while settings are still loading", async () => {
    await withViewportWidth(1200, async () => {
      const settings = deferred<Record<string, unknown>>();
      mocks.getSettings.mockImplementation(() => settings.promise);
      await mountAppWithApi();

      mocks.readSingleFile.mockResolvedValue("# Late\n\n## 一\n");
      await exposedApp!.value.openSingleFile("/tmp/late.md", "late.md");
      await settle();
      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(mocks.setOutlineVisible).toHaveBeenCalledWith(true);

      settings.resolve({
        theme: "dark",
        editorMode: "source",
        outlineVisible: false,
        sidebarWidth: 300,
        recentFolders: [],
        expandedFolders: {},
      });
      await settle();

      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(
        (host.firstElementChild as HTMLElement).style.getPropertyValue(
          "--sidebar-width",
        ),
      ).toBe("300px");
      expect(mocks.setOutlineVisible).toHaveBeenCalledTimes(1);
    });
  });

  it("toggles from the palette and beats select-same-word on Windows", async () => {
    mocks.getAppInfo.mockResolvedValue({
      version: "0.0.1",
      os: "windows",
      arch: "x64",
      goVersion: "go1.27",
      homeDir: "C:\\Users\\tester",
    });
    await remountWithSettings();
    await openFile("a.md", "alpha alpha\n\n## 一\n");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "p",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    typePalette("大纲");
    await settle();
    const outlineCommand = paletteOptions().find((item) =>
      item.textContent?.includes("显示或隐藏大纲"),
    );
    expect(outlineCommand).toBeDefined();
    outlineCommand!.click();
    await settle();
    expect(outlinePanel()).not.toBeNull();
    expect(mocks.setOutlineVisible).not.toHaveBeenCalled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(outlinePanel()).toBeNull();

    const view = editorView();
    view.dispatch({ selection: { anchor: 0 } });
    const selectSameWord = new KeyboardEvent("keydown", {
      key: "l",
      code: "KeyL",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(selectSameWord);
    await settle();

    expect(selectSameWord.defaultPrevented).toBe(true);
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(0);
    expect(outlinePanel()).not.toBeNull();
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
      true,
    );
    expect(
      paletteOptions().some((item) => item.textContent?.includes("全文搜索")),
    ).toBe(true);
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

  it("offers save and tab commands only when they can act", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(true);
    expect(paletteOffers("关闭标签页")).toBe(true);
    expect(paletteOffers("下一个标签页")).toBe(false);
    expect(paletteOffers("上一个标签页")).toBe(false);
    expect(paletteOffers("重新打开关闭的标签页")).toBe(false);
    await closePalette();

    await openPath("/notes/b.md");
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("下一个标签页")).toBe(true);
    expect(paletteOffers("上一个标签页")).toBe(true);
    expect(paletteOffers("重新打开关闭的标签页")).toBe(false);
    await closePalette();

    pressAppShortcut("w");
    await settle();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(true);
    expect(paletteOffers("关闭标签页")).toBe(true);
    expect(paletteOffers("下一个标签页")).toBe(false);
    expect(paletteOffers("上一个标签页")).toBe(false);
    expect(paletteOffers("重新打开关闭的标签页")).toBe(true);
  });

  it("lists workspace commands only with an open workspace", async () => {
    await settle();
    pressPaletteShortcut("P");
    await settle();
    for (const label of [
      "新建文件",
      "立即保存",
      "显示或隐藏侧栏",
      "下一个标签页",
      "上一个标签页",
      "重新打开关闭的标签页",
    ]) {
      expect(paletteOffers(label), label).toBe(false);
    }
    await closePalette();

    await openFolder();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("新建文件")).toBe(true);
    expect(paletteOffers("显示或隐藏侧栏")).toBe(true);
    for (const label of [
      "立即保存",
      "下一个标签页",
      "上一个标签页",
      "重新打开关闭的标签页",
    ]) {
      expect(paletteOffers(label), label).toBe(false);
    }
  });

  it("hides save while a preview tab is active", async () => {
    await setupWorkspace({ "a.md": "# A\n", "cover.png": "png" });
    await openPath("/notes/a.md");
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(true);
    await closePalette();

    treeRow("cover.png").click();
    await settle();
    expect(tabNamed("cover.png").getAttribute("aria-selected")).toBe("true");
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(false);
    await closePalette();

    tabNamed("a.md").click();
    await settle();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(true);
  });

  it("keeps save for a single-file Markdown tab without a workspace", async () => {
    await settle();
    pendingFiles = ["/tmp/single.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();

    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("立即保存")).toBe(true);
    expect(paletteOffers("新建文件")).toBe(false);
    expect(paletteOffers("显示或隐藏侧栏")).toBe(false);
    expect(paletteOffers("下一个标签页")).toBe(false);
    expect(paletteOffers("上一个标签页")).toBe(false);
    expect(paletteOffers("重新打开关闭的标签页")).toBe(false);
    await closePalette();

    pressAppShortcut("w");
    await settle();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("重新打开关闭的标签页")).toBe(false);
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

describe("find and replace", () => {
  it("opens only the find row, reveals replace and saves the replaced model", async () => {
    vi.useFakeTimers();
    await openFile("a.md", "foo foo\n");
    const view = editorView();
    view.focus();

    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findPanel()).not.toBeNull();
    expect(host.querySelector(".cm-panel input")).toBeNull();
    expect(document.activeElement).toBe(findInput());
    expect(findPanel()?.querySelector('input[aria-label="替换为"]')).toBeNull();

    typeFind(findInput(), "foo");
    await settle();
    expect(findPanel()?.textContent).toContain("0/2");
    findButton("下一个匹配").click();
    await settle();
    expect(findPanel()?.textContent).toContain("1/2");

    findInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        altKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    typeFind(findReplaceInput(), "bar");
    await settle();
    findButton("全部替换").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("bar bar\n");
    expect(findPanel()?.textContent).toContain("0/0");

    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.writeFile).toHaveBeenCalledWith("a.md", "bar bar\n", 1);

    findInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).toBeNull();
    expect(document.activeElement).toBe(editorView().contentDOM);
  });

  it("closes only the slash menu before the find panel on Escape", async () => {
    await openFile("a.md", "hello\n");
    editorView().focus();
    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findPanel()).not.toBeNull();

    editorView().focus();
    await settle();
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();
    expect(findPanel()).not.toBeNull();

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
    expect(findPanel()).not.toBeNull();

    editorView().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).toBeNull();
  });

  it("destroys the panel and its query when switching tabs", async () => {
    await setupWorkspace({ "a.md": "one one\n", "b.md": "two\n" });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    editorView().focus();
    pressMod("f", "KeyF", "macos");
    await settle();
    typeFind(findInput(), "one");
    await settle();
    expect(findPanel()?.textContent).toContain("0/2");

    tabNamed("b.md").click();
    await settle();
    expect(findPanel()).toBeNull();
    expect(
      editorView().contentDOM.querySelectorAll(".cm-searchMatch"),
    ).toHaveLength(0);

    editorView().focus();
    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findInput().value).toBe("one");
    expect(findPanel()?.textContent).toContain("0/0");
  });

  it("closes find when the compact mode menu opens and restores its toggle on Escape", async () => {
    await openFile("a.md", "# A\n");
    await withViewportWidth(700, async () => {
      editorView().focus();
      pressSidebarShortcut();
      await settle();
      expect(
        host.querySelector("aside")?.classList.contains("sidebar--overlay"),
      ).toBe(true);
      expect(document.activeElement).toBe(editorView().contentDOM);

      pressMod("f", "KeyF", "macos");
      await settle();
      expect(findPanel()).not.toBeNull();

      const toggle = host.querySelector<HTMLButtonElement>(
        '[aria-label^="编辑模式："]',
      )!;
      toggle.click();
      await settle();

      expect(findPanel()).toBeNull();
      const menu = host.querySelector<HTMLElement>('[role="menu"]');
      expect(menu).not.toBeNull();
      const firstItem = menu!.querySelector<HTMLElement>(
        '[role="menuitemradio"]',
      )!;
      expect(document.activeElement).toBe(firstItem);

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      });
      firstItem.dispatchEvent(escape);
      await settle();

      expect(escape.defaultPrevented).toBe(true);
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(toggle);
      expect(host.querySelector("aside")).not.toBeNull();
      expect(findPanel()).toBeNull();

      // The reverse direction: opening find closes this popover and moves
      // focus into the find input.
      editorView().contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "f",
          code: "KeyF",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(host.querySelector('[role="menu"]')).toBeNull();
      expect(findPanel()).not.toBeNull();
      expect(document.activeElement).toBe(findInput());
    });
  });

  it("opens the command, file and heading palettes from the find inputs", async () => {
    await openFile("a.md", "foo\n");
    const shortcuts: readonly [string, boolean, "find" | "replace"][] = [
      ["p", false, "find"],
      ["P", true, "replace"],
      ["O", true, "find"],
    ];

    for (const [key, shiftKey, source] of shortcuts) {
      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      let target = findInput();
      if (source === "replace") {
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "f",
            code: "KeyF",
            altKey: true,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
        await settle();
        target = findReplaceInput();
      }
      target.focus();
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          metaKey: true,
          shiftKey,
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();

      expect(findPanel()).toBeNull();
      expect(paletteInput()).toBeInstanceOf(HTMLInputElement);
      expect(document.activeElement).toBe(paletteInput());
      closePalette();
      await settle();
    }
  });

  it("closes find when the command palette opens", async () => {
    await openFile("a.md", "foo\n");
    editorView().focus();
    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findPanel()).not.toBeNull();

    pressAppShortcut("P", true);
    await settle();
    expect(findPanel()).toBeNull();
    expect(paletteInput()).toBeInstanceOf(HTMLInputElement);
  });

  it("does not run editor find without an active Markdown editor", async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).toBeNull();
    expect(host.querySelector(".cm-editor")).toBeNull();
  });

  it("forwards Mod-f from a focused task box into the find input", async () => {
    await openFile("a.md", "- [ ] 待办\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await vi.waitFor(
      () => expect(host.querySelector(".cm-nicole-checkbox-input")).not.toBeNull(),
      { interval: 1, timeout: 4000 },
    );
    const checkbox = host.querySelector<HTMLInputElement>(
      ".cm-nicole-checkbox-input",
    )!;
    checkbox.focus();
    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).not.toBeNull();
    expect(document.activeElement).toBe(findInput());

    const input = findInput();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.activeElement).toBe(findInput());

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).toBeNull();
    expect(document.activeElement).toBe(checkbox);
  });

  it("falls back to the editor when the find opener was removed", async () => {
    await openFile("a.md", "- [ ] 待办\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    await vi.waitFor(
      () => expect(host.querySelector(".cm-nicole-checkbox-input")).not.toBeNull(),
      { interval: 1, timeout: 4000 },
    );
    const checkbox = host.querySelector<HTMLInputElement>(
      ".cm-nicole-checkbox-input",
    )!;
    checkbox.focus();
    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).not.toBeNull();

    replaceEditorText("# 普通标题\n");
    await settle();
    expect(host.querySelector(".cm-nicole-checkbox-input")).toBeNull();

    findInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(findPanel()).toBeNull();
    expect(document.activeElement).toBe(editorView().contentDOM);
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
    pressMod("b", "KeyB", "macos");
    await settle();
    expect(restored.state.doc.toString()).toContain("X**one**\ntwo\n");
  });
});

describe("workspace user templates", () => {
  it("loads a template from slash and saves the document as one undo step", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 12, 0));
    await openFile("a.md", "");
    mocks.listSnippets.mockResolvedValue({
      snippets: [
        {
          id: "snippet:letter.md",
          label: "letter",
          body: "{{date}}\n{{cursor}}x",
        },
      ],
      warnings: [],
    });
    expect(mocks.listSnippets).not.toHaveBeenCalled();

    typeSlashAtEnd();
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledWith(1);

    typeIntoEditor("letter");
    await settle();
    const option = slashOption("letter");
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();

    expect(editorView().state.doc.toString()).toBe("2026-11-09\nx");
    expect(editorView().state.selection.main.head).toBe(11);

    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "2026-11-09\nx",
      1,
    );

    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(editorView().state.doc.toString()).toBe("/letter");
    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(editorView().state.doc.toString()).toBe("");
  });

  it("shows loading for a template-only slash query and reveals it in the open menu", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("letter");
    await settle();

    expect(slashMenuElement()).not.toBeNull();
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");
    expect(slashOption("letter")).toBeUndefined();

    snapshot.resolve({
      snippets: [
        { id: "snippet:letter.md", label: "letter", body: "Hi{{cursor}}!" },
      ],
      warnings: [],
    });
    await settle();

    expect(slashMenuElement()?.textContent).not.toContain("正在读取用户模板");
    const option = slashOption("letter");
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();

    expect(editorView().state.doc.toString()).toBe("Hi!");
    expect(editorView().state.selection.main.head).toBe(2);
  });

  it("closes a loading slash menu only after an empty snapshot arrives", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("zzz");
    await settle();
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");

    snapshot.resolve({ snippets: [], warnings: [] });
    await settle();

    expect(slashMenuElement()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("/zzz");
  });

  it("lets Enter behave as normal input while the slash menu is loading", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("letter");
    await settle();
    expect(slashOption("letter")).toBeUndefined();

    editorView().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();

    expect(slashMenuElement()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("/letter\n");

    snapshot.resolve({
      snippets: [
        { id: "snippet:letter.md", label: "letter", body: "Hi" },
      ],
      warnings: [],
    });
    await settle();

    expect(slashMenuElement()).toBeNull();
    expect(editorView().state.doc.toString()).toBe("/letter\n");
  });

  it("keeps a template hidden while composition input continues", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    typeSlashAtEnd();
    await settle();
    const content = editorView().contentDOM;
    content.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    typeIntoEditor("letter", true);
    await settle();

    snapshot.resolve({
      snippets: [
        { id: "snippet:letters.md", label: "letters", body: "Hi" },
      ],
      warnings: [],
    });
    await settle();
    expect(slashOption("letters")).toBeUndefined();

    typeIntoEditor("s", true);
    await settle();
    expect(slashOption("letters")).toBeUndefined();

    content.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await settle();
    expect(slashOption("letters")).not.toBeUndefined();
  });

  it("invalidates a pending slash snapshot when the menu closes", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("letter");
    await settle();
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

    snapshot.resolve({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "Hi" }],
      warnings: ["用户模板“late-slash.md”超过 64 KiB，已跳过"],
    });
    await settle();

    expect(slashMenuElement()).toBeNull();
    expect(host.textContent).not.toContain("late-slash.md");
  });

  it("invalidates a pending palette snapshot when the panel closes", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    pressPaletteShortcut("P");
    await settle();
    typePalette("letter");
    await settle();
    expect(dialog()?.textContent).toContain("正在读取用户模板");
    await closePalette();
    expect(dialog()).toBeNull();

    snapshot.resolve({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "Hi" }],
      warnings: ["用户模板“late-palette.md”超过 64 KiB，已跳过"],
    });
    await settle();

    expect(dialog()).toBeNull();
    expect(host.textContent).not.toContain("late-palette.md");
  });

  it("rejects a same-root response from the preceding slash menu", async () => {
    await openFile("a.md", "");
    const oldSnapshot = deferred<WorkspaceSnippets>();
    const newSnapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(newSnapshot.promise);

    typeSlashAtEnd();
    await settle();
    editorView().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    typeIntoEditor(" ");
    typeSlashAtEnd();
    typeIntoEditor("letter");
    await settle();
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");

    oldSnapshot.resolve({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "old" }],
      warnings: ["用户模板“old-menu.md”超过 64 KiB，已跳过"],
    });
    await settle();
    expect(slashOption("letter")).toBeUndefined();
    expect(host.textContent).not.toContain("old-menu.md");

    newSnapshot.resolve({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "fresh" }],
      warnings: [],
    });
    await settle();
    const option = slashOption("letter");
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();

    expect(editorView().state.doc.toString()).toBe("/ fresh");
  });

  it("does not leak a late same-name template into the next root's menu", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const oldSnapshot = deferred<WorkspaceSnippets>();
    const newSnapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(newSnapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("same");
    await settle();
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(mocks.openFolder).toHaveBeenLastCalledWith("/second");

    const row = host.querySelector<HTMLElement>('[data-tree-path="a.md"]');
    expect(row).not.toBeNull();
    row!.click();
    await settle();
    typeSlashAtEnd();
    await settle();
    typeIntoEditor("same");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledTimes(2);
    expect(mocks.listSnippets).toHaveBeenLastCalledWith(2);
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");

    oldSnapshot.resolve({
      snippets: [{ id: "snippet:same.md", label: "same", body: "old-root" }],
      warnings: [],
    });
    await settle();
    expect(slashOption("same")).toBeUndefined();
    expect(editorView().state.doc.toString()).toBe("# A\n/same");

    newSnapshot.resolve({
      snippets: [{ id: "snippet:same.md", label: "same", body: "new-root" }],
      warnings: [],
    });
    await settle();
    const option = slashOption("same");
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();

    expect(editorView().state.doc.toString()).toBe("# A\nnew-root");
  });

  it("ignores a late snapshot after the workspace closes", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const oldSnapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValueOnce(oldSnapshot.promise);

    typeSlashAtEnd();
    await settle();
    typeIntoEditor("same");
    await settle();
    expect(slashMenuElement()?.textContent).toContain("正在读取用户模板");

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(mocks.closeWorkspace).toHaveBeenCalledOnce();
    expect(slashMenuElement()).toBeNull();
    expect(appSetupState().paletteMenuCommands).toHaveLength(0);

    oldSnapshot.resolve({
      snippets: [{ id: "snippet:same.md", label: "same", body: "old-root" }],
      warnings: [],
    });
    await settle();
    expect(slashMenuElement()).toBeNull();

    await openFile("a.md", "# A\n");
    typeSlashAtEnd();
    await settle();
    typeIntoEditor("same");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledTimes(2);
    expect(slashOption("same")).toBeUndefined();
  });

  it("runs a template from the command palette against the pre-open selection", async () => {
    await openFile("a.md", "start\n");
    mocks.listSnippets.mockResolvedValue({
      snippets: [
        {
          id: "snippet:frame.md",
          label: "frame",
          body: "《{{cursor}}》",
        },
      ],
      warnings: [],
    });
    const view = editorView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: 5 } });
    await settle();

    pressPaletteShortcut("P");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledWith(1);

    typePalette("frame");
    await settle();
    await vi.waitFor(() => expect(paletteOffers("frame")).toBe(true));

    // The palette restores the selection captured when it opened.
    editorView().dispatch({ selection: { anchor: 0 } });
    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();

    expect(editorView().state.doc.toString()).toBe("《》\n");
    expect(editorView().state.selection.main.head).toBe(1);
    expect(localStorage.getItem("nicole:commands:recent")).toContain(
      "snippet:frame.md",
    );
    expect(appSetupState().paletteMenuCommands).toHaveLength(0);
    expect(appSetupState().workspaceSnippetCommands).toHaveLength(0);
  });

  it("releases the rendered palette snapshot on close and root switch", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    mocks.listSnippets.mockResolvedValue({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "body" }],
      warnings: [],
    });

    pressPaletteShortcut("P");
    await settle();
    typePalette("letter");
    await settle();
    expect(paletteOffers("letter")).toBe(true);
    expect(
      appSetupState().paletteMenuCommands.some(
        (command: { id: string }) => command.id === "snippet:letter.md",
      ),
    ).toBe(true);

    await closePalette();
    expect(appSetupState().paletteMenuCommands).toHaveLength(0);
    expect(appSetupState().workspaceSnippetCommands).toHaveLength(0);

    pressPaletteShortcut("P");
    await settle();
    typePalette("letter");
    await settle();
    expect(paletteOffers("letter")).toBe(true);
    await closePalette();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();

    expect(appSetupState().paletteMenuCommands).toHaveLength(0);
    expect(appSetupState().workspaceSnippetCommands).toHaveLength(0);
  });

  it("refreshes on every open and ignores a snapshot from the previous root", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const oldSnapshot = deferred<WorkspaceSnippets>();
    const freshSnapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets
      .mockReturnValueOnce(oldSnapshot.promise)
      .mockReturnValueOnce(freshSnapshot.promise)
      .mockResolvedValue({ snippets: [], warnings: [] });

    pressPaletteShortcut("P");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledWith(1);
    await closePalette();

    mocks.pickFolder.mockResolvedValue({ path: "/second", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/second", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(mocks.openFolder).toHaveBeenLastCalledWith("/second");

    const row = host.querySelector<HTMLElement>('[data-tree-path="a.md"]');
    expect(row).not.toBeNull();
    row!.click();
    await settle();

    pressPaletteShortcut("P");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledTimes(2);
    expect(mocks.listSnippets).toHaveBeenLastCalledWith(2);

    oldSnapshot.resolve({
      snippets: [{ id: "snippet:old.md", label: "旧模板", body: "old" }],
      warnings: [],
    });
    await settle();
    expect(paletteOffers("旧模板")).toBe(false);

    freshSnapshot.resolve({
      snippets: [{ id: "snippet:fresh.md", label: "新模板", body: "fresh" }],
      warnings: [],
    });
    await settle();
    expect(paletteOffers("新模板")).toBe(true);

    await closePalette();
    pressPaletteShortcut("P");
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledTimes(3);
  });

  it("shows warnings and keeps built-in slash commands", async () => {
    await openFile("a.md", "");
    mocks.listSnippets.mockResolvedValue({
      snippets: [],
      warnings: ["用户模板“bad.md”超过 64 KiB，已跳过"],
    });

    typeSlashAtEnd();
    await settle();

    expect(host.textContent).toContain("bad.md");
    expect(slashOption("标题 1")).not.toBeUndefined();
    expect(slashOption("bad")).toBeUndefined();
  });

  it("uses a template in a single-file tab while the root is open", async () => {
    await setupWorkspace({});
    await openPath("/tmp/single.md");
    dialogButton("只打开这个文件").click();
    await settle();

    mocks.listSnippets.mockResolvedValue({
      snippets: [
        { id: "snippet:sign.md", label: "sign", body: "-- {{cursor}}" },
      ],
      warnings: [],
    });

    typeSlashAtEnd();
    await settle();
    expect(mocks.listSnippets).toHaveBeenCalledWith(1);
    typeIntoEditor("sign");
    await settle();
    const option = slashOption("sign");
    expect(option).not.toBeUndefined();
    option!.click();
    await settle();

    expect(editorView().state.doc.toString()).toBe("# Single\n-- ");
    expect(editorView().state.selection.main.head).toBe(12);
  });

  it("does not interrupt palette IME input when templates arrive", async () => {
    await openFile("a.md", "");
    const snapshot = deferred<WorkspaceSnippets>();
    mocks.listSnippets.mockReturnValue(snapshot.promise);

    pressPaletteShortcut("P");
    await settle();
    const input = paletteInput();
    typePalette("letter");
    await settle();
    expect(dialog()?.textContent).toContain("正在读取用户模板");
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));

    snapshot.resolve({
      snippets: [{ id: "snippet:letter.md", label: "letter", body: "X" }],
      warnings: [],
    });
    await settle();

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("letter");
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(editorView().state.doc.toString()).toBe("");
    expect(paletteOffers("letter")).toBe(true);

    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await settle();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(editorView().state.doc.toString()).toBe("X");
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
    expect(dialogButton("逐个查看").className).toContain("button-secondary");
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

  it("omits the workspace tab count when only a single-file tab needs confirmation", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/tmp/single.md");
    dialogButton("只打开这个文件").click();
    await settle();
    replaceEditorText("# Single changed\n");
    mocks.writeSingleFile.mockRejectedValue(new Error("read only"));

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();

    expect(dialog()?.textContent).toContain("关闭工作区？");
    expect(dialog()?.textContent).toContain(
      "1 个单文件标签页会关闭且不会恢复",
    );
    expect(dialog()?.textContent).not.toContain("0 个标签页");
    expect(dialog()?.textContent).not.toContain("当前文件夹的");
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

  it("shows shortcuts as plain text in menus and the palette", async () => {
    await openFile();
    pressPaletteShortcut("P");
    await settle();
    const command = paletteOptions()[0]!;
    expect(command.querySelector("kbd")).toBeNull();
    const hint = command.querySelector<HTMLElement>(".text-right");
    expect(hint?.textContent?.trim()).toMatch(/[⌘⇧⌃]|Ctrl/);
    expect(hint?.className).toContain("text-[var(--text-secondary)]");
    expect(hint?.className).not.toContain("border");

    const unselectedHint = paletteOptions()[1]?.querySelector<HTMLElement>(
      ".text-right",
    );
    if (unselectedHint) {
      expect(unselectedHint.className).toContain(
        "text-[var(--text-muted)]",
      );
    }
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

describe("workspace search", () => {
  it("opens from the sidebar, yields the tree on Escape, and restores focus", async () => {
    await openFile();
    const searchButton = [
      ...host.querySelectorAll<HTMLButtonElement>("aside button"),
    ].find((item) =>
      item.getAttribute("aria-label")?.startsWith("搜索工作区"),
    );
    expect(searchButton).toBeDefined();
    expect(searchButton!.disabled).toBe(false);
    searchButton!.click();
    await settle();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    expect(host.querySelector('[data-tree-path="a.md"]')).toBeNull();
    expect(document.activeElement).toBe(searchInput());

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    searchInput().dispatchEvent(escape);
    await settle();
    expect(escape.defaultPrevented).toBe(true);
    expect(host.querySelector("[data-search-panel]")).toBeNull();
    expect(host.querySelector('[data-tree-path="a.md"]')).not.toBeNull();
    expect(editorView().hasFocus).toBe(true);
  });

  it("requires a workspace and ignores a single-file tab", async () => {
    await mountAppWithApi();
    const withoutWorkspace = pressAppShortcut("f", true);
    await settle();
    expect(withoutWorkspace.defaultPrevented).toBe(true);
    expect(searchSessions).toHaveLength(0);
    expect(host.querySelector("[data-search-panel]")).toBeNull();

    await exposedApp!.value.openSingleFile("/tmp/single.md", "single.md");
    await settle();
    const single = pressAppShortcut("f", true);
    await settle();
    expect(single.defaultPrevented).toBe(true);
    expect(searchSessions).toHaveLength(0);
    expect(host.querySelector("[data-search-panel]")).toBeNull();

    await openFolder();
    const withWorkspace = pressAppShortcut("f", true);
    await settle();
    expect(withWorkspace.defaultPrevented).toBe(true);
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    expect(searchSessions).toHaveLength(0);
  });

  it("opens from the command palette", async () => {
    await openFolder();
    pressPaletteShortcut("P");
    await settle();
    expect(paletteOffers("全文搜索")).toBe(true);
    typePalette("quanwen");
    await vi.waitFor(() =>
      expect(paletteOptions()[0]?.textContent ?? "").toContain("全文搜索"),
    );
    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    expect(document.activeElement).toBe(searchInput());
  });

  it("streams results and opens the matching UTF-16 range centered", async () => {
    await openFile("a.md", "中文😀foo\r\nnext\r\n");
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    expect(lastSearch().request).toEqual({
      generation: 1,
      query: "foo",
      caseSensitive: false,
      regex: false,
    });
    lastSearch().onLine(searchLine("a.md", 1, "中文😀foo", 4, "foo"));
    await settle();
    expect(host.textContent).toContain("正在搜索");
    expect(host.querySelector("[data-search-result]")).not.toBeNull();

    const scrollSpy = vi.spyOn(EditorView, "scrollIntoView");
    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    const view = editorView();
    expect(view.state.doc.toString()).toBe("中文😀foo\nnext\n");
    expect(view.state.selection.main.from).toBe(4);
    expect(view.state.selection.main.to).toBe(7);
    expect(view.state.sliceDoc(4, 7)).toBe("foo");
    expect(scrollSpy).toHaveBeenCalledWith(4, { y: "center" });
    expect(view.hasFocus).toBe(true);
    scrollSpy.mockRestore();
  });

  it("keeps a dirty tab and relocates a moved match; reports a stale result", async () => {
    await openFile("a.md", "first\nfoo here\n");
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("a.md", 2, "foo here", 0, "foo"));
    await settle();

    const view = editorView();
    view.dispatch({ changes: { from: 0, insert: "X " } });
    await settle();
    mocks.readFile.mockClear();
    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(view.state.doc.toString()).toBe("X first\nfoo here\n");
    expect(view.state.selection.main.from).toBe(8);
    expect(view.state.selection.main.to).toBe(11);

    replaceEditorText("bar only\n");
    await settle();
    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    expect(view.state.doc.toString()).toBe("bar only\n");
    expect(host.textContent).toContain("搜索结果已过期，请重新搜索");
  });

  it("ignores a search result that finishes after another file is opened", async () => {
    const files = {
      "a.md": "# A\n",
      "b.md": "# B\n",
      "c.md": "# C\nfoo\n",
    };
    await setupWorkspace(files);
    await openPath("/notes/b.md");
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");

    const cRead = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "c.md"
        ? cRead.promise
        : Promise.resolve(files[path as keyof typeof files] ?? ""),
    );
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("c.md", 2, "foo", 0, "foo"));
    await settle();
    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    expect(mocks.readFile).toHaveBeenCalledWith("c.md");
    expect(tabElements()).toHaveLength(1);

    searchInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(host.querySelector("[data-search-panel]")).toBeNull();
    host.querySelector<HTMLElement>('[data-tree-path="a.md"]')!.click();
    await settle();
    expect(tabElements()).toHaveLength(2);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    const view = editorView();
    view.dispatch({ selection: { anchor: 1, head: 2 } });
    view.focus();
    expect(view.state.doc.toString()).toBe("# A\n");

    cRead.resolve(files["c.md"]);
    await settle();

    expect(tabElements()).toHaveLength(2);
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
      "a.md",
    );
    expect(editorView()).toBe(view);
    expect(editorView().state.doc.toString()).toBe("# A\n");
    expect(editorView().state.selection.main.from).toBe(1);
    expect(editorView().state.selection.main.to).toBe(2);
    expect(editorView().hasFocus).toBe(true);
  });

  it("honors a newer click on the same pending search result", async () => {
    const files = {
      "a.md": "# A\n",
      "b.md": "# B\n",
      "c.md": "# C\nfoo\n",
    };
    await setupWorkspace(files);
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");

    const cRead = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "c.md"
        ? cRead.promise
        : Promise.resolve(files[path as keyof typeof files] ?? ""),
    );
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("c.md", 2, "foo", 0, "foo"));
    await settle();
    const cResult = host.querySelector<HTMLButtonElement>(
      '[data-search-path="c.md"] [data-search-result]',
    );
    expect(cResult).not.toBeNull();
    cResult!.click();
    await settle();
    expect(tabElements()).toHaveLength(2);

    tabNamed("a.md").click();
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");

    cResult!.click();
    await settle();
    cRead.resolve(files["c.md"]);
    await settle();

    expect(tabElements()).toHaveLength(3);
    expect(tabNamed("c.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe(files["c.md"]);
    expect(editorView().state.selection.main.from).toBe(4);
    expect(editorView().state.selection.main.to).toBe(7);
    expect(editorView().hasFocus).toBe(true);
  });

  it("lets a newer search result supersede a pending older result", async () => {
    const files = {
      "a.md": "# A\n",
      "c.md": "foo\n",
      "d.md": "foo\n",
    };
    await setupWorkspace(files);
    await openPath("/notes/a.md");

    const reads = {
      "c.md": deferred<string>(),
      "d.md": deferred<string>(),
    };
    mocks.readFile.mockImplementation((path: string) => {
      const read = reads[path as keyof typeof reads];
      if (read) return read.promise;
      return Promise.resolve(files[path as keyof typeof files] ?? "");
    });
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("c.md", 1, "foo", 0, "foo"));
    lastSearch().onLine(searchLine("d.md", 1, "foo", 0, "foo"));
    await settle();

    const cResult = host.querySelector<HTMLButtonElement>(
      '[data-search-path="c.md"] [data-search-result]',
    );
    const dResult = host.querySelector<HTMLButtonElement>(
      '[data-search-path="d.md"] [data-search-result]',
    );
    expect(cResult).not.toBeNull();
    expect(dResult).not.toBeNull();
    cResult!.click();
    await settle();
    dResult!.click();
    await settle();

    reads["c.md"].resolve(files["c.md"]);
    await settle();
    expect(host.querySelector('[role="tab"]')).not.toBeNull();
    expect(tabElements()).toHaveLength(1);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");

    reads["d.md"].resolve(files["d.md"]);
    await settle();
    expect(tabElements()).toHaveLength(2);
    expect(tabNamed("d.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.from).toBe(0);
    expect(editorView().state.selection.main.to).toBe(3);
  });

  it("reads a changed disk file without selecting an old offset", async () => {
    tree = [entry("b.md", "b.md")];
    mocks.readFile.mockResolvedValue("different text\n");
    await openFolder();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("b.md", 1, "foo", 0, "foo"));
    await settle();

    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("different text\n");
    expect(editorView().state.selection.main.empty).toBe(true);
    expect(host.textContent).toContain("搜索结果已过期，请重新搜索");
  });

  it("reports a missing file instead of opening an empty tab", async () => {
    tree = [entry("gone.md", "gone.md")];
    mocks.readFile.mockRejectedValue(new Error("ENOENT"));
    await openFolder();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("foo");
    await settle();
    lastSearch().onLine(searchLine("gone.md", 1, "foo", 0, "foo"));
    await settle();

    host.querySelector<HTMLButtonElement>("[data-search-result]")!.click();
    await settle();
    expect(host.textContent).toContain("读取失败");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });

  it("cancels the channel when the workspace switches", async () => {
    await mountAppWithApi();
    await openFolder();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("needle");
    await settle();
    const session = lastSearch();

    mocks.pickFolder.mockResolvedValue({ path: "/other", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/other", 2));
    await exposedApp!.value.chooseFolder();
    await settle();
    expect(session.close).toHaveBeenCalled();
    expect(host.querySelector("[data-search-panel]")).toBeNull();
  });

  it("cancels the channel when the workspace closes", async () => {
    await mountAppWithApi();
    await openFolder();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("needle");
    await settle();
    const session = lastSearch();
    await exposedApp!.value.closeWorkspace();
    await settle();
    expect(session.close).toHaveBeenCalled();
    expect(host.querySelector("[data-search-panel]")).toBeNull();
    expect(host.textContent).toContain("开始写作");
  });

  it("works in the narrow overlay sidebar and dismisses the overlay first", async () => {
    await withViewportWidth(800, async () => {
      await openFolder();
      expect(host.querySelector("aside")).toBeNull();
      const shortcut = pressAppShortcut("f", true);
      await settle();
      expect(shortcut.defaultPrevented).toBe(true);
      expect(host.querySelector("aside")?.className).toContain(
        "sidebar--overlay",
      );
      expect(searchInput()).not.toBeNull();

      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(escape);
      await settle();
      expect(escape.defaultPrevented).toBe(true);
      expect(host.querySelector("aside")).toBeNull();

      pressAppShortcut("f", true);
      await settle();
      expect(host.querySelector("aside")?.className).toContain(
        "sidebar--overlay",
      );
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      typeSearch("needle");
      await settle();
      searchInput().value = "";
      searchInput().dispatchEvent(new Event("input", { bubbles: true }));
      await settle();
      expect(host.querySelector("aside")?.className).toContain(
        "sidebar--overlay",
      );
      expect(host.querySelector("[data-search-panel]")).toBeNull();
      expect(document.activeElement?.getAttribute("aria-label")).toContain(
        "搜索工作区",
      );
    });
  });

  it("leaves search and mounts the tree before creating a file", async () => {
    await openFile();
    pressAppShortcut("f", true);
    await settle();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    editorView().focus();
    pressAppShortcut("n");
    await settle();
    expect(host.querySelector("[data-search-panel]")).toBeNull();
    expect(host.querySelector('[data-tree-path="a.md"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    );
    expect(input).not.toBeNull();
    expect(input!.value).toBe("未命名.md");
  });

  it("leaves the narrow search overlay in the tree before creating a file", async () => {
    await openFile();
    await withViewportWidth(800, async () => {
      pressAppShortcut("f", true);
      await settle();
      expect(host.querySelector("aside")?.className).toContain(
        "sidebar--overlay",
      );
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      editorView().focus();
      pressAppShortcut("n");
      await settle();
      expect(host.querySelector("[data-search-panel]")).toBeNull();
      expect(host.querySelector('[data-tree-path="a.md"]')).not.toBeNull();
      expect(host.querySelector("aside")?.className).toContain(
        "sidebar--overlay",
      );
      const input = host.querySelector<HTMLInputElement>(
        'input[aria-label="新建文件"]',
      );
      expect(input).not.toBeNull();
      expect(input!.value).toBe("未命名.md");
    });
  });

  it("lets a slash menu own Escape without closing search", async () => {
    await openFile("a.md", "# A\n");
    pressAppShortcut("f", true);
    await settle();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    editorView().focus();
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    editorView().contentDOM.dispatchEvent(escape);
    await settle();
    expect(escape.defaultPrevented).toBe(true);
    expect(slashMenuElement()).toBeNull();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(host.querySelector("[data-search-panel]")).toBeNull();
  });

  it("closes a floating outline before search from the search input", async () => {
    await openFile("a.md", "# 文章\n\n## 一\n");
    await withViewportWidth(800, async () => {
      pressAppShortcut("f", true);
      await settle();
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      outlineToggle()!.click();
      await settle();
      expect(outlinePanel()).not.toBeNull();
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      searchInput().focus();
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      });
      searchInput().dispatchEvent(escape);
      await settle();
      expect(escape.defaultPrevented).toBe(true);
      expect(outlinePanel()).toBeNull();
      expect(document.activeElement).toBe(searchInput());
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    });
  });

  it("keeps a fixed outline while find closes before search", async () => {
    await withViewportWidth(1100, async () => {
      await remountWithSettings({ outlineVisible: true });
      await openFile("a.md", "# 文章\n\n## 一\n");
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      pressAppShortcut("f", true);
      await settle();
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      editorView().focus();
      pressMod("f", "KeyF", "macos");
      await settle();
      expect(findPanel()).not.toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();

      searchInput().focus();
      const escape = new KeyboardEvent("keydown", {
        key: "Escape",
        code: "Escape",
        bubbles: true,
        cancelable: true,
      });
      searchInput().dispatchEvent(escape);
      await settle();
      expect(escape.defaultPrevented).toBe(true);
      expect(findPanel()).toBeNull();
      expect(outlinePanel()?.dataset.placement).toBe("fixed");
      expect(editorView().hasFocus).toBe(true);
      expect(host.querySelector("[data-search-panel]")).not.toBeNull();
    });
  });

  it("lets a slash menu and find panel each consume Escape before search", async () => {
    await openFile("a.md", "# A\n");
    pressAppShortcut("f", true);
    await settle();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    editorView().focus();
    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findPanel()).not.toBeNull();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();

    const slashEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    editorView().contentDOM.dispatchEvent(slashEscape);
    await settle();
    expect(slashEscape.defaultPrevented).toBe(true);
    expect(slashMenuElement()).toBeNull();
    expect(findPanel()).not.toBeNull();
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    searchInput().focus();
    const findEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    searchInput().dispatchEvent(findEscape);
    await settle();
    expect(findEscape.defaultPrevented).toBe(true);
    expect(findPanel()).toBeNull();
    expect(editorView().hasFocus).toBe(true);
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    const searchEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    searchInput().focus();
    searchInput().dispatchEvent(searchEscape);
    await settle();
    expect(searchEscape.defaultPrevented).toBe(true);
    expect(host.querySelector("[data-search-panel]")).toBeNull();
  });

  it("does not treat IME keys as search exit or navigation", async () => {
    await openFile();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("needle");
    await settle();

    const composing = new KeyboardEvent("keydown", {
      key: "Escape",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    searchInput().dispatchEvent(composing);
    await settle();
    expect(composing.defaultPrevented).toBe(false);
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();

    const keyCode229 = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(keyCode229, "keyCode", { value: 229 });
    searchInput().dispatchEvent(keyCode229);
    await settle();
    expect(keyCode229.defaultPrevented).toBe(false);
    expect(host.querySelector("[data-search-panel]")).not.toBeNull();
  });

  it.each(["popup-cycle", "source-edit", "source-rebuild"] as const)(
    "drops a pending search result when its source changes: %s",
    async (change) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({ "a.md": "source\n", "b.md": target });
      await openPath("/notes/a.md");
      const source = editorView();
      const read = deferred<string>();
      mocks.readFile.mockImplementationOnce(() => read.promise);
      const line = searchLineFromPart(
        searchLine("b.md", 3, "# 目标", 2, "目标"),
      )!;
      const opening = appSetupState().openSearchResult({
        generation: 1,
        line,
        match: line.matches[0],
      });
      expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
      if (change === "popup-cycle") {
        source.focus();
        pressMod("k", "KeyK", "macos");
        await settle();
        expect(linkImageDialog()).not.toBeNull();
        typeLinkImageField("链接", "https://example.com/new-owner");
      } else if (change === "source-edit") {
        typeIntoEditor("X");
      } else {
        await appSetupState().mountActive(false);
        expect(editorView()).not.toBe(source);
      }
      read.resolve(target);
      const result = await opening;
      await settle();
      expect(result).toBe(false);
      expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
      expect(
        [...host.querySelectorAll('[role="tab"]')].some((tab) =>
          tab.textContent?.includes("b.md"),
        ),
      ).toBe(false);
      if (change === "popup-cycle") {
        expect(linkImageDialog()).not.toBeNull();
      }
    },
  );

  it("keeps a pending search result when its source remains current", async () => {
    await remountWithSettings({ editorMode: "source" });
    const target = "prefix\n\n# 目标\n\nend\n";
    await setupWorkspace({ "a.md": "source\n", "b.md": target });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    const line = searchLineFromPart(
      searchLine("b.md", 3, "# 目标", 2, "目标"),
    )!;
    const opening = appSetupState().openSearchResult({
      generation: 1,
      line,
      match: line.matches[0],
    });
    expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
    read.resolve(target);
    await expect(opening).resolves.toBe(true);
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.from).toBe(10);
    expect(editorView().state.selection.main.to).toBe(12);
  });

  it("opens a search result from the start page without a source tab", async () => {
    await remountWithSettings({ editorMode: "source" });
    const target = "prefix\n\n# 目标\n\nend\n";
    await setupWorkspace({ "b.md": target });
    expect(tabElements()).toHaveLength(0);
    const line = searchLineFromPart(
      searchLine("b.md", 3, "# 目标", 2, "目标"),
    )!;
    await expect(
      appSetupState().openSearchResult({
        generation: 1,
        line,
        match: line.matches[0],
      }),
    ).resolves.toBe(true);
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.from).toBe(10);
    expect(editorView().state.selection.main.to).toBe(12);
  });

  it("opens a search result from a preview tab without an editor", async () => {
    await setupWorkspace({
      "b.md": "prefix\n\n# 目标\n\nend\n",
      "cover.png": "png",
    });
    treeRow("cover.png").click();
    await settle();
    expect(tabNamed("cover.png").getAttribute("aria-selected")).toBe("true");
    const line = searchLineFromPart(
      searchLine("b.md", 3, "# 目标", 2, "目标"),
    )!;
    await expect(
      appSetupState().openSearchResult({
        generation: 1,
        line,
        match: line.matches[0],
      }),
    ).resolves.toBe(true);
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.from).toBe(10);
    expect(editorView().state.selection.main.to).toBe(12);
  });

  it("closes the search channel when the page is destroyed", async () => {
    await openFolder();
    pressAppShortcut("f", true);
    await settle();
    typeSearch("needle");
    await settle();
    const session = lastSearch();
    app?.unmount();
    app = null;
    expect(session.close).toHaveBeenCalled();
  });
});

describe("link and image editing", () => {
  it("opens a new link from Mod-K in all three modes and cancels with Escape", async () => {
    for (const stored of ["live", "immersive", "source"] as const) {
      await remountWithSettings({ editorMode: stored });
      await openFile("a.md", "text\n");
      const view = editorView();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
      pressMod("k", "KeyK", "macos");
      await settle();

      expect(linkImageDialog()).not.toBeNull();
      expect(document.activeElement).toBe(linkImageInput("文本"));
      expect(view.state.doc.toString()).toBe("text\n");

      pressEscape(linkImageInput("文本"));
      await settle();
      expect(linkImageDialog()).toBeNull();
      expect(view.state.doc.toString()).toBe("text\n");
      expect(document.activeElement).toBe(view.contentDOM);
    }
  });

  it("opens an immersive [ dialog and restores selected text on Escape", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "文字\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: 0, head: 2 } });
    view.focus();
    expect(typeDirect("[")).toBe(true);
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    expect(view.state.doc.toString()).toBe("文字\n");

    pressEscape(linkImageInput("文本"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("文字\n");
    expect(view.state.doc.toString()).not.toContain("[文字]()");
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("completes a new link once and undoes it as one step", async () => {
    await openFile("a.md", "text\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();

    typeLinkImageField("文本", "链接");
    typeLinkImageField("链接", "https://example.com");
    pressEnter(linkImageInput("链接"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("text\n[链接](https://example.com)");
    expect(document.activeElement).toBe(view.contentDOM);

    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(view.state.doc.toString()).toBe("text\n");
  });

  it("keeps body focus on an immersive click and enters the dialog with Tab", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();

    expect(linkImageDialog()).not.toBeNull();
    expect(document.activeElement).toBe(view.contentDOM);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.activeElement).toBe(linkImageInput("文本"));

    pressEscape(linkImageInput("文本"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("[文字](url)\n");
    expect(document.activeElement).toBe(view.contentDOM);
  });

  it("does not open the dialog from a click in live or source mode", async () => {
    for (const stored of ["live", "source"] as const) {
      await remountWithSettings({ editorMode: stored });
      await openFile("a.md", "[文字](url)\n");
      const view = editorView();
      view.focus();
      clickEditorAt(view.state.doc.toString().indexOf("文字"));
      await settle();
      expect(linkImageDialog()).toBeNull();
    }
  });

  it("leaves modifier-click link behavior pending without opening the dialog", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"), {
      metaKey: true,
    });
    await settle();
    expect(linkImageDialog()).toBeNull();
  });

  it("keeps body edits across Esc, undo and redo while a draft stays virtual", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\nend\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    vi.useFakeTimers();
    const at = view.state.doc.length;
    view.dispatch({
      changes: { from: at, insert: "X" },
      selection: { anchor: at + 1 },
      userEvent: "input.type",
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "a.md",
      "[文字](url)\nend\nX",
      1,
    );

    pressEscape(view.contentDOM);
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("[文字](url)\nend\nX");
    expect(view.state.doc.toString()).not.toContain("[]()");

    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(view.state.doc.toString()).toBe("[文字](url)\nend\n");
    pressMod("z", "KeyZ", "macos", true);
    await settle();
    expect(view.state.doc.toString()).toBe("[文字](url)\nend\nX");

    const next = view.state.doc.length;
    view.dispatch({
      changes: { from: next, insert: "Y" },
      selection: { anchor: next + 1 },
      userEvent: "input.type",
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(mocks.writeFile).toHaveBeenLastCalledWith(
      "a.md",
      "[文字](url)\nend\nXY",
      1,
    );
  });

  it("closes the dialog when a body edit invalidates its target", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "before [文字](url) after\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字") + 1);
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    view.dispatch({
      changes: { from: view.state.doc.toString().indexOf("文字"), insert: "X" },
      selection: { anchor: view.state.doc.toString().indexOf("文字") + 1 },
      userEvent: "input.type",
    });
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("before [X文字](url) after\n");
  });

  it("closes the dialog when the target tab is switched", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await setupWorkspace({
      "a.md": "[文字](url)\n",
      "b.md": "second\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    await openPath("/notes/b.md");
    tabNamed("b.md").click();
    await settle();
    expect(linkImageDialog()).toBeNull();
  });

  it("closes the dialog when an external replacement changes the active document", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    openFileText = "[新文字](new)\n";
    mocks.readFile.mockResolvedValue(openFileText);
    watchEvents?.([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("[新文字](new)\n");
  });

  it("lets the slash menu replace the link dialog without stacking popovers", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    typeSlashAtEnd();
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(slashMenuElement()).not.toBeNull();
  });

  it("reports a rejected image reveal without closing the dialog", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "![图](assets/a.png)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(0);
    await settle();
    mocks.revealImage.mockRejectedValue(new Error("workspace: unsupported image"));
    const reveal = [...linkImageDialog()!.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "在 Finder 中显示",
    )!;
    reveal.click();
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    expect(host.querySelector("footer")?.textContent).toContain(
      "显示图片失败",
    );
  });

  it("edits multiple immersive link drafts in one atomic dialog", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "甲 乙");
    const view = editorView();
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 1),
        EditorSelection.range(2, 3),
      ]),
    });
    view.focus();
    expect(typeDirect("[")).toBe(true);
    await settle();
    expect(view.state.doc.toString()).toBe("甲 乙");
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(linkImageDialog()?.dataset.batch).toBe("");
    expect(linkImageInput("文本 1").value).toBe("甲");
    expect(linkImageInput("文本 2").value).toBe("乙");
    expect(document.activeElement).toBe(linkImageInput("文本 1"));

    typeLinkImageField("文本 1", "甲一");
    typeLinkImageField("链接 1", "a");
    typeLinkImageField("文本 2", "乙二");
    typeLinkImageField("链接 2", "b");
    pressEnter(linkImageInput("链接 2"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("[甲一](a) [乙二](b)");

    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(view.state.doc.toString()).toBe("甲 乙");

    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 1),
        EditorSelection.range(2, 3),
      ]),
    });
    view.focus();
    expect(typeDirect("[")).toBe(true);
    await settle();
    expect(linkImageInput("文本 1").value).toBe("甲");
    pressEscape(linkImageInput("文本 1"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.doc.toString()).toBe("甲 乙");
  });

  it("lets the focused find input consume Escape while the link draft remains", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    pressMod("f", "KeyF", "macos");
    await settle();
    expect(findPanel()).not.toBeNull();
    expect(linkImageDialog()).not.toBeNull();
    expect(document.activeElement).toBe(findInput());

    pressEscape(findInput());
    await settle();
    expect(findPanel()).toBeNull();
    expect(linkImageDialog()).not.toBeNull();
    expect(view.state.doc.toString()).toBe("[文字](url)\n");

    expect(document.activeElement).toBe(view.contentDOM);
    pressEscape(view.contentDOM);
    await settle();
    expect(linkImageDialog()).toBeNull();
  });

  it("closes the link dialog when the command palette opens", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    await openFile("a.md", "[文字](url)\n");
    const view = editorView();
    view.focus();
    clickEditorAt(view.state.doc.toString().indexOf("文字"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();

    pressAppShortcut("p", true);
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(paletteInput()).not.toBeNull();
  });

  it("reveals only images the current workspace can resolve", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    const doc =
      "![图](assets/a.png)\n\n![远程](https://example.com/a.png)\n";
    await openFile("a.md", doc);
    const view = editorView();
    view.focus();
    const images = [
      ...view.contentDOM.querySelectorAll<HTMLImageElement>(".cm-nicole-image"),
    ];
    clickElementAt(images[0]!, doc.indexOf("图"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    expect(linkImageInput("路径").value).toBe("assets/a.png");
    const reveal = [...linkImageDialog()!.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "在 Finder 中显示",
    )!;
    expect(reveal.disabled).toBe(false);
    reveal.click();
    await settle();
    expect(mocks.revealImage).toHaveBeenCalledWith("assets/a.png", 1);

    pressEscape(view.contentDOM);
    await settle();
    clickElementAt(images[1]!, doc.indexOf("远程"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    expect(linkImageInput("路径").value).toBe("https://example.com/a.png");
    const remoteReveal = [...linkImageDialog()!.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "在 Finder 中显示",
    )!;
    expect(remoteReveal.disabled).toBe(true);
    remoteReveal.click();
    await settle();
    expect(mocks.revealImage).toHaveBeenCalledOnce();
  });

  it("keeps the link dialog inside the editor host beside a fixed outline", async () => {
    await remountWithSettings({ editorMode: "source", outlineVisible: true });
    await openFile("a.md", "# Heading\n[文字](url)\n");
    await withViewportWidth(1200, async () => {
      const view = editorView();
      const rect = {
        left: 252,
        right: 980,
        top: 60,
        bottom: 700,
        x: 252,
        y: 60,
        width: 728,
        height: 640,
        toJSON() {
          return {};
        },
      };
      const elements = [
        host.querySelector<HTMLElement>("[data-editor-host]")!,
        host.querySelector<HTMLElement>('[aria-label="Markdown 编辑器"]')!,
        view.dom,
        view.scrollDOM,
      ];
      for (const element of elements) {
        vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
          rect as unknown as DOMRect,
        );
      }
      vi.spyOn(view, "coordsAtPos").mockReturnValue({
        left: 950,
        right: 960,
        top: 100,
        bottom: 120,
      });
      view.dispatch({
        selection: { anchor: view.state.doc.toString().indexOf("文字") },
      });
      view.focus();
      pressMod("k", "KeyK", "macos");
      await settle();
      const popup = linkImageDialog()!;
      expect(popup).not.toBeNull();
      expect(popup.style.display).not.toBe("none");
      expect(Number.parseFloat(popup.style.left) + 340).toBeLessThanOrEqual(
        rect.right - 8,
      );
      expect(popup.style.maxWidth).toBe("712px");

      rect.right = 900;
      window.dispatchEvent(new Event("resize"));
      await settle();
      expect(Number.parseFloat(popup.style.left) + 340).toBeLessThanOrEqual(
        rect.right - 8,
      );
      expect(popup.style.maxWidth).toBe("632px");
    });
  });

  it("opens HTTP(S) links from a full Mod-click gesture in every mode without adding a selection", async () => {
    const doc = "[链接](https://example.com/a?x=1&amp;y=2)\n";
    for (const editorMode of ["source", "live", "immersive"] as const) {
      await remountWithSettings({ editorMode });
      await openFile("a.md", doc);
      const view = editorView();
      view.dispatch({ selection: { anchor: 0 } });
      const before = view.state.selection.ranges.length;
      mocks.openExternalURL.mockClear();
      clickEditorSequenceAt(doc.indexOf("链接"), { metaKey: true });
      await settle();
      expect(mocks.openExternalURL).toHaveBeenCalledTimes(1);
      expect(mocks.openExternalURL).toHaveBeenCalledWith(
        "https://example.com/a?x=1&y=2",
      );
      expect(linkImageDialog()).toBeNull();
      expect(view.state.selection.ranges).toHaveLength(before);
      expect(view.state.doc.toString()).toBe(doc);
    }
  });

  it("opens the current link field without committing the draft", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    const doc = "[链接](https://example.com/a)\n";
    await openFile("a.md", doc);
    const view = editorView();
    clickEditorAt(doc.indexOf("链接"));
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    typeLinkImageField("链接", "https://example.com/b?x=1&amp;y=2");
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    );
    expect(open).toBeDefined();
    open!.click();
    await settle();
    expect(mocks.openExternalURL).toHaveBeenCalledWith(
      "https://example.com/b?x=1&y=2",
    );
    expect(view.state.doc.toString()).toBe(doc);
    expect(linkImageDialog()).not.toBeNull();
  });

  it("jumps to a current-document heading from the link dialog", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 第一节\n\n[跳](#第一节)\n";
    await openFile("a.md", doc);
    const view = editorView();
    view.dispatch({ selection: { anchor: doc.indexOf("跳") } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.selection.main.head).toBe(0);
  });

  it("jumps to a workspace heading from the link dialog", async () => {
    await remountWithSettings({ editorMode: "source" });
    await setupWorkspace({
      "a.md": "prefix [跳](b.md#目标) end\n",
      "b.md": "prefix\n\n# 目标\n\nend\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({
      selection: { anchor: view.state.doc.toString().indexOf("跳") },
    });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    expect(linkImageDialog()).toBeNull();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.head).toBe(8);
  });

  it("does not open an empty link field", async () => {
    await remountWithSettings({ editorMode: "immersive" });
    const doc = "[链接](https://example.com/a)\n";
    await openFile("a.md", doc);
    clickEditorAt(doc.indexOf("链接"));
    await settle();
    typeLinkImageField("链接", "");
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    expect(mocks.openExternalURL).not.toHaveBeenCalled();
    expect(linkImageDialog()).not.toBeNull();
    expect(host.textContent).toContain("链接地址为空");
  });

  it("does not open a link during composition and retries after it ends", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "[链接](https://example.com/a)\n";
    await openFile("a.md", doc);
    const view = editorView();
    startDeadKeyComposition(view);
    clickEditorAt(doc.indexOf("链接"), { metaKey: true });
    await settle();
    expect(mocks.openExternalURL).not.toHaveBeenCalled();
    view.contentDOM.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    await settle();
    clickEditorAt(doc.indexOf("链接"), { metaKey: true });
    await settle();
    expect(mocks.openExternalURL).toHaveBeenCalledWith(
      "https://example.com/a",
    );
  });

  it("keeps a missing-heading dialog open with a clear notice", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 目标\n\n[跳](#不存在)\n";
    await openFile("a.md", doc);
    const view = editorView();
    view.dispatch({ selection: { anchor: doc.indexOf("跳") } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    expect(linkImageDialog()).not.toBeNull();
    expect(host.textContent).toContain("找不到标题");
  });

  it("keeps a dialog open when heading parsing remains incomplete", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 目标\n\n[跳](#目标)\n";
    await openFile("a.md", doc);
    const view = editorView();
    view.dispatch({ selection: { anchor: doc.indexOf("跳") } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    headingMocks.extract
      .mockReturnValueOnce({ headings: [], complete: false })
      .mockReturnValueOnce({ headings: [], complete: false });
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    await nextTask();
    expect(linkImageDialog()).not.toBeNull();
    expect(host.textContent).toContain("标题仍在解析，请稍后重试");
  });

  it("keeps a full modifier-click gesture on ordinary prose as a multi-selection", async () => {
    await remountWithSettings({ editorMode: "source" });
    await openFile("a.md", "alpha beta\n");
    const view = editorView();
    view.dispatch({ selection: { anchor: 0 } });
    view.focus();
    clickEditorSequenceAt(6, { metaKey: true });
    await settle();
    expect(mocks.openExternalURL).not.toHaveBeenCalled();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.selection.ranges).toHaveLength(2);
  });

  it("drops a late workspace link result after the source document changes", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    clickEditorAt(view.state.doc.toString().indexOf("去"), { metaKey: true });
    await settle();
    view.dispatch({ changes: { from: 0, insert: "X" } });
    read.resolve("# B\n");
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(
      [...host.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent?.includes("b.md"),
      ),
    ).toBe(false);
  });

  it("opens a workspace Markdown target and its heading", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md#目标)\n",
      "b.md": "# 目标\n\nold\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    clickEditorAt(view.state.doc.toString().indexOf("去"), { metaKey: true });
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# 目标\n\nold\n");
    expect(editorView().state.selection.main.head).toBe(0);
    expect(mocks.openExternalURL).not.toHaveBeenCalled();
  });

  it("reuses a dirty target tab and finds the heading in its in-memory document", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md#目标)\n",
      "b.md": "# 目标\n\nold\n",
    });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    const targetView = editorView();
    targetView.dispatch({
      selection: { anchor: targetView.state.doc.length },
    });
    typeIntoEditor("dirty");
    tabNamed("a.md").click();
    await settle();
    const view = editorView();
    clickEditorAt(view.state.doc.toString().indexOf("去"), { metaKey: true });
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# 目标\n\nold\ndirty");
    expect(editorView().state.selection.main.head).toBe(0);
  });

  it("reuses an authorized dirty single target and finds its heading", async () => {
    mocks.acceptSingleFile.mockResolvedValue({
      path: "/notes/b.md",
      name: "b.md",
    });
    mocks.readSingleFile.mockResolvedValue("# B\n\nend\n");
    pendingFiles = ["/notes/b.md"];
    openHandler?.();
    await settle();
    dialogButton("只打开这个文件").click();
    await settle();
    const singleView = editorView();
    singleView.dispatch({ selection: { anchor: singleView.state.doc.length } });
    typeIntoEditor("dirty");
    await setupWorkspace({
      "a.md": "[去](b.md#b)\n",
      "b.md": "# disk\n",
    });
    const row = host.querySelector<HTMLElement>('[data-tree-path="a.md"]');
    if (!row) throw new Error("workspace a.md row not found");
    row.click();
    await settle();
    const readCount = mocks.readFile.mock.calls.length;
    const view = editorView();
    clickEditorAt(view.state.doc.toString().indexOf("去"), { metaKey: true });
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# B\n\nend\ndirty");
    expect(mocks.readFile.mock.calls.length).toBe(readCount);
    expect(editorView().state.selection.main.head).toBe(0);
  });

  it("does not activate a pending workspace link after the dialog is cancelled", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({ selection: { anchor: 2 } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
    pressEscape(linkImageInput("链接"));
    await settle();
    expect(linkImageDialog()).toBeNull();
    read.resolve("# B\n");
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(
      [...host.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent?.includes("b.md"),
      ),
    ).toBe(false);
  });

  it("does not activate a pending workspace link after its dialog field changes", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({ selection: { anchor: 2 } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    typeLinkImageField("链接", "different.md");
    read.resolve("# B\n");
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(linkImageDialog()).not.toBeNull();
    expect(
      [...host.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent?.includes("b.md"),
      ),
    ).toBe(false);
  });

  it("does not close a replacement dialog when an older pending link resolves", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({ selection: { anchor: 2 } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!.click();
    pressEscape(linkImageInput("链接"));
    await settle();
    pressMod("k", "KeyK", "macos");
    await settle();
    const replacement = linkImageDialog()!;
    read.resolve("# B\n");
    await settle();
    expect(linkImageDialog()).toBe(replacement);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
  });

  it("does not publish a stale external-link error after tab navigation", async () => {
    await setupWorkspace({
      "a.md": "[去](https://example.com)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    await openPath("/notes/b.md");
    tabNamed("a.md").click();
    await settle();
    const pending = deferred<void>();
    mocks.openExternalURL.mockImplementationOnce(() => pending.promise);
    clickEditorAt(2, { metaKey: true });
    tabNamed("b.md").click();
    await settle();
    tabNamed("a.md").click();
    await settle();
    pending.reject(new Error("stale external failure"));
    await settle();
    expect(host.textContent).not.toContain("stale external failure");
  });

  it("does not activate an older pending link after a newer navigation", async () => {
    await setupWorkspace({
      "a.md": "[旧](b.md) [新](https://example.com)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({ selection: { anchor: 0 } });
    view.focus();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    mocks.openExternalURL.mockClear();
    clickEditorAt(view.state.doc.toString().indexOf("旧"), { metaKey: true });
    await settle();
    expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
    clickEditorAt(view.state.doc.toString().indexOf("新"), { metaKey: true });
    await settle();
    expect(mocks.openExternalURL).toHaveBeenCalledWith(
      "https://example.com",
    );
    read.resolve("# B\n");
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(
      [...host.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent?.includes("b.md"),
      ),
    ).toBe(false);
  });

  it("does not publish a stale external-link error after the root changes", async () => {
    await setupWorkspace({ "a.md": "[去](https://example.com)\n" });
    await openPath("/notes/a.md");
    const view = editorView();
    const pending = deferred<void>();
    mocks.openExternalURL.mockImplementationOnce(() => pending.promise);
    clickEditorAt(view.state.doc.toString().indexOf("去"), { metaKey: true });
    mocks.pickFolder.mockResolvedValue({ path: "/other", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/other", 2));
    sidebarButton("切换文件夹").click();
    await settle();
    dialogButton("切换").click();
    await settle();
    pending.reject(new Error("stale root failure"));
    await settle();
    expect(host.textContent).not.toContain("stale root failure");
  });

  it("does not move the caret after cancelling a heading retry", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 目标\n\n[跳](#目标)\n";
    await openFile("a.md", doc);
    const view = editorView();
    const caret = doc.indexOf("跳");
    view.dispatch({ selection: { anchor: caret } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    headingMocks.extract.mockReturnValueOnce({
      headings: [],
      complete: false,
    });
    [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!.click();
    pressEscape(linkImageInput("链接"));
    await settle();
    await nextTask();
    expect(view.state.selection.main.head).toBe(caret);
    expect(host.textContent).not.toContain("找不到标题");
  });

  it("keeps a replacement popup and caret after a non-dialog heading retry", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 目标\n\n[跳](#目标)\n";
    await openFile("a.md", doc);
    const view = editorView();
    const caret = doc.indexOf("跳");
    view.dispatch({ selection: { anchor: caret } });
    view.focus();
    headingMocks.extract.mockReturnValueOnce({
      headings: [],
      complete: false,
    });
    clickEditorSequenceAt(caret, { metaKey: true });
    pressMod("k", "KeyK", "macos");
    await settle();
    const replacement = linkImageDialog();
    expect(replacement).not.toBeNull();
    typeLinkImageField("链接", "https://example.com/new-draft");
    await nextTask();
    await settle();
    expect(view.state.selection.main.head).toBe(caret);
    expect(linkImageDialog()).toBe(replacement);
    expect(linkImageInput("链接").value).toBe(
      "https://example.com/new-draft",
    );
  });

  it("drops a non-dialog file read after the source editor view is rebuilt", async () => {
    await setupWorkspace({
      "a.md": "[去](b.md)\n",
      "b.md": "# B\n",
    });
    await openPath("/notes/a.md");
    const view = editorView();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    clickEditorSequenceAt(2, { metaKey: true });
    expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
    await appSetupState().mountActive(false);
    await settle();
    expect(editorView()).not.toBe(view);
    expect(editorView().state.doc.toString()).toBe(view.state.doc.toString());
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    read.resolve("# B\n");
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(
      [...host.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent?.includes("b.md"),
      ),
    ).toBe(false);
  });

  it("completes an owned deferred heading handoff", async () => {
    await remountWithSettings({ editorMode: "source" });
    const target = "prefix\n\n# 目标\n\nend\n";
    await setupWorkspace({
      "a.md": "[去](b.md#目标)\n",
      "b.md": target,
    });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    clickEditorSequenceAt(2, { metaKey: true });
    read.resolve(target);
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.head).toBe(8);
    expect(editorView().hasFocus).toBe(true);
  });

  it("preserves ordinary open selection with one shared read", async () => {
    await remountWithSettings({ editorMode: "source" });
    const target = "prefix\n\n# 目标\n\nend\n";
    await setupWorkspace({
      "a.md": "source\n",
      "b.md": target,
    });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    const row = host.querySelector<HTMLElement>('[data-tree-path="b.md"]');
    expect(row).not.toBeNull();
    row!.click();
    row!.click();
    expect(
      mocks.readFile.mock.calls.filter(([path]) => path === "b.md"),
    ).toHaveLength(1);
    read.resolve(target);
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.selection.main.head).toBe(0);
  });

  it.each(["popup-cycle", "source-rebuild"])(
    "drops a stale heading intent when an ordinary open joins its pending read: %s",
    async (invalidate) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({
        "a.md": "[去](b.md#目标)\n",
        "b.md": target,
      });
      await openPath("/notes/a.md");
      const source = editorView();
      source.focus();
      const read = deferred<string>();
      mocks.readFile.mockImplementationOnce(() => read.promise);
      clickEditorSequenceAt(2, { metaKey: true });
      expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
      if (invalidate === "popup-cycle") {
        pressMod("k", "KeyK", "macos");
        await settle();
        expect(linkImageDialog()).not.toBeNull();
        typeLinkImageField("链接", "https://example.com/new-owner");
        pressEscape(linkImageInput("链接"));
        await settle();
        expect(linkImageDialog()).toBeNull();
      } else {
        await appSetupState().mountActive(false);
        await settle();
        expect(editorView()).not.toBe(source);
        expect(editorView().state.doc.toString()).toBe(
          source.state.doc.toString(),
        );
      }
      const targetRow = host.querySelector<HTMLElement>(
        '[data-tree-path="b.md"]',
      );
      expect(targetRow).not.toBeNull();
      targetRow!.click();
      await settle();
      expect(
        mocks.readFile.mock.calls.filter(([path]) => path === "b.md"),
      ).toHaveLength(1);
      read.resolve(target);
      await settle();
      expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
      expect(editorView().state.doc.toString()).toBe(target);
      expect(editorView().state.selection.main.head).toBe(0);
    },
  );

  it.each(["existing", "pending"] as const)(
    "allows an owned deferred heading handoff: %s",
    async (mode) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({
        "a.md": "[去](b.md#目标)\n",
        "b.md": target,
      });
      await openPath("/notes/a.md");
      if (mode === "existing") {
        await openPath("/notes/b.md");
        tabNamed("a.md").click();
        await settle();
      }
      const read = deferred<string>();
      if (mode === "pending") {
        mocks.readFile.mockImplementationOnce(() => read.promise);
      }
      clickEditorSequenceAt(2, { metaKey: true });
      if (mode === "pending") read.resolve(target);
      await settle();
      expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
      expect(editorView().state.selection.main.head).toBe(8);
    },
  );

  it.each(["existing", "pending"] as const)(
    "keeps a newer ordinary same-file open after handoff: %s",
    async (mode) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({
        "a.md": "[去](b.md#目标)\n",
        "b.md": target,
      });
      await openPath("/notes/a.md");
      if (mode === "existing") {
        await openPath("/notes/b.md");
        tabNamed("a.md").click();
        await settle();
      }
      const read = deferred<string>();
      if (mode === "pending") {
        mocks.readFile.mockImplementationOnce(() => read.promise);
      }
      clickEditorSequenceAt(2, { metaKey: true });
      if (mode === "pending") {
        read.resolve(target);
        await Promise.resolve();
      }
      await nextTick();
      expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
      expect(editorView().state.selection.main.head).toBe(0);
      host.querySelector<HTMLElement>('[data-tree-path="b.md"]')!.click();
      await settle();
      expect(editorView().state.selection.main.head).toBe(0);
    },
  );

  it.each(["popup-cycle", "view-rebuild", "target-edit"] as const)(
    "drops a changed target after handoff: %s",
    async (change) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({
        "a.md": "[去](b.md#目标)\n",
        "b.md": target,
      });
      await openPath("/notes/a.md");
      await openPath("/notes/b.md");
      tabNamed("a.md").click();
      await settle();
      clickEditorSequenceAt(2, { metaKey: true });
      await nextTick();
      expect(editorView().state.selection.main.head).toBe(0);
      if (change === "popup-cycle") {
        pressMod("k", "KeyK", "macos");
        expect(appSetupState().linkImageEditor).not.toBeNull();
        pressEscape(editorView().contentDOM);
        expect(appSetupState().linkImageEditor).toBeNull();
      } else if (change === "view-rebuild") {
        await appSetupState().mountActive(false);
      } else {
        typeIntoEditor("X");
      }
      await settle();
      expect(editorView().state.selection.main.head).toBe(
        change === "target-edit" ? 1 : 0,
      );
    },
  );

  it.each([false, true] as const)(
    "keeps a normal search handoff while ignoring a newer ordinary open: %s",
    async (ordinary) => {
      await remountWithSettings({ editorMode: "source" });
      const target = "prefix\n\n# 目标\n\nend\n";
      await setupWorkspace({
        "a.md": "source\n",
        "b.md": target,
      });
      await openPath("/notes/a.md");
      await openPath("/notes/b.md");
      tabNamed("a.md").click();
      await settle();
      const line = searchLineFromPart(
        searchLine("b.md", 3, "# 目标", 2, "目标"),
      )!;
      const opening = appSetupState().openSearchResult({
        generation: 1,
        line,
        match: line.matches[0],
      });
      await nextTick();
      expect(editorView().state.selection.main.head).toBe(0);
      if (ordinary) {
        host.querySelector<HTMLElement>('[data-tree-path="b.md"]')!.click();
      }
      await opening;
      await settle();
      expect(editorView().state.selection.main.from).toBe(ordinary ? 0 : 10);
      expect(editorView().state.selection.main.to).toBe(ordinary ? 0 : 12);
    },
  );

  it("retries an incomplete heading parse once before declaring it missing", async () => {
    await remountWithSettings({ editorMode: "source" });
    const doc = "# 目标\n\n[跳](#目标)\n";
    await openFile("a.md", doc);
    const view = editorView();
    view.dispatch({ selection: { anchor: doc.indexOf("跳") } });
    view.focus();
    pressMod("k", "KeyK", "macos");
    await settle();
    headingMocks.extract
      .mockReturnValueOnce({ headings: [], complete: false })
      .mockReturnValueOnce({
        headings: [{ level: 1, text: "目标", position: 0, line: 1 }],
        complete: true,
      });
    const open = [...linkImageDialog()!.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "打开",
    )!;
    open.click();
    await settle();
    await nextTask();
    expect(linkImageDialog()).toBeNull();
    expect(view.state.selection.main.head).toBe(0);
  });
});

describe("settings tab", () => {
  it("opens one global settings tab from every entry without a workspace", async () => {
    await mountAppWithApi();
    await openSettingsFromShortcut();
    expect(settingsTabs()).toHaveLength(1);
    expect(settingsTabs()[0]!.getAttribute("title")).toBe("设置");
    expect(settingsView()).not.toBeNull();
    expect(mocks.setSettingsAccelerator).toHaveBeenCalledWith("Cmd+,");

    await openSettingsFromShortcut();
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", { detail: "app.settings" }),
    );
    await settle();
    expect(settingsTabs()).toHaveLength(1);

    pressAppShortcut("P", true);
    await settle();
    expect(paletteOffers("设置")).toBe(true);
    const settingsCommand = paletteOptions().find((item) =>
      item.textContent?.includes("设置"),
    )!;
    settingsCommand.click();
    await settle();
    expect(settingsTabs()).toHaveLength(1);

    pressAppShortcut("w");
    await settle();
    expect(settingsTabs()).toHaveLength(0);
    await openFolder();
    sidebarButton("设置").click();
    await settle();
    expect(settingsTabs()).toHaveLength(1);
    expect(settingsView()).not.toBeNull();
  });

  it("orders settings with Ctrl+Tab and includes it in close-other tabs", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    expect(settingsTabs()[0]!.getAttribute("aria-selected")).toBe("true");

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");

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
    expect(settingsTabs()).toHaveLength(0);
    expect(tabNamed("a.md")).toBeTruthy();
  });

  it("keeps settings across root switches and closing the workspace while filtering saved layouts", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    expect(settingsTabs()).toHaveLength(1);

    mocks.pickFolder.mockResolvedValue({ path: "/other", canceled: false });
    mocks.openFolder.mockResolvedValue(folder("/other", 2));
    pressAppShortcut("o");
    await settle();
    dialogButton("切换").click();
    await settle();
    expect(settingsTabs()).toHaveLength(1);
    expect(settingsView()).not.toBeNull();
    expect(tabElements().map((tab) => tab.textContent?.trim())).toContain(
      "设置",
    );

    const savedTabs = mocks.saveWorkspaceTabs.mock.calls.flatMap(
      (call) => call[1] as { kind: string }[],
    );
    expect(savedTabs.every((tab) => tab.kind !== "settings")).toBe(true);

    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.close-workspace",
      }),
    );
    await settle();
    expect(settingsTabs()).toHaveLength(1);
    expect(settingsView()).not.toBeNull();

    pressAppShortcut("w");
    await settle();
    expect(settingsTabs()).toHaveLength(0);
    expect(button("打开文件夹")).toBeTruthy();
  });

  it("hides editor chrome and leaves the background document untouched", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const view = editorView();
    view.dispatch({
      changes: { from: view.state.doc.length, insert: "typed\n" },
      userEvent: "input.type",
    });
    view.dispatch({ selection: { anchor: 3, head: 6 } });
    await openSettingsFromShortcut();

    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(buttons("源码").filter((item) => item.closest("header"))).toHaveLength(
      0,
    );
    expect(outlineToggle()).toBeNull();
    expect(host.querySelector("footer")?.textContent?.trim()).toBe("");
    const saved = pressAppShortcut("s");
    await settle();
    expect(saved.defaultPrevented).toBe(true);
    expect(mocks.writeFile).not.toHaveBeenCalled();

    pressAppShortcut("w");
    await settle();
    const restored = editorView();
    expect(restored.state.doc.toString()).toBe("# A\ntyped\n");
    expect(restored.state.selection.main.from).toBe(3);
    expect(restored.state.selection.main.to).toBe(6);
  });

  it("applies font text immediately and keeps selection and undo history", async () => {
    await setupWorkspace({ "a.md": "hello\n" });
    await openPath("/notes/a.md");
    typeIntoEditor("X");
    await settle();
    const before = editorView();
    before.dispatch({ selection: { anchor: 1, head: 4 } });
    await openSettingsFromShortcut();
    typeSettingsFont("reading", "Songti SC");
    expect(
      document.documentElement.style.getPropertyValue("--app-font-reading"),
    ).toContain('"Songti SC"');
    await vi.waitFor(() =>
      expect(mocks.setFonts).toHaveBeenCalledWith("", "Songti SC", ""),
    );

    pressAppShortcut("w");
    await settle();
    const restored = editorView();
    expect(restored.state.selection.main.from).toBe(1);
    expect(restored.state.selection.main.to).toBe(4);
    expect(restored.state.doc.toString()).toContain("X");
    pressMod("z", "KeyZ", "macos");
    await settle();
    expect(restored.state.doc.toString()).not.toContain("X");
  });

  it("closes the slash menu for a disabled mode without affecting another mode", async () => {
    await setupWorkspace({ "a.md": "\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    settingsCheckbox("editing", 1).click();
    await settle();
    expect(mocks.setSlashEnabled).toHaveBeenCalledWith("live", false);
    pressAppShortcut("w");
    await settle();

    editorView().dispatch({ selection: { anchor: 0 } });
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).toBeNull();

    const immersive = buttons("沉浸").find((item) => item.closest("header"));
    expect(immersive).toBeTruthy();
    immersive!.click();
    await settle();
    expect(immersive!.getAttribute("aria-pressed")).toBe("true");
    const ready = editorView();
    ready.dispatch({
      changes: { from: 0, to: ready.state.doc.length, insert: "\n" },
      selection: { anchor: 0 },
    });
    typeSlashAtEnd();
    await settle();
    expect(slashMenuElement()).not.toBeNull();
  });

  it("keeps late init from replacing user choices and writes the last font intent", async () => {
    const loaded = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();

    const theme = host.querySelector<HTMLSelectElement>("#settings-theme")!;
    theme.value = "dark";
    theme.dispatchEvent(new Event("change"));
    const showAll = settingsCheckbox("file-tree", 0);
    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    typeSettingsFont("reading", "First");
    typeSettingsFont("reading", "Second");

    loaded.resolve({
      theme: "system",
      editorMode: "source",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      showAllFiles: true,
      hideMarkdownExtension: true,
      readingFont: "Stale",
      slashEnabled: { live: false, immersive: true, source: true },
    });
    await settle();
    expect(theme.value).toBe("dark");
    expect(showAll.checked).toBe(false);
    expect(settingsFontInput("reading").value).toBe("Second");
    expect(settingsCheckbox("file-tree", 1).checked).toBe(true);
    expect(
      host.querySelector<HTMLInputElement>('[data-slash-mode="live"]')!.checked,
    ).toBe(false);

    await vi.waitFor(() =>
      expect(mocks.setFonts).toHaveBeenCalledWith("", "Second", ""),
    );
    const fontCalls = mocks.setFonts.mock.calls.length;
    typeSettingsFont("reading", "Third");
    typeSettingsFont("reading", "Fourth");
    await vi.waitFor(() => expect(mocks.setFonts).toHaveBeenCalledTimes(fontCalls + 1));
    expect(mocks.setFonts).toHaveBeenLastCalledWith("", "Fourth", "");
  });

  it("does not let an older failed write undo a newer preference intent", async () => {
    await openSettingsFromShortcut();
    const showAll = settingsCheckbox("file-tree", 0);
    mocks.setShowAllFiles
      .mockRejectedValueOnce(new Error("readonly"))
      .mockResolvedValueOnce(undefined);
    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    showAll.checked = true;
    showAll.dispatchEvent(new Event("change"));
    await settle();
    expect(mocks.setShowAllFiles).toHaveBeenNthCalledWith(1, false);
    expect(mocks.setShowAllFiles).toHaveBeenNthCalledWith(2, true);
    expect(settingsCheckbox("file-tree", 0).checked).toBe(true);
  });

  it("reverts a failed settings write and reports it once", async () => {
    await openSettingsFromShortcut();
    const showAll = settingsCheckbox("file-tree", 0);
    mocks.setShowAllFiles.mockRejectedValueOnce(new Error("readonly"));
    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    await settle();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("保存设置失败"),
    );
    expect(settingsCheckbox("file-tree", 0).checked).toBe(true);
    expect(mocks.setShowAllFiles).toHaveBeenCalledTimes(1);
  });

  it("cancels a batch close atomically with settings and dirty documents", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    typeIntoEditor("dirty");
    await openSettingsFromShortcut();
    tabNamed("a.md").click();
    await settle();
    mocks.writeFile.mockRejectedValue(new Error("readonly"));
    mocks.popupNativeMenu.mockResolvedValue("close-all-tabs");
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
    dialogButton("取消").click();
    await settle();
    expect(tabNamed("a.md")).toBeTruthy();
    expect(tabNamed("设置")).toBeTruthy();
    expect(editorView().state.doc.toString()).toContain("dirty");
  });

  it("E4 R1 fix: keeps cross-control writes and the toolbar command in queue order", async () => {
    await openSettingsFromShortcut();
    const gate = deferred<void>();
    const effects: string[] = [];
    mocks.setTheme.mockImplementation(async () => {
      await gate.promise;
      effects.push("theme");
    });
    mocks.setShowAllFiles.mockImplementation(async () => {
      effects.push("tree");
    });
    mocks.setFonts.mockImplementation(async () => {
      effects.push("fonts");
    });
    mocks.setFormatToolbarVisible.mockImplementation(async () => {
      effects.push("toolbar");
    });
    vi.useFakeTimers();
    const theme = host.querySelector<HTMLSelectElement>("#settings-theme")!;
    theme.value = "dark";
    theme.dispatchEvent(new Event("change"));
    settingsCheckbox("file-tree", 0).click();
    typeSettingsFont("reading", "New Reading");
    await vi.advanceTimersByTimeAsync(350);
    window.dispatchEvent(
      new CustomEvent("nicole:run-command", {
        detail: "app.show-format-toolbar",
      }),
    );
    await settle();
    expect(effects).toEqual([]);
    expect(mocks.setFonts).not.toHaveBeenCalled();
    expect(mocks.setFormatToolbarVisible).not.toHaveBeenCalled();

    gate.resolve();
    await settle();
    expect(effects).toEqual(["theme", "tree", "fonts", "toolbar"]);
    expect(mocks.setFonts).toHaveBeenLastCalledWith("", "New Reading", "");
    expect(mocks.setFormatToolbarVisible).toHaveBeenLastCalledWith(true);
  });

  it("E4 R1 fix: keeps a background external read behind settings", async () => {
    await setupWorkspace({ "a.md": "# Before\n" });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementation(() => read.promise);
    watchEvents!([{ op: "write", path: "a.md", isDir: false }]);
    await settle();
    expect(mocks.readFile).toHaveBeenCalledWith("a.md");
    await openSettingsFromShortcut();
    read.resolve("# After\n");
    await settle();

    expect(settingsView()).not.toBeNull();
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(host.textContent).not.toContain("已载入磁盘上的新内容");
    tabNamed("a.md").click();
    await settle();
    expect(editorView().state.doc.toString()).toBe("# After\n");
  });

  it("E4 R1 fix: waits for initial settings before saving an edited font", async () => {
    const loaded = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();

    typeSettingsFont("ui", "New UI");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 420));
    expect(mocks.setFonts).not.toHaveBeenCalled();

    loaded.resolve({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      uiFont: "Old UI",
      readingFont: "Old Reading",
      codeFont: "Old Code",
    });
    await settle();
    expect(settingsFontInput("ui").value).toBe("New UI");
    expect(settingsFontInput("reading").value).toBe("Old Reading");
    expect(settingsFontInput("code").value).toBe("Old Code");
    await vi.waitFor(() =>
      expect(mocks.setFonts).toHaveBeenLastCalledWith(
        "New UI",
        "Old Reading",
        "Old Code",
      ),
    );
  });

  it("E4 R1 fix: never writes unknown font fields after the initial read fails", async () => {
    mocks.getSettings.mockRejectedValue(new Error("unreadable"));
    await mountAppWithApi();
    await openSettingsFromShortcut();

    typeSettingsFont("ui", "New UI");
    await new Promise<void>((resolve) => window.setTimeout(resolve, 420));
    expect(mocks.setFonts).not.toHaveBeenCalled();
    expect(settingsFontInput("ui").value).toBe("New UI");
    expect(host.textContent).toContain("保存设置失败");
  });

  it("E4 R1 fix: restores the saved font baseline after an early write fails", async () => {
    const loaded = deferred<Record<string, unknown>>();
    const write = deferred<void>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    mocks.setFonts.mockImplementation(() => write.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();

    typeSettingsFont("ui", "New UI");
    loaded.resolve({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      uiFont: "Old UI",
      readingFont: "Old Reading",
      codeFont: "Old Code",
    });
    await settle();
    await vi.waitFor(() => expect(mocks.setFonts).toHaveBeenCalled());
    write.reject(new Error("readonly"));
    await settle();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("保存设置失败"),
    );
    expect(settingsFontInput("ui").value).toBe("Old UI");
    expect(settingsFontInput("reading").value).toBe("Old Reading");
    expect(settingsFontInput("code").value).toBe("Old Code");
  });

  it("E4 R1 fix: rolls a failed early theme write back to the saved theme", async () => {
    const loaded = deferred<Record<string, unknown>>();
    const write = deferred<void>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    mocks.setTheme.mockImplementation(() => write.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();
    const select = host.querySelector<HTMLSelectElement>("#settings-theme")!;

    select.value = "light";
    select.dispatchEvent(new Event("change"));
    loaded.resolve({
      theme: "dark",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
    });
    await settle();
    expect(select.value).toBe("light");
    await vi.waitFor(() =>
      expect(mocks.setTheme).toHaveBeenCalledWith("light"),
    );
    write.reject(new Error("readonly"));
    await settle();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("保存设置失败"),
    );
    expect(select.value).toBe("dark");
  });

  it("E4 R1 fix: keeps a successful early baseline ahead of a late read", async () => {
    const loaded = deferred<Record<string, unknown>>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    mocks.setTheme
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("readonly"));
    await mountAppWithApi();
    await openSettingsFromShortcut();
    const select = host.querySelector<HTMLSelectElement>("#settings-theme")!;

    select.value = "light";
    select.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(mocks.setTheme).toHaveBeenCalledWith("light"),
    );
    loaded.resolve({
      theme: "dark",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
    });
    await settle();
    select.value = "system";
    select.dispatchEvent(new Event("change"));
    await settle();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("保存设置失败"),
    );
    expect(select.value).toBe("light");
  });

  it("E4 R1 fix: restores a saved boolean baseline after an early write fails", async () => {
    const loaded = deferred<Record<string, unknown>>();
    const write = deferred<void>();
    mocks.getSettings.mockImplementation(() => loaded.promise);
    mocks.setShowAllFiles.mockImplementation(() => write.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();
    const showAll = settingsCheckbox("file-tree", 0);

    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    loaded.resolve({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      showAllFiles: false,
    });
    await settle();
    await vi.waitFor(() =>
      expect(mocks.setShowAllFiles).toHaveBeenCalledWith(false),
    );
    write.reject(new Error("readonly"));
    await settle();
    await vi.waitFor(() =>
      expect(host.textContent).toContain("保存设置失败"),
    );
    expect(showAll.checked).toBe(false);
  });

  it("E4 R1 fix: keeps settings when an earlier ordinary file read returns", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "b.md" ? read.promise : Promise.resolve("# A\n"),
    );
    treeRow("b.md").click();
    await settle();
    expect(mocks.readFile).toHaveBeenCalledWith("b.md");

    await openSettingsFromShortcut();
    expect(settingsView()).not.toBeNull();
    read.resolve("# B\n");
    await settle();
    expect(settingsView()).not.toBeNull();
    expect(
      tabElements().some((tab) => tab.textContent?.includes("b.md")),
    ).toBe(false);
  });

  it("E4 R1 fix: lets a new ordinary open join the read started before settings", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "# B\n" });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readFile.mockImplementation((path: string) =>
      path === "b.md" ? read.promise : Promise.resolve("# A\n"),
    );
    treeRow("b.md").click();
    await settle();
    await openSettingsFromShortcut();
    treeRow("b.md").click();
    await settle();

    read.resolve("# B\n");
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# B\n");
  });

  it("E4 R1 fix: opens a workspace search result from settings", async () => {
    await setupWorkspace({ "a.md": "foo\nnext\n" });
    await openSettingsFromShortcut();
    sidebarButton("搜索工作区").click();
    await settle();
    typeSearch("foo");
    await vi.waitFor(() => expect(searchSessions).toHaveLength(1));
    lastSearch().onLine(searchLine("a.md", 1, "foo", 0, "foo"));
    await settle();
    const result = host.querySelector<HTMLButtonElement>("[data-search-result]");
    expect(result).not.toBeNull();
    result!.click();
    await settle();

    expect(host.querySelector(".cm-editor")).not.toBeNull();
    expect(
      editorView().state.sliceDoc(
        editorView().state.selection.main.from,
        editorView().state.selection.main.to,
      ),
    ).toBe("foo");
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
  });

  it("E4 R1 fix: revokes a settings-source search after the tab changes", async () => {
    await setupWorkspace({ "a.md": "# A\n", "b.md": "foo\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    const read = deferred<string>();
    mocks.readFile.mockImplementationOnce(() => read.promise);
    const line = searchLineFromPart(searchLine("b.md", 1, "foo", 0, "foo"))!;
    const opening = appSetupState().openSearchResult({
      generation: 1,
      line,
      match: line.matches[0],
    });
    expect(mocks.readFile).toHaveBeenLastCalledWith("b.md");
    tabNamed("a.md").click();
    await settle();
    read.resolve("foo\n");
    await expect(opening).resolves.toBe(false);
    await settle();

    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
    expect(
      tabElements().some((tab) => tab.textContent?.includes("b.md")),
    ).toBe(false);
  });

  it("E4 R1 fix: cycles tabs from a focused settings select", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    const select = host.querySelector<HTMLSelectElement>("#settings-theme")!;
    expect(document.activeElement).toBe(select);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    select.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(tabNamed("a.md").getAttribute("aria-selected")).toBe("true");
  });

  it("E4 R1 fix: closes settings with ModW from a focused font input", async () => {
    await openSettingsFromShortcut();
    const input = settingsFontInput("ui");
    input.focus();
    expect(document.activeElement).toBe(input);

    const event = new KeyboardEvent("keydown", {
      key: "w",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(settingsView()).toBeNull();
  });

  it("E4 R1 fix: hides mode controls on start, settings and empty-workspace states", async () => {
    await mountAppWithApi();
    const modeGroup = () =>
      host.querySelector('[role="group"][aria-label="编辑模式"]');
    expect(modeGroup()).toBeNull();

    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    expect(modeGroup()).not.toBeNull();
    await openSettingsFromShortcut();
    expect(modeGroup()).toBeNull();
    pressAppShortcut("w");
    await settle();
    expect(modeGroup()).not.toBeNull();

    pressAppShortcut("w");
    await settle();
    expect(tabElements()).toHaveLength(0);
    expect(modeGroup()).toBeNull();
    sidebarButton("设置").click();
    await settle();
    expect(settingsView()).not.toBeNull();
    expect(modeGroup()).toBeNull();
  });

  it("E4 R2 fix: retries a failed settings baseline once and preserves newer font intent", async () => {
    mocks.getSettings.mockClear();
    const retry = deferred<Record<string, unknown>>();
    mocks.getSettings
      .mockRejectedValueOnce(new Error("initial read failure"))
      .mockImplementationOnce(() => retry.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();
    try {
      await vi.waitFor(() =>
        expect(mocks.getSettings).toHaveBeenCalledTimes(2),
      );
    } catch (error) {
      retry.resolve({});
      throw error;
    }

    vi.useFakeTimers();
    typeSettingsFont("ui", "First UI");
    typeSettingsFont("reading", "New Reading");
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(mocks.getSettings).toHaveBeenCalledTimes(2);
    expect(mocks.setFonts).not.toHaveBeenCalled();

    retry.resolve({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: ["/should-not-open"],
      expandedFolders: {},
      uiFont: "Saved UI",
      readingFont: "Saved Reading",
      codeFont: "Saved Code",
    });
    await settle();
    expect(mocks.setFonts).toHaveBeenLastCalledWith(
      "First UI",
      "New Reading",
      "Saved Code",
    );
    expect(mocks.openFolder).not.toHaveBeenCalled();
  });

  it("E4 R2 fix: reports a failed retry, writes nothing unknown, then recovers", async () => {
    mocks.getSettings.mockClear();
    const retry = deferred<Record<string, unknown>>();
    mocks.getSettings
      .mockRejectedValueOnce(new Error("initial read failure"))
      .mockImplementationOnce(() => retry.promise);
    await mountAppWithApi();
    await openSettingsFromShortcut();
    try {
      await vi.waitFor(() =>
        expect(mocks.getSettings).toHaveBeenCalledTimes(2),
      );
    } catch (error) {
      retry.resolve({});
      throw error;
    }

    vi.useFakeTimers();
    typeSettingsFont("ui", "First UI");
    await vi.advanceTimersByTimeAsync(400);
    await settle();
    expect(mocks.setFonts).not.toHaveBeenCalled();
    retry.reject(new Error("retry read failure"));
    await settle();
    expect(host.textContent).toContain("保存设置失败");

    mocks.getSettings.mockResolvedValueOnce({
      theme: "system",
      sidebarWidth: 252,
      recentFolders: [],
      expandedFolders: {},
      uiFont: "Saved UI",
      readingFont: "Saved Reading",
      codeFont: "Saved Code",
    });
    typeSettingsFont("ui", "Retry UI");
    await settle();
    expect(mocks.getSettings).toHaveBeenCalledTimes(3);
    expect(mocks.setFonts).toHaveBeenLastCalledWith(
      "Retry UI",
      "Saved Reading",
      "Saved Code",
    );
  });

  it("E4 R2 fix: keeps settings when a confirmed external single-file read returns", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readSingleFile.mockImplementation(() => read.promise);
    await openPath("/elsewhere/b.md");
    expect(dialog()?.textContent).toContain("这个文件不在已打开的文件夹中");
    dialogButton("只打开这个文件").click();
    await settle();
    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/elsewhere/b.md");
    expect(mocks.readSingleFile).toHaveBeenCalledWith("/elsewhere/b.md");

    await openSettingsFromShortcut();
    expect(settingsView()).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector("#settings-theme"));
    read.resolve("# B\n");
    await settle();

    expect(settingsView()).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector("#settings-theme"));
    expect(
      tabElements().some((tab) => tab.textContent?.includes("b.md")),
    ).toBe(false);
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/elsewhere/b.md");
  });

  it("E4 R2 fix: releases a confirmed single-file authorization when accept returns after settings", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const accept = deferred<{ path: string; name: string }>();
    mocks.acceptSingleFile.mockImplementation(() => accept.promise);
    mocks.readSingleFile.mockResolvedValue("# B\n");
    await openPath("/elsewhere/b.md");
    dialogButton("只打开这个文件").click();
    await settle();
    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/elsewhere/b.md");
    expect(mocks.readSingleFile).not.toHaveBeenCalled();

    await openSettingsFromShortcut();
    accept.resolve({ path: "/elsewhere/b.md", name: "b.md" });
    await settle();

    expect(settingsView()).not.toBeNull();
    expect(document.activeElement).toBe(host.querySelector("#settings-theme"));
    expect(mocks.readSingleFile).not.toHaveBeenCalled();
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/elsewhere/b.md");
    expect(
      tabElements().some((tab) => tab.textContent?.includes("b.md")),
    ).toBe(false);
  });

  it("E4 R2 fix: opens a new single file normally after settings", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    await openSettingsFromShortcut();
    mocks.readSingleFile.mockResolvedValue("# B\n");

    await appSetupState().openSingleFile("/elsewhere/b.md", "b.md");
    await settle();
    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# B\n");
  });

  it("E4 R2 fix: lets a newer single-file open join the pending read", async () => {
    await setupWorkspace({ "a.md": "# A\n" });
    await openPath("/notes/a.md");
    const read = deferred<string>();
    mocks.readSingleFile.mockImplementation(() => read.promise);
    await openPath("/elsewhere/b.md");
    dialogButton("只打开这个文件").click();
    await settle();
    await openSettingsFromShortcut();

    const joining = appSetupState().openSingleFile(
      "/elsewhere/b.md",
      "b.md",
    );
    await settle();
    read.resolve("# B\n");
    await expect(joining).resolves.toBe(true);
    await settle();

    expect(tabNamed("b.md").getAttribute("aria-selected")).toBe("true");
    expect(editorView().state.doc.toString()).toBe("# B\n");
    expect(mocks.releaseSingleFile).not.toHaveBeenCalled();
  });

  it("filters the tree and hides labels without changing paths or open previews", async () => {
    await setupWorkspace({ "a.md": "# A\n", "cover.png": "png" });
    await openPath("/notes/a.md");
    await openPath("/notes/cover.png");
    expect(tabNamed("cover.png")).toBeTruthy();
    await openSettingsFromShortcut();
    const showAll = settingsCheckbox("file-tree", 0);
    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    await settle();
    expect(host.querySelector('[data-tree-path="cover.png"]')).toBeNull();
    expect(tabNamed("cover.png")).toBeTruthy();
    expect(host.querySelector('[data-tree-path="a.md"]')?.textContent?.trim()).toBe(
      "a.md",
    );

    const hide = settingsCheckbox("file-tree", 1);
    hide.checked = true;
    hide.dispatchEvent(new Event("change"));
    await settle();
    expect(host.querySelector('[data-tree-path="a.md"]')?.textContent?.trim()).toBe(
      "a",
    );
    expect(tabNamed("a")).toBeTruthy();
    expect(tabNamed("a").getAttribute("title")).toBe("notes/a.md");

    showAll.checked = true;
    showAll.dispatchEvent(new Event("change"));
    await settle();
    expect(host.querySelector('[data-tree-path="a.md"]')?.textContent?.trim()).toBe(
      "a.md",
    );
  });
});
