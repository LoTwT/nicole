<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

import {
  detectLineEndings,
  normalizeLineEndings,
  withLineEnding,
  type LineEnding,
} from "./app/line-endings";
import {
  absoluteBaseName,
  absoluteParent,
  displayPath,
  isInFolder,
  relativePath,
} from "./app/paths";
import {
  isMac,
  shortcutText,
  trashLabel,
  type AppPlatform,
} from "./app/platform";
import {
  saveStatusPresentation,
  selectBanner,
  tabProblem,
  type SavePhase,
} from "./app/status";
import {
  classifyWatchEvents,
} from "./app/watch-events";
import type { TreeNode } from "./app/file-tree";
import AppBanner from "./components/AppBanner.vue";
import AppDialog from "./components/AppDialog.vue";
import AppSidebar from "./components/AppSidebar.vue";
import EmptyState from "./components/EmptyState.vue";
import NonMarkdownPlaceholder from "./components/NonMarkdownPlaceholder.vue";
import StatusBar from "./components/StatusBar.vue";
import TopBar, { type TopBarTab } from "./components/TopBar.vue";
import {
  createEditor,
  type EditorHandle,
  type EditorMode,
} from "./editor";
import { createImageInsertion } from "./image-insertion";
import { resolveImageUrl } from "./image-url";
import { getAppInfo, type AppInfo } from "./services/app";
import { onWindowFileDrop } from "./services/assets";
import {
  listDirectory,
  openWithDefaultApp,
  revealEntry,
  trashEntry,
} from "./services/files";
import { onOpenFile, takePendingOpenedFiles } from "./services/open-file";
import {
  getSettings,
  migrateLegacyTheme,
  setExpandedFolders,
  setSidebarWidth,
  setTheme,
  removeRecentFolder,
  type AppSettings,
  type ThemeSetting,
} from "./services/settings";
import {
  acceptSingleFile,
  dismissOfferedFile,
  readSingleFile,
  releaseSingleFile,
  writeSingleFile,
} from "./services/single-file";
import type { WorkspaceFileEvent } from "./services/mygo";
import {
  finishClose,
  onSaveBeforeClose,
  openFolder as openFolderAtPath,
  pickFolder,
  readFile,
  writeFile,
} from "./services/workspace";
import { watchWorkspace, type WorkspaceWatcher } from "./services/watch";

const AUTOSAVE_DELAY_MS = 1000;
const SAVING_DISPLAY_DELAY_MS = 300;
const NOTICE_DURATION_MS = 3000;

interface WorkspaceState {
  root: string;
  generation: number;
}

interface WorkspaceDocument {
  kind: "workspace";
  path: string;
  name: string;
}

interface SingleDocument {
  kind: "single";
  path: string;
  name: string;
}

interface PreviewDocument {
  kind: "preview";
  path: string;
  name: string;
  size: number;
  folder: string;
}

type MarkdownDocument = WorkspaceDocument | SingleDocument;
type CurrentDocument = MarkdownDocument | PreviewDocument;

interface PendingEdit {
  kind: "workspace" | "single";
  path: string;
  generation: number;
  text: string;
  ending: LineEnding;
}

interface Notice {
  text: string;
  tone: "success" | "danger" | "muted";
}

interface DialogAction {
  label: string;
  value: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  autofocus?: boolean;
}

interface DialogState {
  title: string;
  message: string;
  details?: string[];
  actions: DialogAction[];
}

const editorHost = ref<HTMLElement | null>(null);
const sidebar = ref<InstanceType<typeof AppSidebar> | null>(null);
const appInfo = ref<AppInfo | null>(null);
const workspace = ref<WorkspaceState | null>(null);
const currentDocument = ref<CurrentDocument | null>(null);
const documentText = ref("");
const originalText = ref("");
const lineEnding = ref<LineEnding>("\n");
const mixedLineEndings = ref(false);
const savePhase = ref<SavePhase>("idle");
const saveError = ref<string | null>(null);
const externalState = ref<"none" | "modified" | "deleted">("none");
const notice = ref<Notice | null>(null);
const mode = ref<EditorMode>("live");

const theme = ref<ThemeSetting>("system");
const sidebarWidth = ref(252);
const recentFolders = ref<string[]>([]);
const missingRecent = ref<string[]>([]);
const missingLastFolder = ref<string | null>(null);
const expandedByRoot = ref<Record<string, string[]>>({});

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const systemPrefersDark = ref(systemTheme.matches);

const viewportWidth = ref(window.innerWidth);
const isWide = computed(() => viewportWidth.value >= 960);
const isCompactTopBar = computed(() => viewportWidth.value < 760);
const sidebarOpen = ref(true);
const overlaySidebar = ref(false);

const dialog = ref<DialogState | null>(null);
let dialogResolve: ((value: string) => void) | null = null;
let dialogOpen = false;
let folderOperation: Promise<boolean> | null = null;

let editor: EditorHandle | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savingDisplayTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);
let pendingEdit: PendingEdit | null = null;
let writesInFlight = 0;
let recentSelfRename:
  | { oldPath: string; newPath: string; at: number }
  | null = null;
let applyingExternal = false;
let watcher: WorkspaceWatcher | null = null;
let offSaveBeforeClose: (() => void) | null = null;
let offOpenFile: (() => void) | null = null;
let offFileDrop: (() => void) | null = null;
let openedFilesQueue: Promise<void> = Promise.resolve();
let appReady = false;
let pendingOpenSignal = false;
let externalReadSequence = 0;
let externalRevision = 0;

const imageInsertion = createImageInsertion({
  getEditor: () => editor,
  getFile: () => {
    const doc = currentDocument.value;
    return doc?.kind === "workspace" ? doc.path : null;
  },
  getGeneration: () => workspace.value?.generation ?? 0,
  onError: () => showNotice("图片插入失败", "danger"),
});

const platform = computed<AppPlatform>(() => {
  const os = appInfo.value?.os;
  if (os === "darwin") return "macos";
  if (os === "windows") return "windows";
  if (os === "linux") return "linux";
  const guess = navigator.platform.toLowerCase();
  if (guess.includes("mac")) return "macos";
  if (guess.includes("win")) return "windows";
  return "linux";
});
const homeDir = computed(() => appInfo.value?.homeDir ?? "");
const mac = computed(() => isMac(platform.value));

const isDark = computed(() =>
  theme.value === "system" ? systemPrefersDark.value : theme.value === "dark",
);

const hasWorkspace = computed(() => workspace.value !== null);
const currentMarkdown = computed<MarkdownDocument | null>(() => {
  const doc = currentDocument.value;
  return doc !== null && doc.kind !== "preview" ? doc : null;
});
const currentPreview = computed<PreviewDocument | null>(() => {
  const doc = currentDocument.value;
  return doc?.kind === "preview" ? doc : null;
});
const isMarkdownOpen = computed(() => currentMarkdown.value !== null);

const sidebarShown = computed(
  () =>
    hasWorkspace.value &&
    (isWide.value ? sidebarOpen.value : overlaySidebar.value),
);
const showSidebarToggle = computed(
  () => hasWorkspace.value && !sidebarShown.value,
);
const selectedTreePath = computed(() => {
  const doc = currentDocument.value;
  return doc?.kind === "workspace" || doc?.kind === "preview"
    ? doc.path
    : null;
});

const rootName = computed(() =>
  workspace.value ? absoluteBaseName(workspace.value.root) : "",
);
const rootDisplayPath = computed(() =>
  workspace.value ? displayPath(workspace.value.root, homeDir.value) : "",
);
const expandedForRoot = computed(() => {
  if (!workspace.value) return [];
  return expandedByRoot.value[workspace.value.root] ?? [];
});

const saveStatus = computed(() => {
  if (currentMarkdown.value === null) {
    return null;
  }
  return saveStatusPresentation(savePhase.value, mixedLineEndings.value);
});

const banner = computed(() => {
  if (currentMarkdown.value === null) {
    return null;
  }
  return selectBanner({
    deleted: externalState.value === "deleted",
    externallyModified: externalState.value === "modified",
    saveError: saveError.value,
    mixedLineEndings: mixedLineEndings.value,
    singleFile: currentMarkdown.value.kind === "single",
  });
});

const tab = computed<TopBarTab | null>(() => {
  const doc = currentDocument.value;
  if (doc === null) {
    return null;
  }
  const failed = saveError.value !== null;
  const deleted =
    doc.kind === "workspace" && externalState.value === "deleted";
  const problem = tabProblem(deleted, mixedLineEndings.value, failed);
  let problemLabel = "";
  if (deleted) {
    problemLabel = "文件已在磁盘上被删除或移走";
  } else if (failed) {
    problemLabel = "保存失败";
  } else if (mixedLineEndings.value) {
    problemLabel = "换行风格混合";
  }
  let title: string;
  if (doc.kind === "workspace") {
    title = `${rootName.value}/${doc.path}`;
  } else if (doc.kind === "single") {
    title = doc.path;
  } else {
    title = `${rootName.value}/${doc.path}`;
  }
  return {
    name: doc.name,
    title,
    problem,
    problemLabel,
  };
});

const startState = computed(
  () => workspace.value === null && currentDocument.value === null,
);
const noFileState = computed(
  () => workspace.value !== null && currentDocument.value === null,
);

const dialogActions = computed(() => dialog.value?.actions ?? []);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showNotice(
  text: string,
  tone: Notice["tone"] = "success",
  duration = NOTICE_DURATION_MS,
) {
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  notice.value = { text, tone };
  if (duration > 0) {
    noticeTimer = setTimeout(() => {
      notice.value = null;
      noticeTimer = null;
    }, duration);
  }
}

function applyTheme() {
  const dark =
    theme.value === "system" ? systemPrefersDark.value : theme.value === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

applyTheme();

function applySettings(loaded: AppSettings) {
  theme.value =
    loaded.theme === "light" || loaded.theme === "dark"
      ? loaded.theme
      : "system";
  sidebarWidth.value = Math.min(400, Math.max(200, loaded.sidebarWidth || 252));
  recentFolders.value = [...loaded.recentFolders].slice(0, 10);
  expandedByRoot.value = { ...loaded.expandedFolders };
  applyTheme();
}

async function loadSettings() {
  const legacy = localStorage.getItem("nicole-theme");
  if (legacy !== null) {
    try {
      applySettings(await migrateLegacyTheme(legacy));
      localStorage.removeItem("nicole-theme");
      return;
    } catch {
      // Keep the legacy value for the next launch.
    }
  }
  try {
    applySettings(await getSettings());
  } catch {
    // Defaults: system theme, 252 px, no recent folders.
  }
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  systemPrefersDark.value = event.matches;
  if (theme.value === "system") {
    applyTheme();
  }
}

async function toggleTheme() {
  const next: ThemeSetting = isDark.value ? "light" : "dark";
  theme.value = next;
  applyTheme();
  try {
    await setTheme(next);
  } catch {
    // Keep the choice for this session.
  }
}

function rememberRecent(folder: string) {
  const next = [folder, ...recentFolders.value.filter((item) => item !== folder)]
    .slice(0, 10);
  recentFolders.value = next;
  missingRecent.value = missingRecent.value.filter((item) => item !== folder);
}

async function removeRecent(folder: string) {
  recentFolders.value = recentFolders.value.filter((item) => item !== folder);
  if (missingLastFolder.value === folder) {
    missingLastFolder.value = null;
  }
  try {
    await removeRecentFolder(folder);
  } catch {
    // The list stays changed for this session.
  }
}

function markMissing(folder: string) {
  if (!missingRecent.value.includes(folder)) {
    missingRecent.value = [...missingRecent.value, folder];
  }
}

function handleResize() {
  viewportWidth.value = window.innerWidth;
  if (!isWide.value) {
    overlaySidebar.value = false;
  }
}

function toggleSidebar() {
  if (!hasWorkspace.value) {
    return;
  }
  if (isWide.value) {
    sidebarOpen.value = !sidebarOpen.value;
  } else {
    overlaySidebar.value = !overlaySidebar.value;
  }
}

function closeOverlaySidebar() {
  if (!isWide.value) {
    overlaySidebar.value = false;
  }
}

function handleContentPointerDown(event: PointerEvent) {
  if (!overlaySidebar.value || isWide.value) {
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest("[data-sidebar-toggle]")
  ) {
    return;
  }
  overlaySidebar.value = false;
}

function updateSidebarWidth(width: number) {
  sidebarWidth.value = width;
}

function commitSidebarWidth(width: number) {
  sidebarWidth.value = width;
  void setSidebarWidth(width).catch(() => {});
}

function resetSidebarWidth() {
  commitSidebarWidth(252);
}

function handleExpandedChange(folders: string[]) {
  if (!workspace.value) {
    return;
  }
  const root = workspace.value.root;
  expandedByRoot.value = {
    ...expandedByRoot.value,
    [root]: [...folders],
  };
  void setExpandedFolders(root, [...folders]).catch(() => {});
}

function clearSaveTimer() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

function clearSavingDisplay() {
  if (savingDisplayTimer !== null) {
    clearTimeout(savingDisplayTimer);
    savingDisplayTimer = null;
  }
}

function markExternalState(next: "none" | "modified" | "deleted") {
  externalState.value = next;
  externalRevision += 1;
}

function currentEditForDocument(doc: MarkdownDocument): PendingEdit {
  return {
    kind: doc.kind,
    path: doc.path,
    generation:
      doc.kind === "workspace" ? workspace.value?.generation ?? 0 : 0,
    text: documentText.value,
    ending: lineEnding.value,
  };
}

function scheduleSave(text: string) {
  documentText.value = text;
  if (applyingExternal) {
    return;
  }
  const doc = currentMarkdown.value;
  if (doc === null) {
    return;
  }
  if (text === originalText.value) {
    pendingEdit = null;
    clearSaveTimer();
    if (savePhase.value !== "failed" && savePhase.value !== "saving") {
      savePhase.value = "saved";
    }
    return;
  }
  pendingEdit = currentEditForDocument(doc);
  if (mixedLineEndings.value) {
    clearSaveTimer();
    savePhase.value = "mixed";
    return;
  }
  savePhase.value = saveError.value === null ? "editing" : "failed";
  clearSaveTimer();
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePending();
  }, AUTOSAVE_DELAY_MS);
}

function savePending(force = false): Promise<boolean> {
  const next = saveQueue.then(() => savePendingNow(force));
  saveQueue = next.then(
    (saved) => saved,
    () => false,
  );
  return next;
}

async function savePendingNow(force: boolean): Promise<boolean> {
  clearSaveTimer();
  const doc = currentMarkdown.value;
  if (doc === null) {
    return true;
  }
  if (
    !force &&
    externalState.value !== "none" &&
    (pendingEdit !== null || externalState.value === "deleted")
  ) {
    return false;
  }
  for (;;) {
    let edit = pendingEdit;
    if (edit === null && force) {
      edit = currentEditForDocument(doc);
    }
    if (edit === null) {
      return true;
    }
    if (
      edit.path !== doc.path ||
      edit.kind !== doc.kind ||
      edit.generation !==
        (doc.kind === "workspace" ? workspace.value?.generation ?? 0 : 0)
    ) {
      return false;
    }
    if (mixedLineEndings.value && !force) {
      savePhase.value = "mixed";
      return false;
    }
    pendingEdit = null;
    clearSavingDisplay();
    writesInFlight += 1;
    const externalRevisionAtWrite = externalRevision;
    savingDisplayTimer = setTimeout(() => {
      savingDisplayTimer = null;
      if (writesInFlight > 0 && savePhase.value !== "failed") {
        savePhase.value = "saving";
      }
    }, SAVING_DISPLAY_DELAY_MS);
    try {
      if (edit.kind === "workspace") {
        await writeFile(
          edit.path,
          withLineEnding(edit.text, edit.ending),
          edit.generation,
        );
      } else {
        await writeSingleFile(
          edit.path,
          withLineEnding(edit.text, edit.ending),
        );
      }
    } catch (error) {
      writesInFlight = Math.max(0, writesInFlight - 1);
      clearSavingDisplay();
      if (isCurrentEdit(edit, doc)) {
        if (pendingEdit === null) {
          pendingEdit = edit;
        }
        saveError.value = errorText(error);
        savePhase.value = "failed";
      }
      return false;
    }
    writesInFlight = Math.max(0, writesInFlight - 1);
    clearSavingDisplay();
    if (!isCurrentEdit(edit, doc)) {
      return true;
    }
    originalText.value = edit.text;
    saveError.value = null;
    // A non-force save must never hide an external change that arrived while
    // the write was in flight. A forced save ("keep mine"/"resave") may clear
    // the state it started with, but not a newer external event.
    if (force && externalRevision === externalRevisionAtWrite) {
      externalState.value = "none";
    }
    if (pendingEdit === null && documentText.value !== originalText.value) {
      pendingEdit = currentEditForDocument(doc);
    }
    if (pendingEdit === null) {
      savePhase.value = "saved";
      return true;
    }
    savePhase.value = "editing";
  }
}

function isCurrentEdit(edit: PendingEdit, doc: MarkdownDocument): boolean {
  const current = currentMarkdown.value;
  return (
    current !== null &&
    current.kind === doc.kind &&
    current.path === doc.path &&
    edit.path === doc.path
  );
}

function discardCurrentEdits() {
  clearSaveTimer();
  clearSavingDisplay();
  pendingEdit = null;
  saveError.value = null;
  mixedLineEndings.value = false;
  externalState.value = "none";
  savePhase.value = "idle";
}

function documentProblemDetails(): string[] {
  const doc = currentMarkdown.value;
  if (doc === null) {
    return [];
  }
  const details: string[] = [];
  if (externalState.value === "deleted") {
    details.push(`${doc.name}：文件已在磁盘上被删除或移走`);
  } else if (externalState.value === "modified") {
    details.push(`${doc.name}：文件已在 Nicole 之外被修改`);
  }
  if (saveError.value !== null) {
    details.push(`${doc.name}：保存失败`);
  }
  if (mixedLineEndings.value) {
    details.push(`${doc.name}：换行风格混合`);
  }
  return details;
}

function askDialog(state: DialogState): Promise<string> {
  if (dialogResolve !== null) {
    resolveDialog("cancel");
  }
  dialog.value = state;
  dialogOpen = true;
  return new Promise<string>((resolve) => {
    dialogResolve = resolve;
  });
}

function resolveDialog(value: string) {
  const resolve = dialogResolve;
  dialogResolve = null;
  dialogOpen = false;
  dialog.value = null;
  resolve?.(value);
}

function cancelOpenDialog() {
  if (dialogOpen) {
    resolveDialog("cancel");
  }
}

async function prepareToLeave(): Promise<boolean> {
  const doc = currentMarkdown.value;
  if (doc === null) {
    return true;
  }
  // A mixed-ending or previously failed file with no pending text has
  // nothing to lose; the text was undone back to the loaded version.
  const saved = await savePending();
  if (saved && externalState.value !== "deleted") {
    return true;
  }
  const details = documentProblemDetails();
  const choice = await askDialog({
    title: "放弃未保存的更改？",
    message: `继续操作将关闭“${doc.name}”，未保存的内容会丢失。`,
    details,
    actions: [
      { label: "取消", value: "cancel", autofocus: true },
      {
        label: "放弃更改并继续",
        value: "discard",
        primary: true,
        danger: true,
      },
    ],
  });
  if (choice !== "discard") {
    return false;
  }
  discardCurrentEdits();
  return true;
}

function clearEditor() {
  editor?.destroy();
  editor = null;
  editorHost.value?.replaceChildren();
}

function resetDocumentState() {
  clearEditor();
  const doc = currentDocument.value;
  currentDocument.value = null;
  documentText.value = "";
  originalText.value = "";
  pendingEdit = null;
  mixedLineEndings.value = false;
  lineEnding.value = "\n";
  savePhase.value = "idle";
  saveError.value = null;
  externalState.value = "none";
  clearSaveTimer();
  clearSavingDisplay();
  if (doc?.kind === "single") {
    void releaseSingleFile(doc.path).catch(() => {});
  }
}

function mountDocument(text: string, focus = true) {
  const doc = currentMarkdown.value;
  if (doc === null) {
    clearEditor();
    return;
  }
  clearEditor();
  const host = editorHost.value;
  if (!host) {
    return;
  }
  host.replaceChildren();
  editor = createEditor({
    parent: host,
    doc: text,
    mode: mode.value,
    resolveImage: (src) =>
      doc.kind === "workspace"
        ? resolveImageUrl(src, doc.path, workspace.value?.generation ?? 0)
        : null,
    onPasteImage: (ticket) => imageInsertion.handlePaste(ticket),
    onChange: scheduleSave,
  });
  if (focus) {
    editor.focus();
  }
}

function loadMarkdownDocument(
  doc: MarkdownDocument,
  text: string,
  options: { focus?: boolean } = {},
) {
  const detected = detectLineEndings(text);
  const normalized = normalizeLineEndings(text);
  currentDocument.value = doc;
  lineEnding.value = detected.ending;
  mixedLineEndings.value = detected.mixed;
  originalText.value = normalized;
  documentText.value = normalized;
  pendingEdit = null;
  saveError.value = null;
  externalState.value = "none";
  savePhase.value = detected.mixed ? "mixed" : "saved";
  mountDocument(normalized, options.focus ?? true);
}

async function openWorkspaceFile(path: string, name?: string) {
  if (workspace.value === null) {
    return;
  }
  const current = currentDocument.value;
  if (current?.kind === "workspace" && current.path === path) {
    closeOverlaySidebar();
    editor?.focus();
    return;
  }
  if (!(await prepareToLeave())) {
    return;
  }
  let text: string;
  try {
    text = await readFile(path);
  } catch (error) {
    showNotice(`读取失败：${errorText(error)}`, "danger");
    return;
  }
  const previous = currentMarkdown.value;
  loadMarkdownDocument({
    kind: "workspace",
    path,
    name: name ?? absoluteBaseName(path),
  }, text);
  if (previous?.kind === "single") {
    void releaseSingleFile(previous.path).catch(() => {});
  }
  closeOverlaySidebar();
  void sidebar.value?.reveal(path);
}

async function openPreviewEntry(entry: {
  path: string;
  name: string;
  size: number;
}) {
  if (!(await prepareToLeave())) {
    return;
  }
  const root = workspace.value?.root ?? "";
  const parent = parentOfRelative(entry.path);
  const folder =
    parent === "."
      ? displayPath(root, homeDir.value)
      : displayPath(`${root}/${parent}`, homeDir.value);
  const previous = currentDocument.value;
  currentDocument.value = {
    kind: "preview",
    path: entry.path,
    name: entry.name,
    size: entry.size,
    folder,
  };
  documentText.value = "";
  originalText.value = "";
  pendingEdit = null;
  savePhase.value = "idle";
  saveError.value = null;
  externalState.value = "none";
  mixedLineEndings.value = false;
  clearSaveTimer();
  clearSavingDisplay();
  clearEditor();
  if (previous?.kind === "single") {
    void releaseSingleFile(previous.path).catch(() => {});
  }
  closeOverlaySidebar();
}

function parentOfRelative(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

async function openTreeEntry(entry: TreeNode) {
  if (entry.isDir) {
    return;
  }
  if (entry.isMarkdown) {
    await openWorkspaceFile(entry.path, entry.name);
  } else {
    await openPreviewEntry(entry);
  }
}

function applyWorkspace(folder: { root: string; generation: number }) {
  workspace.value = { root: folder.root, generation: folder.generation };
  missingLastFolder.value = null;
  rememberRecent(folder.root);
  const doc = currentDocument.value;
  if (doc === null || doc.kind === "workspace" || doc.kind === "preview") {
    resetDocumentState();
  }
  startWatch(folder.generation);
}

async function switchToFolder(path: string): Promise<boolean> {
  if (workspace.value?.root === path) {
    closeOverlaySidebar();
    return true;
  }
  const doc = currentDocument.value;
  const targetName = absoluteBaseName(path);
  let discard = false;

  if (doc?.kind === "workspace") {
    const saved = await savePending();
    const problems = documentProblemDetails();
    if (!saved) {
      problems.push("当前文件有未保存的更改");
    }
    if (problems.length === 0) {
      const choice = await askDialog({
        title: `切换到“${targetName}”`,
        message: "当前标签页会关闭。切回时需要重新打开文件。",
        actions: [
          { label: "取消", value: "cancel", autofocus: true },
          { label: "切换", value: "switch", primary: true },
        ],
      });
      if (choice !== "switch") {
        return false;
      }
    } else {
      const choice = await askDialog({
        title: `切换到“${targetName}”`,
        message: "当前标签页会关闭，未保存的内容会丢失。",
        details: problems,
        actions: [
          { label: "取消", value: "cancel", autofocus: true },
          {
            label: "放弃更改并切换",
            value: "switch",
            primary: true,
            danger: true,
          },
        ],
      });
      if (choice !== "switch") {
        return false;
      }
      discard = true;
    }
  }

  let folder;
  try {
    folder = await openFolderAtPath(path);
  } catch (error) {
    showNotice(`打开失败：${errorText(error)}`, "danger");
    return false;
  }
  if (discard) {
    discardCurrentEdits();
  }
  applyWorkspace(folder);
  return true;
}

async function startFolderOperation(
  operation: () => Promise<boolean>,
): Promise<boolean> {
  if (folderOperation !== null) {
    return folderOperation;
  }
  folderOperation = operation().finally(() => {
    folderOperation = null;
  });
  return folderOperation;
}

async function chooseFolder() {
  await startFolderOperation(async () => {
    let picked;
    try {
      picked = await pickFolder();
    } catch (error) {
      showNotice(`打开失败：${errorText(error)}`, "danger");
      return false;
    }
    if (picked.canceled) {
      return false;
    }
    return switchToFolder(picked.path);
  });
}

async function openRecentFolder(path: string) {
  await startFolderOperation(() => switchToFolder(path));
}

async function restoreLastWorkspace() {
  const last = recentFolders.value[0];
  if (!last) {
    return;
  }
  try {
    const folder = await openFolderAtPath(last);
    applyWorkspace(folder);
    // Opening the last folder should not move it again; it is already first.
    recentFolders.value = [
      folder.root,
      ...recentFolders.value.filter((item) => item !== folder.root),
    ].slice(0, 10);
  } catch {
    missingLastFolder.value = last;
    markMissing(last);
  }
}

function startWatch(generation: number) {
  stopWatch();
  watcher = watchWorkspace(generation, (events) => {
    void handleWatchEvents(events);
  });
  watcher.ready.catch(() => {
    // A watch that cannot start is not fatal for the editor.
  });
  watcher.closed.catch(() => {});
}

function stopWatch() {
  watcher?.close();
  watcher = null;
}

async function handleWatchEvents(allEvents: readonly WorkspaceFileEvent[]) {
  if (workspace.value === null) {
    return;
  }
  const now = Date.now();
  const events = allEvents.filter((event) => {
    if (
      event.op === "rename" &&
      recentSelfRename !== null &&
      event.oldPath === recentSelfRename.oldPath &&
      event.path === recentSelfRename.newPath &&
      now - recentSelfRename.at < 3000
    ) {
      recentSelfRename = null;
      return false;
    }
    return true;
  });
  if (events.length === 0) {
    return;
  }
  await sidebar.value?.refreshFromEvents(events);
  const doc = currentDocument.value;
  if (doc?.kind !== "workspace") {
    return;
  }
  const classification = classifyWatchEvents(events, doc.path, true);
  if (classification.document === "deleted") {
    markExternalState("deleted");
    clearSaveTimer();
    return;
  }
  if (classification.document === "modified") {
    if (externalState.value === "deleted") {
      markExternalState("none");
    }
    await handleExternalModification();
  }
}

async function handleExternalModification() {
  const doc = currentMarkdown.value;
  if (doc?.kind !== "workspace") {
    return;
  }
  if (externalState.value === "deleted" || externalState.value === "modified") {
    return;
  }
  if (
    pendingEdit !== null ||
    saveError.value !== null ||
    documentText.value !== originalText.value
  ) {
    markExternalState("modified");
    clearSaveTimer();
    return;
  }
  const sequence = ++externalReadSequence;
  try {
    const text = await readFile(doc.path);
    if (
      sequence !== externalReadSequence ||
      currentDocument.value?.kind !== "workspace" ||
      currentDocument.value.path !== doc.path ||
      externalState.value !== "none"
    ) {
      return;
    }
    if (pendingEdit !== null || documentText.value !== originalText.value) {
      markExternalState("modified");
      clearSaveTimer();
      return;
    }
    applyExternalText(text);
  } catch {
    if (
      sequence === externalReadSequence &&
      currentDocument.value?.kind === "workspace" &&
      currentDocument.value.path === doc.path
    ) {
      markExternalState("deleted");
      clearSaveTimer();
    }
  }
}

function applyExternalText(text: string) {
  const detected = detectLineEndings(text);
  const normalized = normalizeLineEndings(text);
  applyingExternal = true;
  lineEnding.value = detected.ending;
  mixedLineEndings.value = detected.mixed;
  originalText.value = normalized;
  documentText.value = normalized;
  pendingEdit = null;
  saveError.value = null;
  externalState.value = "none";
  savePhase.value = detected.mixed ? "mixed" : "saved";
  editor?.replaceDocument(normalized);
  applyingExternal = false;
  showNotice("已载入磁盘上的新内容", "success", NOTICE_DURATION_MS);
}

async function loadDiskVersion() {
  const doc = currentMarkdown.value;
  if (doc?.kind !== "workspace") {
    return;
  }
  try {
    const text = await readFile(doc.path);
    applyExternalText(text);
  } catch (error) {
    showNotice(`读取失败：${errorText(error)}`, "danger");
  }
}

function keepMyVersion() {
  externalState.value = "none";
  void savePending(true);
}

async function resaveDeleted() {
  const saved = await savePending(true);
  if (saved) {
    saveError.value = null;
    savePhase.value = "saved";
  }
}

async function handleBannerAction(
  action: "retry" | "load-disk" | "keep-mine" | "resave" | "close-tab",
) {
  switch (action) {
    case "retry":
      await savePending(true);
      break;
    case "load-disk":
      await loadDiskVersion();
      break;
    case "keep-mine":
      keepMyVersion();
      break;
    case "resave":
      await resaveDeleted();
      break;
    case "close-tab":
      await closeCurrentTab();
      break;
  }
}

async function closeCurrentTab() {
  const doc = currentDocument.value;
  if (doc === null) {
    return;
  }
  if (doc.kind !== "preview") {
    const problems = documentProblemDetails();
    const mustConfirm =
      externalState.value === "deleted" ||
      mixedLineEndings.value ||
      saveError.value !== null ||
      pendingEdit !== null;
    if (mustConfirm) {
      if (pendingEdit !== null && saveError.value === null) {
        await savePending();
      }
      const stillMustConfirm =
        externalState.value === "deleted" ||
        mixedLineEndings.value ||
        saveError.value !== null ||
        pendingEdit !== null;
      if (stillMustConfirm) {
        const choice = await askDialog({
          title: `关闭“${doc.name}”？`,
          message: "关闭后，这个标签页中未保存的内容会丢失。",
          details: documentProblemDetails(),
          actions: [
            { label: "取消", value: "cancel", autofocus: true },
            {
              label: "放弃更改并关闭",
              value: "close",
              primary: true,
              danger: true,
            },
          ],
        });
        if (choice !== "close") {
          return;
        }
      }
    }
  }
  resetDocumentState();
}

async function openSingleFile(path: string, name: string) {
  const current = currentMarkdown.value;
  if (current?.kind === "single" && current.path === path) {
    editor?.focus();
    return;
  }
  if (!(await prepareToLeave())) {
    return;
  }
  let file;
  try {
    file = await acceptSingleFile(path);
  } catch (error) {
    showNotice(`无法打开文件：${errorText(error)}`, "danger");
    return;
  }
  let text: string;
  try {
    text = await readSingleFile(file.path);
  } catch (error) {
    showNotice(`读取失败：${errorText(error)}`, "danger");
    return;
  }
  const previous = currentMarkdown.value;
  loadMarkdownDocument(
    { kind: "single", path: file.path, name: file.name },
    text,
  );
  if (previous?.kind === "single") {
    void releaseSingleFile(previous.path).catch(() => {});
  }
}

async function openPreviewDefault() {
  const doc = currentPreview.value;
  if (!doc || !workspace.value) {
    return;
  }
  try {
    await openWithDefaultApp(doc.path, workspace.value.generation);
  } catch (error) {
    showNotice(`打开失败：${errorText(error)}`, "danger");
  }
}

async function revealPreview() {
  const doc = currentPreview.value;
  if (!doc || !workspace.value) {
    return;
  }
  try {
    await revealEntry(doc.path, workspace.value.generation);
  } catch (error) {
    showNotice(`无法显示：${errorText(error)}`, "danger");
  }
}

function canOpenParentFolder(parent: string): boolean {
  if (parent === "" || parent === "/") {
    return false;
  }
  if (/^[a-zA-Z]:[\\/]?$/.test(parent)) {
    return false;
  }
  if (homeDir.value !== "" && parent === homeDir.value) {
    return false;
  }
  return true;
}

async function askOpenSingleFile(path: string) {
  const parent = absoluteParent(path);
  const name = absoluteBaseName(path);
  const canOpenFolder = canOpenParentFolder(parent);
  const choice = await askDialog({
    title: "这个文件不在已打开的文件夹中",
    message: "选择只打开这个文件，或把它所在的文件夹作为工作区打开。",
    details: [path],
    actions: [
      {
        label: "只打开这个文件",
        value: "single",
        autofocus: true,
      },
      {
        label: "打开所在文件夹",
        value: "folder",
        disabled: !canOpenFolder,
      },
      { label: "取消", value: "cancel" },
    ],
  });
  if (choice === "single") {
    await openSingleFile(path, name);
    return;
  }
  if (choice === "folder" && canOpenFolder) {
    const opened = await startFolderOperation(() => switchToFolder(parent));
    if (!opened) {
      return;
    }
    await openPathInWorkspace(path);
  }
}

async function openPathInWorkspace(path: string) {
  const root = workspace.value?.root;
  if (!root || !isInFolder(root, path)) {
    await askOpenSingleFile(path);
    return;
  }
  const rel = relativePath(root, path);
  if (/\.md$/i.test(path)) {
    await openWorkspaceFile(rel, absoluteBaseName(path));
    return;
  }
  let size = 0;
  try {
    const listing = await listDirectory(parentOfRelative(rel));
    size = listing.entries.find((entry) => entry.path === rel)?.size ?? 0;
  } catch {
    // A stale file still opens as an empty preview.
  }
  await openPreviewEntry({ path: rel, name: absoluteBaseName(path), size });
}

async function handleOpenedPath(path: string) {
  const root = workspace.value?.root;
  if (root && isInFolder(root, path)) {
    await openPathInWorkspace(path);
    return;
  }
  const parent = absoluteParent(path);
  if (recentFolders.value.includes(parent) && parent !== root) {
    const opened = await startFolderOperation(() => switchToFolder(parent));
    if (opened) {
      await openPathInWorkspace(path);
    }
    return;
  }
  await askOpenSingleFile(path);
}

async function receiveOpenedFiles() {
  openedFilesQueue = openedFilesQueue
    .then(async () => {
      const paths = await takePendingOpenedFiles();
      const last = paths.at(-1);
      if (last) {
        try {
          await handleOpenedPath(last);
        } finally {
          // The offer is one-time: opening the parent consumes it in Go,
          // AcceptSingleFile consumes it for a single file, and cancelling
          // or failing to open must not leave the directory grant behind.
          await dismissOfferedFile(last).catch(() => {});
        }
      }
    })
    .catch(() => {
      // The backend may be absent when only Vite runs.
    });
  await openedFilesQueue;
}

function handleEditCommand(event: Event) {
  const command = (event as CustomEvent<unknown>).detail;
  if (command !== "undo" && command !== "redo") {
    return;
  }
  const target = editor;
  if (target?.view.compositionStarted) {
    return;
  }
  const editorFocused =
    target !== null &&
    (target.view.hasFocus || target.view.dom.contains(document.activeElement));
  if (!editorFocused) {
    document.execCommand(command);
    return;
  }
  if (command === "undo") {
    target.undo();
  } else {
    target.redo();
  }
}

function setMode(next: EditorMode) {
  mode.value = next;
  editor?.setMode(next);
  editor?.focus();
}

function activateTab() {
  closeOverlaySidebar();
  editor?.focus();
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (dialogOpen) {
    return;
  }
  if (event.key === "Escape") {
    if (dialogOpen) {
      return;
    }
    if (overlaySidebar.value) {
      event.preventDefault();
      overlaySidebar.value = false;
    }
    return;
  }
  if (event.defaultPrevented || isTextInput(event.target)) {
    return;
  }
  const key = event.key.toLowerCase();
  const macCombo = mac.value && event.ctrlKey && event.metaKey;
  const otherCombo = !mac.value && event.ctrlKey && event.shiftKey;
  if (macCombo || otherCombo) {
    if (key === "s" && macCombo) {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (key === "e" && otherCombo) {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (key === "1") {
      event.preventDefault();
      setMode("live");
    } else if (key === "2") {
      event.preventDefault();
      setMode("immersive");
    } else if (key === "3") {
      event.preventDefault();
      setMode("source");
    }
    return;
  }
  const modifier = mac.value ? event.metaKey : event.ctrlKey;
  if (modifier && !event.shiftKey && key === "o") {
    event.preventDefault();
    void chooseFolder();
    return;
  }
  if (modifier && !event.shiftKey && key === "n") {
    event.preventDefault();
    void newFile();
    return;
  }
  if (modifier && !event.shiftKey && key === "s") {
    event.preventDefault();
    void savePending();
    return;
  }
  if (modifier && !event.shiftKey && key === "w") {
    event.preventDefault();
    void closeCurrentTab();
    return;
  }
}

async function newFile() {
  if (!workspace.value) {
    return;
  }
  if (!sidebarShown.value) {
    if (isWide.value) {
      sidebarOpen.value = true;
    } else {
      overlaySidebar.value = true;
    }
  }
  await nextTick();
  const dir =
    currentMarkdown.value?.kind === "workspace"
      ? parentOfRelative(currentMarkdown.value.path)
      : ".";
  await sidebar.value?.startCreate("create-file", dir);
}

function handleEntryRenaming(
  oldPath: string,
  newPath: string,
  _isDir: boolean,
) {
  // Register before RenameEntry returns: the watcher may report the rename
  // while the backend call is still in flight.
  recentSelfRename = { oldPath, newPath, at: Date.now() };
}

function handleEntryRenameFailed(oldPath: string) {
  if (recentSelfRename?.oldPath === oldPath) {
    recentSelfRename = null;
  }
}

async function renameCurrentPath(
  oldPath: string,
  newPath: string,
  isDir: boolean,
) {
  const doc = currentDocument.value;
  if (doc?.kind === "workspace") {
    let updated: string | null = null;
    if (!isDir && doc.path === oldPath) {
      updated = newPath;
    } else if (isDir && (doc.path === oldPath || doc.path.startsWith(`${oldPath}/`))) {
      updated = `${newPath}${doc.path.slice(oldPath.length)}`;
    }
    if (updated !== null) {
      currentDocument.value = {
        kind: "workspace",
        path: updated,
        name: absoluteBaseName(updated),
      };
    }
  }
  if (doc?.kind === "preview") {
    let updated: string | null = null;
    if (!isDir && doc.path === oldPath) {
      updated = newPath;
    } else if (isDir && (doc.path === oldPath || doc.path.startsWith(`${oldPath}/`))) {
      updated = `${newPath}${doc.path.slice(oldPath.length)}`;
    }
    if (updated !== null) {
      const root = workspace.value?.root ?? "";
      const parent = parentOfRelative(updated);
      currentDocument.value = {
        ...doc,
        path: updated,
        name: absoluteBaseName(updated),
        folder:
          parent === "."
            ? displayPath(root, homeDir.value)
            : displayPath(`${root}/${parent}`, homeDir.value),
      };
    }
  }
  if (pendingEdit !== null && pendingEdit.kind === "workspace") {
    if (!isDir && pendingEdit.path === oldPath) {
      pendingEdit.path = newPath;
    } else if (isDir && (pendingEdit.path === oldPath || pendingEdit.path.startsWith(`${oldPath}/`))) {
      pendingEdit.path = `${newPath}${pendingEdit.path.slice(oldPath.length)}`;
    }
  }
}

async function requestTrash(entry: TreeNode) {
  if (!workspace.value) {
    return;
  }
  const generation = workspace.value.generation;
  if (entry.isDir) {
    let count: number | null = null;
    try {
      count = await countFiles(entry.path);
    } catch {
      count = null;
    }
    const choice = await askDialog({
      title: "移到废纸篓？",
      message:
        count === null
          ? `文件夹“${entry.name}”及其中的内容会被移到废纸篓。`
          : `文件夹“${entry.name}”及其中的 ${count} 个文件会被移到废纸篓。`,
      actions: [
        { label: "取消", value: "cancel", autofocus: true },
        {
          label: trashLabel(platform.value),
          value: "trash",
          primary: true,
          danger: true,
        },
      ],
    });
    if (choice !== "trash") {
      return;
    }
  }
  try {
    await trashEntry(entry.path, generation);
  } catch (error) {
    showNotice(`移到废纸篓失败：${errorText(error)}`, "danger");
    return;
  }
  const doc = currentDocument.value;
  const removed =
    doc !== null &&
    (doc.kind === "workspace" || doc.kind === "preview") &&
    (doc.path === entry.path ||
      (entry.isDir && doc.path.startsWith(`${entry.path}/`)));
  sidebar.value?.removePath(entry.path);
  if (removed) {
    resetDocumentState();
  }
}

async function countFiles(path: string): Promise<number> {
  let count = 0;
  const listing = await listDirectory(path);
  for (const entry of listing.entries) {
    if (entry.isDir) {
      count += await countFiles(entry.path);
    } else {
      count += 1;
    }
  }
  return count;
}

async function handleEntryCreated(path: string, isDir: boolean) {
  if (isDir) {
    return;
  }
  await openWorkspaceFile(path, absoluteBaseName(path));
}

async function handleEntryRenamed(
  oldPath: string,
  newPath: string,
  isDir: boolean,
) {
  if (recentSelfRename?.oldPath === oldPath) {
    recentSelfRename.newPath = newPath;
    recentSelfRename.at = Date.now();
  }
  await renameCurrentPath(oldPath, newPath, isDir);
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    void savePending();
  }
}

function saveBeforeExit() {
  void savePending();
}

function handleWindowResize() {
  handleResize();
}

onMounted(async () => {
  window.addEventListener("beforeunload", saveBeforeExit);
  window.addEventListener("pagehide", saveBeforeExit);
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  systemTheme.addEventListener("change", handleSystemThemeChange);
  window.addEventListener("nicole:edit-command", handleEditCommand);
  offOpenFile = onOpenFile(() => {
    if (!appReady) {
      pendingOpenSignal = true;
      return;
    }
    void receiveOpenedFiles();
  });
  offFileDrop = onWindowFileDrop((drop) => {
    imageInsertion.handleDrop(drop);
  });
  offSaveBeforeClose = onSaveBeforeClose(async (token) => {
    cancelOpenDialog();
    await nextTick();
    const saved = await savePending();
    try {
      await finishClose(token, saved);
    } catch {
      // The window may already be gone.
    }
  });

  void (async () => {
    try {
      appInfo.value = await getAppInfo();
    } catch {
      appInfo.value = null;
    }
    await loadSettings();
    await restoreLastWorkspace();
    appReady = true;
    if (pendingOpenSignal) {
      pendingOpenSignal = false;
    }
    await receiveOpenedFiles();
  })();

});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", saveBeforeExit);
  window.removeEventListener("pagehide", saveBeforeExit);
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  systemTheme.removeEventListener("change", handleSystemThemeChange);
  window.removeEventListener("nicole:edit-command", handleEditCommand);
  offOpenFile?.();
  offOpenFile = null;
  offFileDrop?.();
  offFileDrop = null;
  offSaveBeforeClose?.();
  offSaveBeforeClose = null;
  stopWatch();
  clearSaveTimer();
  clearSavingDisplay();
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  void savePending();
  clearEditor();
});

defineExpose({
  chooseFolder,
  openWorkspaceFile,
  handleWatchEvents,
});
</script>

<template>
  <div
    class="relative flex h-full min-h-0 overflow-hidden bg-[var(--surface-canvas)] text-[var(--text-primary)]"
    :style="{ '--sidebar-width': `${sidebarWidth}px` }"
  >
    <AppSidebar
      v-if="sidebarShown && workspace"
      ref="sidebar"
      :width="sidebarWidth"
      :mode="isWide ? 'pinned' : 'overlay'"
      :platform="platform"
      :root-name="rootName"
      :root-path="workspace.root"
      :root-display-path="rootDisplayPath"
      :generation="workspace.generation"
      :selected-path="selectedTreePath"
      :initial-expanded="expandedForRoot"
      @hide-sidebar="toggleSidebar"
      @open-folder="chooseFolder"
      @width-change="updateSidebarWidth"
      @width-commit="commitSidebarWidth"
      @reset-width="resetSidebarWidth"
      @open-entry="openTreeEntry"
      @entry-created="handleEntryCreated"
      @entry-renaming="handleEntryRenaming"
      @entry-rename-failed="handleEntryRenameFailed"
      @entry-renamed="handleEntryRenamed"
      @trash-request="requestTrash"
      @expanded-change="handleExpandedChange"
      @status="(message) => showNotice(message, 'danger')"
    />

    <div
      class="flex min-w-0 flex-1 flex-col"
      @pointerdown.capture="handleContentPointerDown"
    >
      <TopBar
        :tab="tab"
        :mode="mode"
        :platform="platform"
        :compact="isCompactTopBar"
        :sidebar-shown="sidebarShown"
        :show-sidebar-toggle="showSidebarToggle"
        :show-open-folder="!hasWorkspace && currentDocument !== null"
        :outline-enabled="false"
        :outline-on="false"
        @close-tab="closeCurrentTab"
        @activate-tab="activateTab"
        @set-mode="setMode"
        @toggle-sidebar="toggleSidebar"
        @open-folder="chooseFolder"
      />

      <div class="flex min-h-0 flex-1">
        <main class="flex min-w-0 flex-1 flex-col">
          <AppBanner
            v-if="banner"
            :banner="banner"
            @action="handleBannerAction"
          />
          <div class="relative min-h-0 flex-1">
            <EmptyState
              v-if="startState"
              mode="start"
              :recent-folders="recentFolders"
              :missing-folders="missingRecent"
              :missing-last-folder="missingLastFolder"
              :home-dir="homeDir"
              :platform="platform"
              @open-folder="chooseFolder"
              @open-recent="openRecentFolder"
              @remove-recent="removeRecent"
              @new-file="newFile"
            />
            <EmptyState
              v-else-if="noFileState"
              mode="no-file"
              :recent-folders="recentFolders"
              :missing-folders="missingRecent"
              :missing-last-folder="missingLastFolder"
              :home-dir="homeDir"
              :platform="platform"
              @open-folder="chooseFolder"
              @new-file="newFile"
            />
            <NonMarkdownPlaceholder
              v-else-if="currentPreview"
              :name="currentPreview.name"
              :size="currentPreview.size"
              :folder="currentPreview.folder"
              :platform="platform"
              @open-default="openPreviewDefault"
              @reveal="revealPreview"
            />
            <div
              ref="editorHost"
              v-show="isMarkdownOpen"
              class="h-full"
              aria-label="Markdown 编辑器"
            ></div>
          </div>
        </main>
      </div>

      <StatusBar
        :save-status="saveStatus"
        :notice="notice?.text ?? null"
        :notice-tone="notice?.tone"
        :is-dark="isDark"
        @toggle-theme="toggleTheme"
      />
    </div>

    <AppDialog
      :open="dialog !== null"
      :title="dialog?.title ?? ''"
      @cancel="resolveDialog('cancel')"
    >
      <p v-if="dialog?.message" class="m-0">{{ dialog.message }}</p>
      <ul
        v-if="dialog?.details?.length"
        class="mt-2 mb-0 list-disc pl-5 text-[12px]"
      >
        <li v-for="detail in dialog.details" :key="detail">{{ detail }}</li>
      </ul>
      <template #actions>
        <button
          v-for="action in dialogActions"
          :key="action.value"
          type="button"
          :data-autofocus="action.autofocus ? '' : undefined"
          :disabled="action.disabled"
          class="focus-ring rounded-[var(--radius-control)] border px-3 py-1.5 text-[12px] disabled:cursor-default disabled:opacity-50"
          :class="
            action.primary
              ? action.danger
                ? 'border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]'
                : 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)]'
              : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]'
          "
          @click="resolveDialog(action.value)"
        >
          {{ action.label }}
        </button>
      </template>
    </AppDialog>
  </div>
</template>
