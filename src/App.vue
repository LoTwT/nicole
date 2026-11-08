<script setup lang="ts">
import { EditorSelection, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  computed,
  markRaw,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from "vue";

import {
  normalizeRecentFiles,
  rememberRecentFilePath,
  type CommandPaletteMode,
} from "./app/command-palette";
import { buildContextMenu } from "./app/context-menu";
import {
  absoluteBaseName,
  absoluteParent,
  displayPath,
  isInFolder,
  relativePath,
} from "./app/paths";
import { trashLabel, type AppPlatform } from "./app/platform";
import { matchCommand } from "./commands/keybinding";
import {
  commandRegistry,
  getCommand,
  isCommandAvailable,
} from "./commands/registry";
import {
  readRecentCommandIds,
  rememberRecentCommandId,
} from "./commands/search";
import type { CommandContext, CommandDefinition } from "./commands/types";
import {
  createRecoveryTimers,
  formatRecoveryTime,
  type RecoveryDialogItem,
} from "./app/recovery";
import { describeWordDifference } from "./app/word-count";
import {
  detectLineEndings,
  normalizeLineEndings,
  withLineEnding,
  type LineEnding,
} from "./app/line-endings";
import {
  saveFailureMessage,
  saveStatusPresentation,
  selectBanner,
  type SavePhase,
} from "./app/status";
import {
  distinguishingSuffixes,
  insertionIndex,
  isDirty,
  mapSnapshotForReplacement,
  tabBadge,
  tabCloseProblems,
  tabTooltip,
  type TabModel,
} from "./app/tabs";
import { classifyWatchEvents } from "./app/watch-events";
import type { TreeNode } from "./app/file-tree";
import AppBanner from "./components/AppBanner.vue";
import AppDialog from "./components/AppDialog.vue";
import RecoveryDialog from "./components/RecoveryDialog.vue";
import AppSidebar from "./components/AppSidebar.vue";
import CommandPalette from "./components/CommandPalette.vue";
import EmptyState from "./components/EmptyState.vue";
import NonMarkdownPlaceholder from "./components/NonMarkdownPlaceholder.vue";
import SlashMenu from "./components/SlashMenu.vue";
import StatusBar from "./components/StatusBar.vue";
import TopBar, { type TopBarTab } from "./components/TopBar.vue";
import {
  createEditor,
  type EditorHandle,
  type EditorMode,
  type EditorRestoreState,
  type SavedSelection,
} from "./editor";
import {
  extractHeadingsWithStatus,
  type DocumentHeading,
  type HeadingExtraction,
} from "./editor/headings";
import {
  createSlashMenu,
  type SlashMenuController,
  type SlashMenuSnapshot,
} from "./editor/slash";
import { createImageInsertion } from "./image-insertion";
import { resolveImageUrl } from "./image-url";
import { getAppInfo, type AppInfo } from "./services/app";
import { onWindowFileDrop, type AssetDrop } from "./services/assets";
import { copyText } from "./services/clipboard";
import {
  listDirectory,
  openWithDefaultApp,
  revealEntry,
  trashEntry,
} from "./services/files";
import { popupNativeMenu } from "./services/menu";
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
  revealSingleFile,
  writeSingleFile,
} from "./services/single-file";
import {
  deleteRecovery,
  discardRecovery,
  listRecovery,
  restoreRecoverySingleFile,
  saveRecovery,
  type RecoveryCopy,
  type RecoveryItem,
} from "./services/recovery";
import {
  getWorkspaceTabs,
  saveWorkspaceTabs as saveTabsForRoot,
  type StoredTab,
} from "./services/tabs";
import type { WorkspaceFileEvent } from "./services/mygo";
import {
  closeWorkspace as closeWorkspaceInGo,
  finishClose,
  listFiles,
  onSaveBeforeClose,
  openDroppedFolder as openDroppedFolderInGo,
  openFolder as openFolderAtPath,
  pickFolder,
  readFile,
  writeFile,
} from "./services/workspace";
import { watchWorkspace, type WorkspaceWatcher } from "./services/watch";

const AUTOSAVE_DELAY_MS = 1000;
const SAVING_DISPLAY_DELAY_MS = 300;
const NOTICE_DURATION_MS = 3000;
const NOTICE_DETAIL_DURATION_MS = 8000;
const PERSIST_TABS_DELAY_MS = 400;
// Keep close/switch inside the same five-second budget as the window-close path.
const RECOVERY_OPERATION_TIMEOUT_MS = 5000;
const MISSING_FOLDER_ERROR = "workspace: folder does not exist";

interface WorkspaceState {
  root: string;
  generation: number;
}

interface Notice {
  text: string;
  tone: "success" | "danger" | "muted";
  /** Raw backend error; shown as a tooltip, not as the notice text. */
  detail?: string;
  /** Lets a later successful action dismiss only its own failure notice. */
  kind?: "folder-open-failure";
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

interface ClosedTab {
  kind: "markdown" | "preview";
  path: string;
  name: string;
}

interface PaletteSession {
  mode: CommandPaletteMode;
  tabId: number | null;
  doc: Text | null;
  selection: SavedSelection | null;
  headings: DocumentHeading[];
  headingsLoaded: boolean;
  headingsTruncated: boolean;
  recentFiles: string[];
  recentCommandIds: string[];
}

interface RecoveryDialogState {
  items: RecoveryDialogItem[];
  raw: RecoveryItem[];
  otherFolders: number;
}

interface RecoveryWriteState {
  written: string | null;
  writtenBaselineUnconfirmed: boolean | null;
  writing: boolean;
  queued: boolean;
}

const editorHost = ref<HTMLElement | null>(null);
const sidebar = ref<InstanceType<typeof AppSidebar> | null>(null);
const emptyState = ref<InstanceType<typeof EmptyState> | null>(null);
const topBar = ref<InstanceType<typeof TopBar> | null>(null);
const palette = ref<InstanceType<typeof CommandPalette> | null>(null);
const appInfo = ref<AppInfo | null>(null);
const workspace = ref<WorkspaceState | null>(null);
const tabs = ref<TabModel[]>([]);
const activeTabId = ref<number | null>(null);
const closedTabs = ref<ClosedTab[]>([]);
const notice = ref<Notice | null>(null);
const mode = ref<EditorMode>("live");

const theme = ref<ThemeSetting>("system");
const sidebarWidth = ref(252);
const recentFolders = ref<string[]>([]);
const missingRecent = ref<string[]>([]);
const missingLastFolder = ref<string | null>(null);
const workspaceClosed = ref(false);
const dropActive = ref(false);
let dragDepth = 0;
const expandedByRoot = ref<Record<string, string[]>>({});
const recentFilesByRoot = ref<Record<string, string[]>>({});
const paletteSession = shallowRef<PaletteSession | null>(null);

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const systemPrefersDark = ref(systemTheme.matches);

const viewportWidth = ref(window.innerWidth);
const isWide = computed(() => viewportWidth.value >= 960);
const isCompactTopBar = computed(() => viewportWidth.value < 760);
const sidebarOpen = ref(true);
const overlaySidebar = ref(false);

const dialog = ref<DialogState | null>(null);
const recoveryDialog = ref<RecoveryDialogState | null>(null);
let dialogResolve: ((value: string) => void) | null = null;
let dialogOpen = false;
let folderOperation: Promise<boolean> | null = null;
let recoveryChecking = false;

let editor: EditorHandle | null = null;
let mountSequence = 0;
let nextTabId = 1;
let lastWorkspaceActivePath: string | null = null;
let slashMenu: SlashMenuController | null = null;
const slashState = shallowRef<SlashMenuSnapshot>(null);
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);
let applyingExternal = false;
let restoringTabs = false;
// Two entry points can request the same file before either read finishes.
const openingTabs = new Map<string, Promise<boolean>>();
let recentSelfRename:
  | { oldPath: string; newPath: string; at: number }
  | null = null;
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
// Tabs whose composition flag CodeMirror never cleared; a real key press
// proves the IME is gone, until the next composition starts.
const invalidatedCompositions = new Set<number>();
const savingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const writesInFlight = new Map<number, number>();
const externalReadSequence = new Map<number, number>();
const recoveryWrites = new Map<number, RecoveryWriteState>();
const recoveryEpoch = new Map<number, number>();
const pendingRecoveryOperations = new Set<Promise<unknown>>();
const recoveryTicker = createRecoveryTimers((id) => onRecoveryDue(id));
let recoveryClosed: Promise<void> | null = null;
let resolveRecoveryClosed: (() => void) | null = null;
let recoveryApplying = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

let watcher: WorkspaceWatcher | null = null;
let offSaveBeforeClose: (() => void) | null = null;
let offOpenFile: (() => void) | null = null;
let offFileDrop: (() => void) | null = null;
let openedFilesQueue: Promise<void> = Promise.resolve();
let appReady = false;
let pendingOpenSignal = false;

const imageInsertion = createImageInsertion({
  getEditor: () => editor,
  getFile: () => {
    const tab = currentMarkdown.value;
    return tab?.kind === "workspace" ? tab.path : null;
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

const isDark = computed(() =>
  theme.value === "system" ? systemPrefersDark.value : theme.value === "dark",
);

const hasWorkspace = computed(() => workspace.value !== null);
const currentTab = computed<TabModel | null>(
  () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
);
const currentMarkdown = computed<TabModel | null>(() => {
  const tab = currentTab.value;
  return tab !== null && tab.kind !== "preview" ? tab : null;
});
const currentPreview = computed<TabModel | null>(() => {
  const tab = currentTab.value;
  return tab?.kind === "preview" ? tab : null;
});
const isMarkdownOpen = computed(() => currentMarkdown.value !== null);

/** Whether the current page state satisfies a command's runtime requirements. */
function commandContextAllows(command: CommandDefinition): boolean {
  return (
    (!command.requiresWorkspace || hasWorkspace.value) &&
    (!command.requiresOpenTab || tabs.value.length > 0)
  );
}

const paletteCommands = computed(() =>
  commandRegistry.filter(
    (command) =>
      isCommandAvailable(command) &&
      commandContextAllows(command) &&
      (command.scope === "app" ||
        (command.scope === "editor" && isMarkdownOpen.value && editor !== null)),
  ),
);

const sidebarShown = computed(
  () =>
    hasWorkspace.value &&
    (isWide.value ? sidebarOpen.value : overlaySidebar.value),
);
const showSidebarToggle = computed(
  () => hasWorkspace.value && !sidebarShown.value,
);
const selectedTreePath = computed(() => {
  const tab = currentTab.value;
  return tab?.kind === "workspace" || tab?.kind === "preview"
    ? tab.path
    : null;
});

const rootName = computed(() =>
  workspace.value ? absoluteBaseName(workspace.value.root) : "",
);
const expandedForRoot = computed(() => {
  if (!workspace.value) return [];
  return expandedByRoot.value[workspace.value.root] ?? [];
});

const saveStatus = computed(() => {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return null;
  }
  return saveStatusPresentation(tab.savePhase, tab.mixedLineEndings);
});

const banner = computed(() => {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return null;
  }
  return selectBanner({
    deleted: tab.externalState === "deleted",
    externallyModified: tab.externalState === "modified",
    saveError: tab.saveError,
    saveErrorDetail: tab.saveErrorDetail,
    mixedLineEndings: tab.mixedLineEndings,
    singleFile: tab.kind === "single",
    restored: tab.restored,
  });
});

const topBarTabs = computed<TopBarTab[]>(() => {
  const suffixes = distinguishingSuffixes(tabs.value, rootName.value);
  return tabs.value.map((tab) => {
    const badge = tabBadge(tab);
    return {
      id: tab.id,
      name: tab.name,
      suffix: suffixes.get(tab.id) ?? null,
      title: tabTooltip(tab, rootName.value),
      problem: badge?.tone ?? null,
      problemLabel: badge?.label ?? "",
    };
  });
});

const startState = computed(
  () => workspace.value === null && tabs.value.length === 0,
);
const noFileState = computed(
  () => workspace.value !== null && tabs.value.length === 0,
);

const dialogActions = computed(() => dialog.value?.actions ?? []);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Go reports a missing root with this fixed, locale-independent error. */
function isMissingFolderError(error: unknown): boolean {
  return errorText(error) === MISSING_FOLDER_ERROR;
}

/**
 * Short Chinese text for a folder that could not be opened. The raw backend
 * error is kept in the notice tooltip, matching save-failure banners.
 */
function folderOpenFailureMessage(error: unknown): string {
  const text = errorText(error).toLowerCase();
  if (
    text.includes("permission denied") ||
    text.includes("operation not permitted") ||
    text.includes("access denied")
  ) {
    return "没有权限打开这个文件夹";
  }
  if (text.includes("not a folder") || text.includes("not a directory")) {
    return "所选项目不是文件夹";
  }
  if (text.includes("folder cannot be opened")) {
    return "不能把这个文件夹作为工作区";
  }
  if (
    text.includes("folder was not chosen") ||
    text.includes("folder is not absolute")
  ) {
    return "无法打开这个文件夹";
  }
  return "打开文件夹失败，请稍后重试";
}

function showFolderOpenFailure(error: unknown) {
  // A notice with a raw-error tooltip needs more time to be read; showNotice
  // extends detail notices automatically when no duration is given.
  showNotice(
    folderOpenFailureMessage(error),
    "danger",
    undefined,
    errorText(error),
    "folder-open-failure",
  );
}

function findTab(id: number | null): TabModel | null {
  if (id === null) return null;
  return tabs.value.find((tab) => tab.id === id) ?? null;
}

interface WorkspaceContext {
  root: string;
  generation: number;
}

function currentWorkspaceContext(): WorkspaceContext | null {
  const current = workspace.value;
  return current === null
    ? null
    : { root: current.root, generation: current.generation };
}

function isCurrentWorkspace(root: string, generation: number): boolean {
  return (
    workspace.value !== null &&
    workspace.value.root === root &&
    workspace.value.generation === generation
  );
}

function openingKey(
  kind: "workspace" | "single",
  path: string,
  scope = "",
): string {
  return `${kind}\u0000${scope}\u0000${path}`;
}

function tabKey(tab: Pick<TabModel, "kind" | "path">): string {
  return `${tab.kind}\u0000${tab.path}`;
}

function workspaceAbsolutePath(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${path}`;
}

function sameFilePath(left: string, right: string): boolean {
  return left.replace(/\\/g, "/") === right.replace(/\\/g, "/");
}

/** Finds a workspace tab or a single-file tab for the same physical path. */
function findOpenTabForWorkspacePathIn(
  list: readonly TabModel[],
  root: string,
  path: string,
): TabModel | undefined {
  const workspaceTab = list.find(
    (tab) => tab.kind === "workspace" && tab.path === path,
  );
  if (workspaceTab !== undefined) {
    return workspaceTab;
  }
  const absolute = workspaceAbsolutePath(root, path);
  return list.find(
    (tab) => tab.kind === "single" && sameFilePath(tab.path, absolute),
  );
}

function findOpenTabForWorkspacePath(
  root: string,
  path: string,
): TabModel | undefined {
  return findOpenTabForWorkspacePathIn(tabs.value, root, path);
}

function showNotice(
  text: string,
  tone: Notice["tone"] = "success",
  duration?: number,
  detail?: string,
  kind?: Notice["kind"],
) {
  const visibleFor =
    duration ??
    (detail === undefined ? NOTICE_DURATION_MS : NOTICE_DETAIL_DURATION_MS);
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  const next: Notice = { text, tone };
  if (detail !== undefined) next.detail = detail;
  if (kind !== undefined) next.kind = kind;
  notice.value = next;
  if (visibleFor > 0) {
    noticeTimer = setTimeout(() => {
      notice.value = null;
      noticeTimer = null;
    }, visibleFor);
  }
}

/** Clears one notice kind only; unrelated notices keep their own timer. */
function clearNotice(kind: NonNullable<Notice["kind"]>) {
  if (notice.value?.kind !== kind) {
    return;
  }
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  notice.value = null;
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
  workspaceClosed.value = loaded.workspaceClosed === true;
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

function recentFilesForRoot(root: string): string[] {
  return recentFilesByRoot.value[root] ?? [];
}

function rememberRecentWorkspaceFile(root: string, path: string) {
  if (!/\.md$/i.test(path)) {
    return;
  }
  const current = recentFilesForRoot(root);
  const next = rememberRecentFilePath(current, path);
  if (
    next.length === current.length &&
    next.every((item, index) => item === current[index])
  ) {
    return;
  }
  recentFilesByRoot.value = {
    ...recentFilesByRoot.value,
    [root]: next,
  };
  schedulePersistTabs();
}

/**
 * Drops a removed file from the recent list. A removed folder also drops
 * every recent file below it, because those paths no longer exist.
 */
function forgetRecentWorkspacePath(path: string, isDir: boolean) {
  const root = workspace.value?.root;
  if (root === undefined) return;
  const current = recentFilesForRoot(root);
  const next = current.filter((item) =>
    isDir ? item !== path && !item.startsWith(`${path}/`) : item !== path,
  );
  if (next.length === current.length) {
    return;
  }
  recentFilesByRoot.value = {
    ...recentFilesByRoot.value,
    [root]: next,
  };
  schedulePersistTabs();
}

function setRecentFilesForRoot(
  root: string,
  files: readonly string[] | undefined,
) {
  recentFilesByRoot.value = {
    ...recentFilesByRoot.value,
    [root]: normalizeRecentFiles(files),
  };
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

function askDialog(state: DialogState): Promise<string> {
  // 0.4.0 stacks --z-popover above --z-modal. Close only the transient menus;
  // the floating sidebar stays open underneath the dialog so focus can return
  // to the control that opened it.
  closePopoverMenus();
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

function clearTabSaveTimer(id: number) {
  const timer = saveTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    saveTimers.delete(id);
  }
}

function clearSavingDisplay(id: number) {
  const timer = savingTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    savingTimers.delete(id);
  }
}

function recoveryKindFor(tab: TabModel): "workspace" | "single" | null {
  if (tab.kind === "workspace") {
    return "workspace";
  }
  if (tab.kind === "single") {
    return "single";
  }
  return null;
}

/**
 * A clean tab normally needs no copy, because its text is still on disk. An
 * externally deleted file is the exception: the only remaining copy of the
 * content lives in the tab until the user saves or closes it.
 */
function needsRecoveryCopy(tab: TabModel): boolean {
  return (
    recoveryKindFor(tab) !== null &&
    (isDirty(tab) || tab.externalState === "deleted")
  );
}

function recoveryPayload(tab: TabModel): RecoveryCopy | null {
  const kind = recoveryKindFor(tab);
  if (kind === null) {
    return null;
  }
  const root = kind === "workspace" ? workspace.value?.root ?? "" : "";
  if (kind === "workspace" && root === "") {
    return null;
  }
  return {
    kind,
    root,
    path: tab.path,
    lineEnding: tab.lineEnding,
    text: tab.text,
    baselineUnconfirmed: tab.externalState !== "none" || tab.restored,
  };
}

/**
 * Tracks recovery writes and deletes so the close handshake can wait for them
 * before telling Go the window is ready to close.
 */
function trackRecovery<T>(promise: Promise<T>): Promise<T> {
  pendingRecoveryOperations.add(promise);
  void promise
    .finally(() => {
      pendingRecoveryOperations.delete(promise);
    })
    .catch(() => {});
  return promise;
}

async function waitForRecoveryOperations(
  timeoutMs = Number.POSITIVE_INFINITY,
): Promise<boolean> {
  if (timeoutMs <= 0) {
    return pendingRecoveryOperations.size === 0;
  }
  const deadline = Number.isFinite(timeoutMs)
    ? Date.now() + timeoutMs
    : Number.POSITIVE_INFINITY;
  while (pendingRecoveryOperations.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return false;
    }
    const pending = [...pendingRecoveryOperations];
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const settled = Promise.allSettled(pending).then(() => undefined);
      if (deadline === Number.POSITIVE_INFINITY) {
        await settled;
      } else {
        await Promise.race([
          settled,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, remaining);
          }),
        ]);
      }
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }
  return true;
}

function tabInRecoveryDialog(tab: TabModel): boolean {
  const state = recoveryDialog.value;
  if (state === null) {
    return false;
  }
  if (tab.kind === "workspace") {
    const root = workspace.value?.root ?? "";
    return state.raw.some(
      (item) =>
        item.kind === "workspace" && item.root === root && item.path === tab.path,
    );
  }
  if (tab.kind === "single") {
    return state.raw.some(
      (item) => item.kind === "single" && sameFilePath(item.path, tab.path),
    );
  }
  return false;
}

function rescheduleDirtyTabs() {
  for (const tab of tabs.value) {
    if (
      tab.kind === "preview" ||
      !isDirty(tab) ||
      tab.restored ||
      tab.externalState !== "none" ||
      tab.mixedLineEndings ||
      tab.savePhase !== "editing" ||
      saveTimers.has(tab.id)
    ) {
      continue;
    }
    scheduleAutosave(tab.id);
  }
}

function closeRecoveryDialog() {
  recoveryDialog.value = null;
  const resolve = resolveRecoveryClosed;
  resolveRecoveryClosed = null;
  recoveryClosed = null;
  resolve?.();
  rescheduleDirtyTabs();
}

/** Called every five seconds by the per-tab copy timer after the first copy. */
function onRecoveryDue(tabId: number): boolean {
  const tab = findTab(tabId);
  if (tab === null || !needsRecoveryCopy(tab)) {
    return false;
  }
  writeRecoveryCopy(tabId);
  return true;
}

function startRecoveryTimer(tabId: number) {
  recoveryTicker.start(tabId);
}

function deleteRecoveryForTab(tab: TabModel) {
  const id = tab.recoveryId;
  tab.recoveryId = null;
  if (id === null) {
    return;
  }
  void trackRecovery(
    deleteRecovery(id, tab.kind === "workspace" ? tab.generation : 0),
  ).catch((error) => {
    console.warn("recovery: could not remove copy", error);
  });
}

/**
 * Stops the copy timer for a tab and removes its copy. It is used when the
 * text returns to the disk baseline, a tab closes, or a dialog discards the
 * changes. An in-flight write deletes its own result when it finds the tab
 * clean or gone.
 */
function forgetRecoveryForTab(tab: TabModel) {
  recoveryTicker.stop(tab.id);
  recoveryWrites.delete(tab.id);
  recoveryEpoch.set(tab.id, (recoveryEpoch.get(tab.id) ?? 0) + 1);
  deleteRecoveryForTab(tab);
}

function writeRecoveryCopy(tabId: number) {
  const tab = findTab(tabId);
  if (tab === null || !needsRecoveryCopy(tab)) {
    return;
  }
  const payload = recoveryPayload(tab);
  if (payload === null) {
    return;
  }
  let state = recoveryWrites.get(tabId);
  if (state === undefined) {
    state = {
      written: null,
      writtenBaselineUnconfirmed: null,
      writing: false,
      queued: false,
    };
    recoveryWrites.set(tabId, state);
  }
  if (state.writing) {
    state.queued = true;
    return;
  }
  const baselineUnconfirmed = payload.baselineUnconfirmed === true;
  if (
    state.written === payload.text &&
    state.writtenBaselineUnconfirmed === baselineUnconfirmed
  ) {
    return;
  }
  state.writing = true;
  const captured = { ...payload };
  const generation = tab.kind === "workspace" ? tab.generation : 0;
  const epoch = recoveryEpoch.get(tabId) ?? 0;
  void trackRecovery(saveRecovery(captured, generation))
    .then((id) => {
      const current = findTab(tabId);
      if (
        (recoveryEpoch.get(tabId) ?? 0) !== epoch ||
        current === null ||
        current.kind !== tab.kind ||
        current.path !== captured.path ||
        !needsRecoveryCopy(current)
      ) {
        if (current === null || current.recoveryId !== id) {
          void trackRecovery(deleteRecovery(id, generation)).catch(() => {});
        }
        return;
      }
      current.recoveryId = id;
      const currentState = recoveryWrites.get(tabId);
      if (currentState !== undefined) {
        currentState.written = captured.text;
        currentState.writtenBaselineUnconfirmed =
          captured.baselineUnconfirmed === true;
      }
    })
    .catch((error) => {
      // A failed copy only goes to the log; the editor keeps working.
      console.warn("recovery: could not write copy", error);
    })
    .finally(() => {
      const currentState = recoveryWrites.get(tabId);
      if (currentState === undefined) {
        return;
      }
      currentState.writing = false;
      const current = findTab(tabId);
      if (currentState.queued && current !== null && isDirty(current)) {
        currentState.queued = false;
        writeRecoveryCopy(tabId);
      } else {
        currentState.queued = false;
      }
    });
}

function writeAllRecoveryCopies() {
  for (const tab of tabs.value) {
    if (needsRecoveryCopy(tab)) {
      writeRecoveryCopy(tab.id);
    }
  }
}

function presentRecoveryItem(item: RecoveryItem): RecoveryDialogItem {
  let note: string;
  if (!item.restorable) {
    note = item.reason ? `无法恢复（${item.reason}）` : "无法恢复";
  } else if (item.diskState === "changed") {
    note = "磁盘上的文件已更改";
  } else if (item.diskState === "missing") {
    note = "文件已不存在";
  } else {
    note = describeWordDifference(item.text, item.diskText);
  }
  return {
    id: item.id,
    name: item.name,
    location: item.path,
    time: formatRecoveryTime(item.savedAt),
    note,
    unable: !item.restorable,
  };
}

function recoveryGeneration(): number {
  return workspace.value?.generation ?? 0;
}

async function maybeShowRecoveryDialog() {
  if (recoveryChecking || recoveryDialog.value !== null) {
    return;
  }
  recoveryChecking = true;
  const generation = recoveryGeneration();
  try {
    const listing = await listRecovery(generation);
    if (recoveryGeneration() !== generation) {
      return;
    }
    if (listing.items.length === 0) {
      return;
    }
    recoveryClosed = new Promise<void>((resolve) => {
      resolveRecoveryClosed = resolve;
    });
    closeCommandPalette();
    closePopoverMenus();
    recoveryDialog.value = {
      items: listing.items.map(presentRecoveryItem),
      raw: listing.items,
      otherFolders: listing.otherFolders,
    };
  } catch (error) {
    console.warn("recovery: could not list copies", error);
  } finally {
    recoveryChecking = false;
  }
}

async function discardRecoveryCopies() {
  const state = recoveryDialog.value;
  if (state === null || recoveryApplying) {
    return;
  }
  recoveryApplying = true;
  try {
    await trackRecovery(
      discardRecovery(
        state.raw.map((item) => item.id),
        recoveryGeneration(),
      ),
    );
    closeRecoveryDialog();
  } catch (error) {
    showNotice(`无法丢弃恢复内容：${errorText(error)}`, "danger");
  } finally {
    recoveryApplying = false;
  }
}

function asLineEnding(value: string): LineEnding {
  return value === "\r\n" || value === "\r" ? value : "\n";
}

/**
 * Puts recovered text into a tab without writing anything. The copy id stays
 * attached so saving, loading the disk version or closing the tab removes it.
 */
function setRecoveredContent(
  tab: TabModel,
  item: RecoveryItem,
  mode: "review" | "restore",
  existing: boolean,
) {
  clearTabSaveTimer(tab.id);
  clearSavingDisplay(tab.id);
  recoveryTicker.stop(tab.id);
  recoveryWrites.delete(tab.id);
  recoveryEpoch.set(tab.id, (recoveryEpoch.get(tab.id) ?? 0) + 1);

  const text = normalizeLineEndings(item.text);
  // The copy on disk already has this text. Remember it so a later
  // save-before-close pass does not rewrite the copy and lose its diskHash.
  recoveryWrites.set(tab.id, {
    written: text,
    // A review copy was written before the page could confirm a baseline, so
    // an untouched tab does not need an identical rewrite on close. Any edit
    // or external state change compares against the actual current flag.
    writtenBaselineUnconfirmed: mode === "review",
    writing: false,
    queued: false,
  });

  // An existing tab may have received a newer disk baseline from the watcher
  // while the dialog was open. Never replace it with the older List snapshot.
  const itemDiskText =
    item.diskState === "missing" ? "" : normalizeLineEndings(item.diskText);
  const diskText = existing ? tab.originalText : itemDiskText;
  let diskState: "same" | "changed" | "missing";
  if (!existing) {
    diskState =
      item.diskState === "missing"
        ? "missing"
        : item.diskState === "same"
          ? "same"
          : "changed";
  } else if (item.diskState === "missing") {
    diskState = "missing";
  } else if (itemDiskText === diskText) {
    diskState = item.diskState === "same" ? "same" : "changed";
  } else if (tab.externalState === "none" && !isDirty(tab)) {
    // The tab's baseline is current disk content, newer than the snapshot.
    diskState = text === diskText ? "same" : "changed";
  } else {
    diskState = "changed";
  }
  const detected = existing
    ? { ending: tab.lineEnding, mixed: tab.mixedLineEndings }
    : item.diskState === "missing"
      ? { ending: asLineEnding(item.lineEnding), mixed: false }
      : detectLineEndings(item.diskText);

  const active = tab.id === activeTabId.value;
  if (active) {
    applyingExternal = true;
  }
  tab.text = text;
  tab.originalText = diskText;
  tab.lineEnding = detected.ending;
  tab.mixedLineEndings = detected.mixed;
  tab.saveError = null;
  tab.saveErrorDetail = null;
  tab.externalState =
    diskState === "missing"
      ? "deleted"
      : diskState === "changed"
        ? "modified"
        : "none";
  tab.revision += 1;
  tab.restored = mode === "review";
  tab.savePhase = tab.restored
    ? "paused"
    : detected.mixed
      ? "mixed"
      : "editing";
  tab.recoveryId = item.id;
  if (!active) {
    tab.snapshot = null;
  }
  if (active && editor !== null) {
    editor.replaceDocument(text);
  }
  applyingExternal = false;
}

/**
 * Opens one recovered document. With mode "review" it stays paused behind the
 * recovery banner; with "restore" unchanged disk content is queued for the
 * normal autosave. Returns null when the item cannot be used, typically a
 * single-file path that no longer resolves safely.
 */
async function applyRecoveryItem(
  item: RecoveryItem,
  mode: "review" | "restore",
): Promise<TabModel | null> {
  if (!item.restorable) {
    return null;
  }
  if (item.kind === "workspace") {
    const current = workspace.value;
    if (current === null || current.root !== item.root) {
      return null;
    }
    const existing = findOpenTabForWorkspacePathIn(
      tabs.value,
      current.root,
      item.path,
    );
    if (existing !== undefined) {
      if (isDirty(existing) && existing.recoveryId === null) {
        return null;
      }
      setRecoveredContent(existing, item, mode, true);
      await activateTab(existing.id, false);
      return existing;
    }
    const tab = makeMarkdownTab(
      "workspace",
      item.path,
      item.name,
      item.text,
      { generation: current.generation },
    );
    setRecoveredContent(tab, item, mode, false);
    insertTab(tab);
    await activateTab(tab.id, false);
    return tab;
  }

  try {
    await restoreRecoverySingleFile(item.id);
  } catch {
    return null;
  }
  const existing = tabs.value.find(
    (tab) => tab.kind === "single" && sameFilePath(tab.path, item.path),
  );
  if (existing !== undefined) {
    if (isDirty(existing) && existing.recoveryId === null) {
      return null;
    }
    setRecoveredContent(existing, item, mode, true);
    await activateTab(existing.id, false);
    return existing;
  }
  const tab = makeMarkdownTab("single", item.path, item.name, item.text);
  setRecoveredContent(tab, item, mode, false);
  insertTab(tab);
  await activateTab(tab.id, false);
  return tab;
}

async function finishRecovery(mode: "review" | "restore") {
  const state = recoveryDialog.value;
  if (state === null || recoveryApplying) {
    return;
  }
  recoveryApplying = true;
  const generation = recoveryGeneration();
  const autosave: number[] = [];
  const skipped: string[] = [];
  try {
    // The dialog can stay open for a long time. Re-read the disk state so a
    // sync client or `git pull` cannot be mistaken for the version the user
    // saw when the dialog opened.
    let listing;
    try {
      listing = await listRecovery(generation);
    } catch (error) {
      showNotice(`无法确认恢复内容：${errorText(error)}`, "danger");
      return;
    }
    if (recoveryGeneration() !== generation) {
      return;
    }
    const latest = new Map(listing.items.map((item) => [item.id, item]));
    for (const original of state.raw) {
      const item = latest.get(original.id);
      if (item === undefined) {
        skipped.push(original.name);
        continue;
      }
      const tab = await applyRecoveryItem(item, mode);
      if (tab === null) {
        skipped.push(item.name);
        continue;
      }
      if (mode === "restore" && item.diskState === "same") {
        autosave.push(tab.id);
      }
    }
  } finally {
    recoveryApplying = false;
  }
  closeRecoveryDialog();
  for (const id of autosave) {
    const tab = findTab(id);
    if (tab !== null && isDirty(tab) && !tab.restored) {
      scheduleAutosave(id);
    }
  }
  if (skipped.length > 0) {
    showNotice(`有 ${skipped.length} 个文件无法恢复`, "danger");
  }
  await nextTick();
  editor?.focus();
}

function markExternalState(tab: TabModel, next: "none" | "modified" | "deleted") {
  tab.externalState = next;
  tab.revision += 1;
  if (next !== "none") {
    writeRecoveryCopy(tab.id);
    if (next === "deleted") {
      startRecoveryTimer(tab.id);
    }
  }
}

/**
 * Only the active tab has a mounted editor, and an IME only composes in a
 * focused editable. Checking the live view here keeps a missed
 * `compositionend` from freezing autosave: once that view is destroyed
 * (tab switch, close, remount) or the editor loses focus, the tab saves
 * normally again. `invalidatedCompositions` covers the remaining case where
 * CodeMirror's flag never clears while the view stays focused.
 */
function autosaveBlockedByComposition(tabId: number): boolean {
  if (tabId !== activeTabId.value || editor === null) {
    return false;
  }
  if (invalidatedCompositions.has(tabId)) {
    return false;
  }
  const view = editor.view;
  return (view.compositionStarted || view.composing) && view.hasFocus;
}

/** Keys that only change modifier state; a live composition can still send them. */
const LONE_MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "AltGraph",
  "OS",
]);

/**
 * A fallback for a composition whose CodeMirror flag never clears while the
 * editor keeps focus; the 2026-11-08 Rime/WKWebView probe did not observe a
 * lost `compositionend`, so this is not a confirmed platform behavior. A key
 * that is neither part of a composition nor a lone modifier proves the IME
 * no longer owns the editor: ignore the stale flag for autosave until the
 * next composition start or end. This changes only the save decision;
 * CodeMirror's state and rendering stay untouched.
 */
function noteCompositionEndKey(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (LONE_MODIFIER_KEYS.has(event.key)) {
    return;
  }
  const tab = findTab(activeTabId.value);
  if (tab === null || editor === null) {
    return;
  }
  const view = editor.view;
  if (!view.compositionStarted && !view.composing) {
    return;
  }
  invalidatedCompositions.add(tab.id);
}

function handleEditorCompositionStart(tabId: number) {
  invalidatedCompositions.delete(tabId);
}

function scheduleAutosave(tabId: number) {
  clearTabSaveTimer(tabId);
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId);
      if (autosaveBlockedByComposition(tabId)) {
        // Recheck periodically instead of dropping the save: a real
        // composition end reschedules through handleEditorCompositionEnd,
        // and this covers the ones that never report one.
        scheduleAutosave(tabId);
        return;
      }
      void saveTab(tabId, false, undefined, "autosave");
    }, AUTOSAVE_DELAY_MS),
  );
}

function handleEditorChange(tabId: number, text: string) {
  const tab = findTab(tabId);
  if (tab === null) {
    return;
  }
  if (paletteSession.value !== null) {
    // The editor cannot be typed into while the palette has focus, so any
    // document change here came from outside it. Close after the current
    // task; a click already being handled still reaches the stale-session
    // checks below. Do not close a newer palette opened after this change.
    const sessionAtChange = paletteSession.value;
    queueMicrotask(() => {
      if (paletteSession.value === sessionAtChange) {
        closeCommandPalette();
      }
    });
  }
  tab.text = text;
  if (applyingExternal) {
    return;
  }
  applyAutosaveState(tab);
}

/**
 * Applies the autosave policy to the tab's current text. Shared by document
 * changes and the end of a composition, which can happen without a change.
 */
function applyAutosaveState(tab: TabModel) {
  const tabId = tab.id;
  if (tab.text === tab.originalText) {
    clearTabSaveTimer(tabId);
    if (tab.externalState === "deleted") {
      // The disk baseline is gone; the tab is the only remaining copy.
      writeRecoveryCopy(tabId);
    } else {
      forgetRecoveryForTab(tab);
      tab.restored = false;
    }
    if (tab.savePhase !== "failed" && tab.savePhase !== "saving") {
      tab.savePhase = "saved";
    }
    return;
  }
  startRecoveryTimer(tabId);
  if (tab.mixedLineEndings) {
    clearTabSaveTimer(tabId);
    tab.savePhase = "mixed";
    writeRecoveryCopy(tabId);
    return;
  }
  if (tab.restored) {
    clearTabSaveTimer(tabId);
    tab.savePhase = "paused";
    return;
  }
  tab.savePhase = tab.saveError === null ? "editing" : "failed";
  scheduleAutosave(tabId);
}

/**
 * A commit usually arrives with one more document change, which schedules by
 * itself. Ending a composition without a change still restarts a save that
 * was waiting or clears text that returned to the baseline, but it must not
 * retry a failed save; only new input does that (see ui.md).
 */
function handleEditorCompositionEnd(tabId: number) {
  const tab = findTab(tabId);
  if (tab === null || tab.kind === "preview") {
    return;
  }
  invalidatedCompositions.delete(tabId);
  if (saveTimers.has(tabId) || tab.text === tab.originalText) {
    applyAutosaveState(tab);
  }
}

type SaveTrigger = "autosave" | "explicit";

function saveTab(
  tabId: number,
  force = false,
  revisionAtRequest?: number,
  trigger: SaveTrigger = "explicit",
): Promise<boolean> {
  const tab = findTab(tabId);
  if (tab === null) {
    return Promise.resolve(true);
  }
  // Only the files listed in the recovery dialog are frozen until the user
  // chooses. Other tabs, such as a dirty single file, keep autosaving.
  if (recoveryDialog.value !== null && tabInRecoveryDialog(tab)) {
    return Promise.resolve(false);
  }
  const revision = revisionAtRequest ?? tab.revision;
  const next = saveQueue.then(() =>
    saveTabNow(tabId, force, revision, trigger),
  );
  saveQueue = next.then(
    (saved) => saved,
    () => false,
  );
  return next;
}

function beginWrite(tabId: number) {
  writesInFlight.set(tabId, (writesInFlight.get(tabId) ?? 0) + 1);
  clearSavingDisplay(tabId);
  savingTimers.set(
    tabId,
    setTimeout(() => {
      savingTimers.delete(tabId);
      const tab = findTab(tabId);
      if (
        tab !== null &&
        (writesInFlight.get(tabId) ?? 0) > 0 &&
        tab.savePhase !== "failed"
      ) {
        tab.savePhase = "saving";
      }
    }, SAVING_DISPLAY_DELAY_MS),
  );
}

function endWrite(tabId: number) {
  writesInFlight.set(tabId, Math.max(0, (writesInFlight.get(tabId) ?? 0) - 1));
  clearSavingDisplay(tabId);
}

async function saveTabNow(
  tabId: number,
  force: boolean,
  revisionAtRequest: number,
  trigger: SaveTrigger,
): Promise<boolean> {
  let tab = findTab(tabId);
  if (tab === null) {
    return true;
  }
  if (force && tab.revision !== revisionAtRequest) {
    return stopForcedSave(tabId);
  }
  if (!force && tab.restored) {
    tab.savePhase = "paused";
    return false;
  }
  if (
    !force &&
    tab.externalState !== "none" &&
    (isDirty(tab) || tab.externalState === "deleted")
  ) {
    return false;
  }
  let mustWrite = force;
  for (;;) {
    tab = findTab(tabId);
    if (tab === null) {
      return true;
    }
    if (tab.mixedLineEndings && !force) {
      tab.savePhase = "mixed";
      return false;
    }
    if (!isDirty(tab) && !mustWrite) {
      if (tab.savePhase !== "failed" && tab.savePhase !== "saving") {
        tab.savePhase = "saved";
      }
      return true;
    }
    if (!force && tab.externalState !== "none") {
      tab.savePhase = tab.saveError === null ? "editing" : "failed";
      return false;
    }
    // The composition can start while this save waits in the queue, or
    // between loop iterations after an earlier write landed, so recheck
    // before every actual write instead of only when the timer fires.
    if (trigger === "autosave" && autosaveBlockedByComposition(tabId)) {
      tab.savePhase = tab.saveError === null ? "editing" : "failed";
      scheduleAutosave(tabId);
      return false;
    }
    const edit = {
      kind: tab.kind,
      path: tab.path,
      generation: tab.generation,
      text: tab.text,
      ending: tab.lineEnding,
    };
    beginWrite(tabId);
    try {
      if (edit.kind === "workspace") {
        await writeFile(
          edit.path,
          withLineEnding(edit.text, edit.ending),
          edit.generation,
        );
      } else if (edit.kind === "single") {
        await writeSingleFile(
          edit.path,
          withLineEnding(edit.text, edit.ending),
        );
      }
    } catch (error) {
      endWrite(tabId);
      const current = findTab(tabId);
      if (current !== null && current.path === edit.path) {
        const raw = errorText(error);
        current.saveError = saveFailureMessage(raw);
        current.saveErrorDetail = raw;
        current.savePhase = "failed";
        writeRecoveryCopy(tabId);
      }
      return false;
    }
    endWrite(tabId);
    mustWrite = false;
    const current = findTab(tabId);
    if (current === null) {
      return true;
    }
    if (force && current.revision !== revisionAtRequest) {
      return stopForcedSave(tabId);
    }
    if (current.path !== edit.path || current.kind !== edit.kind) {
      // A rename landed while the write was in flight. Do not treat the old
      // path's content as the new path's baseline; save the current text to
      // the new path instead.
      current.savePhase = "editing";
      continue;
    }
    current.originalText = edit.text;
    current.saveError = null;
    current.saveErrorDetail = null;
    if (force) {
      current.externalState = "none";
    }
    if (current.text === current.originalText) {
      current.savePhase = "saved";
      current.restored = false;
      forgetRecoveryForTab(current);
      return true;
    }
    current.savePhase = "editing";
  }
}

function stopForcedSave(tabId: number): false {
  clearTabSaveTimer(tabId);
  const tab = findTab(tabId);
  if (
    tab !== null &&
    tab.externalState !== "deleted" &&
    tab.text !== tab.originalText
  ) {
    markExternalState(tab, "modified");
  }
  if (tab !== null) {
    tab.savePhase = "paused";
    writeRecoveryCopy(tabId);
  }
  return false;
}

async function saveAllTabs(force = false): Promise<boolean> {
  const ids = tabs.value
    .filter((tab) => tab.kind !== "preview")
    .map((tab) => tab.id);
  const results = await Promise.all(ids.map((id) => saveTab(id, force)));
  return results.every(Boolean);
}

async function saveWorkspaceTabs(): Promise<boolean> {
  const ids = tabs.value
    .filter((tab) => tab.kind === "workspace")
    .map((tab) => tab.id);
  const results = await Promise.all(ids.map((id) => saveTab(id)));
  return results.every(Boolean);
}

function makeMarkdownTab(
  kind: "workspace" | "single",
  path: string,
  name: string,
  text: string,
  options: {
    generation?: number;
    snapshot?: EditorRestoreState | null;
  } = {},
): TabModel {
  const detected = detectLineEndings(text);
  const normalized = normalizeLineEndings(text);
  return {
    id: nextTabId++,
    kind,
    path,
    name,
    text: normalized,
    originalText: normalized,
    lineEnding: detected.ending,
    mixedLineEndings: detected.mixed,
    savePhase: detected.mixed ? "mixed" : "saved",
    saveError: null,
    saveErrorDetail: null,
    externalState: "none",
    revision: 0,
    restored: false,
    recoveryId: null,
    generation:
      kind === "workspace"
        ? options.generation ?? workspace.value?.generation ?? 0
        : 0,
    snapshot: options.snapshot ?? null,
  };
}

function previewFolderFor(path: string): string {
  const root = workspace.value?.root ?? "";
  const parent = parentOfRelative(path);
  return parent === "."
    ? displayPath(root, homeDir.value)
    : displayPath(`${root}/${parent}`, homeDir.value);
}

function makePreviewTab(
  path: string,
  name: string,
  size: number,
  options: { generation?: number } = {},
): TabModel {
  return {
    id: nextTabId++,
    kind: "preview",
    path,
    name,
    text: "",
    originalText: "",
    lineEnding: "\n",
    mixedLineEndings: false,
    savePhase: "idle",
    saveError: null,
    saveErrorDetail: null,
    externalState: "none",
    revision: 0,
    restored: false,
    recoveryId: null,
    generation: options.generation ?? workspace.value?.generation ?? 0,
    previewSize: size,
    previewFolder: previewFolderFor(path),
    snapshot: null,
  };
}

function insertTab(tab: TabModel) {
  const index = insertionIndex(tabs.value, activeTabId.value);
  tabs.value.splice(index, 0, tab);
}

function snapshotActiveEditor() {
  const tab = findTab(activeTabId.value);
  if (tab === null || tab.kind === "preview" || editor === null) {
    return;
  }
  const state = editor.getRestoreState();
  tab.snapshot = markRaw({
    selection: state.selection ?? null,
    history: state.history ?? null,
    scrollTopLine: state.scrollTopLine ?? null,
    scrollTopOffset: state.scrollTopOffset ?? null,
  });
}

function clearEditor() {
  slashMenu?.destroy();
  slashMenu = null;
  slashState.value = null;
  editor?.destroy();
  editor = null;
  editorHost.value?.replaceChildren();
}

async function mountActive(focus = true) {
  const sequence = ++mountSequence;
  clearEditor();
  const target = findTab(activeTabId.value);
  if (target === null || target.kind === "preview") {
    return;
  }
  await nextTick();
  if (sequence !== mountSequence) {
    return;
  }
  const tab = findTab(activeTabId.value);
  if (tab === null || tab.id !== target.id || tab.kind === "preview") {
    return;
  }
  const host = editorHost.value;
  if (!host) {
    return;
  }
  const restore = tab.snapshot;
  tab.snapshot = null;
  host.replaceChildren();
  editor = createEditor({
    parent: host,
    doc: tab.text,
    mode: mode.value,
    platform: platform.value,
    restore: restore ?? undefined,
    resolveImage: (src) =>
      tab.kind === "workspace"
        ? resolveImageUrl(src, tab.path, tab.generation)
        : null,
    onPasteImage: (ticket) => imageInsertion.handlePaste(ticket),
    onChange: (text) => handleEditorChange(tab.id, text),
    onCompositionStart: () => handleEditorCompositionStart(tab.id),
    onCompositionEnd: () => handleEditorCompositionEnd(tab.id),
  });
  slashMenu = createSlashMenu({
    view: editor.view,
    platform: platform.value,
    onChange: (state) => {
      slashState.value = state;
    },
  });
  if (focus) {
    editor.focus();
  }
}

function executeSlashCommand(index: number) {
  slashMenu?.execute(index);
}

function highlightSlashCommand(index: number) {
  slashMenu?.highlight(index);
}

async function activateTab(id: number, focus = true) {
  const target = findTab(id);
  if (target === null) {
    return;
  }
  if (activeTabId.value === id) {
    if (target.kind === "workspace" && workspace.value !== null) {
      rememberRecentWorkspaceFile(workspace.value.root, target.path);
    }
    closeOverlaySidebar();
    if (focus) {
      editor?.focus();
    }
    return;
  }
  snapshotActiveEditor();
  activeTabId.value = id;
  if (target.kind === "workspace" || target.kind === "preview") {
    lastWorkspaceActivePath = target.path;
  }
  if (target.kind === "workspace" && workspace.value !== null) {
    rememberRecentWorkspaceFile(workspace.value.root, target.path);
  }
  await mountActive(focus);
  closeOverlaySidebar();
  schedulePersistTabs();
}

function cycleTab(delta: number) {
  if (tabs.value.length === 0) {
    return;
  }
  const index = tabs.value.findIndex((tab) => tab.id === activeTabId.value);
  const next =
    (index === -1 ? 0 : index + delta + tabs.value.length) % tabs.value.length;
  return activateTab(tabs.value[next]!.id, true);
}

async function openWorkspaceFile(
  path: string,
  name?: string,
  options: { silent?: boolean; reveal?: boolean } = {},
): Promise<boolean> {
  const context = currentWorkspaceContext();
  if (context === null) {
    return false;
  }
  const existing = findOpenTabForWorkspacePath(context.root, path);
  if (existing !== undefined) {
    await activateTab(existing.id);
    if (options.reveal ?? true) {
      void sidebar.value?.reveal(path);
    }
    return true;
  }
  const key = openingKey(
    "workspace",
    path,
    `${context.root}\u0000${context.generation}`,
  );
  const pending = openingTabs.get(key);
  if (pending !== undefined) {
    return pending;
  }

  const task = (async (): Promise<boolean> => {
    let text: string;
    try {
      text = await readFile(path);
    } catch (error) {
      if (
        isCurrentWorkspace(context.root, context.generation) &&
        !options.silent
      ) {
        showNotice(`读取失败：${errorText(error)}`, "danger");
      }
      return false;
    }
    if (!isCurrentWorkspace(context.root, context.generation)) {
      return false;
    }
    const current = findOpenTabForWorkspacePath(context.root, path);
    if (current !== undefined) {
      await activateTab(current.id);
      if (options.reveal ?? true) {
        void sidebar.value?.reveal(path);
      }
      return true;
    }
    const tab = makeMarkdownTab(
      "workspace",
      path,
      name ?? absoluteBaseName(path),
      text,
      { generation: context.generation },
    );
    insertTab(tab);
    await activateTab(tab.id);
    if (options.reveal ?? true) {
      void sidebar.value?.reveal(path);
    }
    return true;
  })();

  openingTabs.set(key, task);
  try {
    return await task;
  } finally {
    if (openingTabs.get(key) === task) {
      openingTabs.delete(key);
    }
  }
}

async function openPreviewEntry(
  entry: {
    path: string;
    name: string;
    size: number;
  },
  options: { context?: WorkspaceContext } = {},
): Promise<boolean> {
  const context = options.context ?? currentWorkspaceContext();
  if (
    context === null ||
    !isCurrentWorkspace(context.root, context.generation)
  ) {
    return false;
  }
  const existing = tabs.value.find(
    (tab) => tab.kind === "preview" && tab.path === entry.path,
  );
  if (existing) {
    await activateTab(existing.id);
    return true;
  }
  const tab = makePreviewTab(entry.path, entry.name, entry.size, {
    generation: context.generation,
  });
  insertTab(tab);
  await activateTab(tab.id);
  return true;
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

function applyWorkspaceState(folder: {
  root: string;
  generation: number;
}) {
  workspace.value = { root: folder.root, generation: folder.generation };
  missingLastFolder.value = null;
  workspaceClosed.value = false;
  dropActive.value = false;
  dragDepth = 0;
  rememberRecent(folder.root);
  startWatch(folder.generation);
}

async function restoreTabsForRoot(
  root: string,
  generation: number,
): Promise<{ tabs: TabModel[]; activePath: string | null } | null> {
  let stored;
  try {
    stored = await getWorkspaceTabs(root);
  } catch {
    return { tabs: [], activePath: null };
  }
  if (!isCurrentWorkspace(root, generation)) {
    return null;
  }
  setRecentFilesForRoot(root, stored.recentFiles);
  const restored: TabModel[] = [];
  const seen = new Set<string>();
  for (const item of stored.tabs) {
    if (item.kind !== "markdown" && item.kind !== "preview") {
      continue;
    }
    const key = `${item.kind}\u0000${item.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (item.kind === "preview") {
      let size = item.size ?? 0;
      try {
        const listing = await listDirectory(parentOfRelative(item.path));
        if (!isCurrentWorkspace(root, generation)) {
          return null;
        }
        const entry = listing.entries.find(
          (candidate) => candidate.path === item.path,
        );
        if (!entry || entry.isDir) {
          continue;
        }
        size = entry.size;
      } catch {
        if (!isCurrentWorkspace(root, generation)) {
          return null;
        }
        continue;
      }
      const tab = makePreviewTab(item.path, absoluteBaseName(item.path), size, {
        generation,
      });
      restored.push(tab);
      continue;
    }
    let text: string;
    try {
      text = await readFile(item.path);
    } catch {
      if (!isCurrentWorkspace(root, generation)) {
        return null;
      }
      continue;
    }
    if (!isCurrentWorkspace(root, generation)) {
      return null;
    }
    let snapshot: EditorRestoreState | null = null;
    if (item.selection !== undefined || item.scrollTopLine !== undefined) {
      snapshot = markRaw({
        selection: (item.selection as SavedSelection | null) ?? null,
        // Undo history is deliberately not restored from disk: it only lives
        // while the app is running.
        history: null,
        scrollTopLine: item.scrollTopLine ?? null,
        scrollTopOffset: item.scrollTopOffset ?? null,
      });
    }
    restored.push(
      makeMarkdownTab("workspace", item.path, absoluteBaseName(item.path), text, {
        generation,
        snapshot,
      }),
    );
  }
  if (!isCurrentWorkspace(root, generation)) {
    return null;
  }
  const active =
    restored.find((tab) => tab.path === stored.active) ?? restored[0] ?? null;
  return { tabs: restored, activePath: active?.path ?? null };
}

async function applyWorkspace(folder: {
  root: string;
  generation: number;
}): Promise<boolean> {
  const context = { root: folder.root, generation: folder.generation };
  const previous = findTab(activeTabId.value);
  const keepSingle = previous?.kind === "single";
  const singles = tabs.value.filter((tab) => tab.kind === "single");
  if (!keepSingle) {
    clearEditor();
  }
  // Visibility changes and the persist debounce must not write the temporary
  // list while the remembered tabs are still being read.
  restoringTabs = true;
  try {
    applyWorkspaceState(folder);
    // A folder is now open; an earlier open-failure notice is stale. Other
    // notices (including their timers) are deliberately left alone.
    clearNotice("folder-open-failure");
    closedTabs.value = [];
    tabs.value = [...singles];
    const restoreStartActiveId = keepSingle ? previous.id : null;
    activeTabId.value = restoreStartActiveId;
    lastWorkspaceActivePath = null;
    const restored = await restoreTabsForRoot(
      context.root,
      context.generation,
    );
    if (
      restored === null ||
      !isCurrentWorkspace(context.root, context.generation)
    ) {
      return false;
    }
    const merged = [...tabs.value];
    const seen = new Set(merged.map(tabKey));
    for (const tab of restored.tabs) {
      // A remembered workspace tab can be the same file the user already
      // opened as a single-file tab before switching to its folder.
      if (
        tab.kind === "workspace" &&
        findOpenTabForWorkspacePathIn(merged, context.root, tab.path) !==
          undefined
      ) {
        continue;
      }
      const key = tabKey(tab);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(tab);
    }
    tabs.value = merged;
    // Leave a tab the user opened or activated during restore in front.
    if (!keepSingle && activeTabId.value === restoreStartActiveId) {
      const currentSingles = merged.filter((tab) => tab.kind === "single");
      const active =
        restored.activePath === null
          ? currentSingles.at(-1) ?? null
          : (merged.find((tab) => tab.path === restored.activePath) ??
            findOpenTabForWorkspacePathIn(
              merged,
              context.root,
              restored.activePath,
            ) ??
            null);
      activeTabId.value = active?.id ?? null;
      if (active !== null && active.kind !== "single") {
        lastWorkspaceActivePath = active.path;
      }
      if (active?.kind === "workspace") {
        rememberRecentWorkspaceFile(context.root, active.path);
      }
      await mountActive(true);
    } else if (keepSingle && lastWorkspaceActivePath === null) {
      lastWorkspaceActivePath = restored.activePath;
    }
    return true;
  } finally {
    restoringTabs = false;
    if (isCurrentWorkspace(context.root, context.generation)) {
      schedulePersistTabs();
    }
  }
}

async function switchToFolder(
  path: string,
  options: { markMissing?: boolean } = {},
): Promise<boolean> {
  if (workspace.value?.root === path) {
    closeOverlaySidebar();
    return true;
  }
  const targetName = absoluteBaseName(path);
  const currentWorkspace = workspace.value;
  const closingTabs = tabs.value.filter(
    (tab) => tab.kind === "workspace" || tab.kind === "preview",
  );
  let hadProblems = false;

  if (currentWorkspace !== null) {
    await saveWorkspaceTabs();
    const problems = closingTabs.flatMap(tabCloseProblems);
    hadProblems = problems.length > 0;
    const choice = await askDialog({
      title: `切换到“${targetName}”`,
      message: `当前文件夹的 ${closingTabs.length} 个标签页会关闭，切回“${rootName.value}”时会恢复这些标签页`,
      details: problems,
      actions: [
        { label: "取消", value: "cancel", autofocus: true },
        {
          label: hadProblems ? "放弃更改并切换" : "切换",
          value: "switch",
          primary: true,
          danger: hadProblems,
        },
      ],
    });
    if (choice !== "switch") {
      return false;
    }
    // The user agreed to discard what could not be saved; the copies for
    // those documents must not outlive this switch. Recovery runs in separate
    // Go goroutines, so wait for deletes and in-flight writes before the
    // generation changes; otherwise Go rejects the late deletes.
    for (const tab of closingTabs) {
      forgetRecoveryForTab(tab);
    }
    if (!(await waitForRecoveryOperations(RECOVERY_OPERATION_TIMEOUT_MS))) {
      void resumeRecoveryCopiesAfterPending(closingTabs);
      showNotice("切换文件夹失败：恢复副本仍在写入", "danger");
      return false;
    }
    await persistTabsNow();
  }

  let folder;
  try {
    folder = await openFolderAtPath(path);
  } catch (error) {
    resumeRecoveryCopies(closingTabs);
    if (isMissingFolderError(error)) {
      if (options.markMissing === true) {
        markMissing(path);
      }
      showNotice("文件夹已不存在", "danger");
    } else {
      showFolderOpenFailure(error);
    }
    return false;
  }
  const applied = await applyWorkspace(folder);
  if (applied) {
    await maybeShowRecoveryDialog();
  }
  return applied;
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
      showFolderOpenFailure(error);
      return false;
    }
    if (picked.canceled) {
      return false;
    }
    return switchToFolder(picked.path);
  });
}

async function openRecentFolder(path: string) {
  const opened = await startFolderOperation(() =>
    switchToFolder(path, { markMissing: true }),
  );
  if (!opened && startState.value) {
    // WebKit does not move focus to a button on click; a failed retry must
    // leave the user on the same enabled recent item.
    emptyState.value?.focusRecentItem(path);
  }
}

async function closeWorkspace() {
  const current = workspace.value;
  if (current === null) {
    return false;
  }
  return startFolderOperation(async () => {
    const closing = [...tabs.value];
    await saveAllTabs();
    const problems = closing.flatMap(tabCloseProblems);
    if (problems.length > 0) {
      const workspaceTabCount = closing.filter(
        (tab) => tab.kind !== "single",
      ).length;
      const singleCount = closing.length - workspaceTabCount;
      let message = `当前文件夹的 ${workspaceTabCount} 个标签页会关闭，下次打开“${rootName.value}”时会恢复这些标签页`;
      if (singleCount > 0) {
        message += `；${singleCount} 个单文件标签页会关闭且不会恢复`;
      }
      const choice = await askDialog({
        title: "关闭工作区？",
        message,
        details: [...new Set(problems)],
        actions: [
          { label: "取消", value: "cancel", autofocus: true },
          {
            label: "放弃更改并关闭工作区",
            value: "close",
            primary: true,
            danger: true,
          },
        ],
      });
      if (choice !== "close") {
        return false;
      }
    }

    // The layout must be written while Go still treats this folder as the
    // current root. It stays in tabs.json for the next open.
    await persistTabsNow();
    for (const tab of closing) {
      forgetRecoveryForTab(tab);
    }
    // Recovery deletes run in separate Go goroutines and are bound to the
    // current generation. Let deletes and in-flight copy writes finish before
    // CloseWorkspace advances it; otherwise a discarded copy survives and is
    // offered again the next time this folder opens. A stuck backend must not
    // close the workspace with copies still in flight.
    if (!(await waitForRecoveryOperations(RECOVERY_OPERATION_TIMEOUT_MS))) {
      void resumeRecoveryCopiesAfterPending(closing);
      showNotice("关闭工作区失败：恢复副本仍在写入", "danger");
      return false;
    }
    try {
      await closeWorkspaceInGo();
    } catch (error) {
      resumeRecoveryCopies(closing);
      showNotice(`关闭工作区失败：${errorText(error)}`, "danger");
      return false;
    }

    for (const tab of closing) {
      if (tab.kind === "single") {
        void releaseSingleFile(tab.path).catch(() => {});
      }
    }
    stopWatch();
    closeCommandPalette();
    closePopoverMenus();
    cancelPersistTimer();
    clearEditor();
    tabs.value = [];
    activeTabId.value = null;
    lastWorkspaceActivePath = null;
    closedTabs.value = [];
    workspace.value = null;
    missingLastFolder.value = null;
    overlaySidebar.value = false;
    dropActive.value = false;
    dragDepth = 0;
    recentFolders.value = [
      current.root,
      ...recentFolders.value.filter((folder) => folder !== current.root),
    ].slice(0, 10);
    await nextTick();
    emptyState.value?.focusOpenFolder();
    return true;
  });
}

/** Re-protects tabs whose copies were removed before a failed close. */
function resumeRecoveryCopies(closing: readonly TabModel[]) {
  for (const tab of closing) {
    const current = findTab(tab.id);
    if (current === null || !needsRecoveryCopy(current)) {
      continue;
    }
    startRecoveryTimer(current.id);
    writeRecoveryCopy(current.id);
  }
}

/**
 * A timed-out close/switch may leave an old delete in flight. Recovery ids are
 * deterministic per kind/root/path, and the write cache suppresses identical
 * text, so rewriting before that delete settles could lose the new copy. Wait
 * for the old operations, reset the cache, then write again.
 */
async function resumeRecoveryCopiesAfterPending(closing: readonly TabModel[]) {
  while (pendingRecoveryOperations.size > 0) {
    await Promise.allSettled([...pendingRecoveryOperations]);
  }
  for (const tab of closing) {
    const state = recoveryWrites.get(tab.id);
    if (state !== undefined) {
      state.written = null;
      state.writtenBaselineUnconfirmed = null;
    }
  }
  resumeRecoveryCopies(closing);
}

async function restoreLastWorkspace() {
  if (workspaceClosed.value) {
    return;
  }
  const last = recentFolders.value[0];
  if (!last) {
    return;
  }
  await startFolderOperation(async () => {
    try {
      const folder = await openFolderAtPath(last);
      const applied = await applyWorkspace(folder);
      if (!applied) {
        return false;
      }
      // Opening the last folder should not move it again; it is already first.
      recentFolders.value = [
        folder.root,
        ...recentFolders.value.filter((item) => item !== folder.root),
      ].slice(0, 10);
      return true;
    } catch (error) {
      if (isMissingFolderError(error)) {
        missingLastFolder.value = last;
        markMissing(last);
      } else {
        showFolderOpenFailure(error);
      }
      return false;
    }
  });
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

function remapTabPath(
  path: string,
  oldPath: string,
  newPath: string,
  isDir: boolean,
): string | null {
  if (!isDir && path === oldPath) {
    return newPath;
  }
  if (isDir && (path === oldPath || path.startsWith(`${oldPath}/`))) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return null;
}

function renameTabPaths(oldPath: string, newPath: string, isDir: boolean) {
  for (const tab of tabs.value) {
    if (tab.kind === "single") {
      continue;
    }
    const updated = remapTabPath(tab.path, oldPath, newPath, isDir);
    if (updated === null) {
      continue;
    }
    const markdown = tab.kind === "workspace";
    if (markdown) {
      // The copy is keyed by path. Move it together with the tab, and let Go
      // fail closed for the new path until it reads or writes that file.
      forgetRecoveryForTab(tab);
    }
    tab.path = updated;
    tab.name = absoluteBaseName(updated);
    if (tab.kind === "preview") {
      tab.previewFolder = previewFolderFor(updated);
    }
    if (markdown && needsRecoveryCopy(tab)) {
      writeRecoveryCopy(tab.id);
    }
  }
  if (lastWorkspaceActivePath !== null) {
    const updated = remapTabPath(
      lastWorkspaceActivePath,
      oldPath,
      newPath,
      isDir,
    );
    if (updated !== null) {
      lastWorkspaceActivePath = updated;
    }
  }
  const root = workspace.value?.root;
  if (root !== undefined) {
    const current = recentFilesForRoot(root);
    const next = normalizeRecentFiles(
      current.flatMap((path) => {
        const updated = remapTabPath(path, oldPath, newPath, isDir);
        if (updated === null) {
          return [path];
        }
        return /\.md$/i.test(updated) ? [updated] : [];
      }),
    );
    if (
      next.length !== current.length ||
      next.some((path, index) => path !== current[index])
    ) {
      recentFilesByRoot.value = {
        ...recentFilesByRoot.value,
        [root]: next,
      };
    }
  }
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

  for (const event of events) {
    if (event.op === "rename" && event.oldPath && event.oldPath !== event.path) {
      renameTabPaths(event.oldPath, event.path, event.isDir);
    } else if (event.op === "remove" && event.path) {
      forgetRecentWorkspacePath(event.path, event.isDir);
    }
  }

  // The path changes above follow an external rename. Only other event kinds
  // can mean that the file content or existence changed.
  const contentEvents = events.filter((event) => event.op !== "rename");
  if (contentEvents.length === 0) {
    schedulePersistTabs();
    return;
  }

  for (const tab of tabs.value.filter((item) => item.kind === "workspace")) {
    const classification = classifyWatchEvents(contentEvents, tab.path, true);
    if (classification.document === "deleted") {
      markExternalState(tab, "deleted");
      clearTabSaveTimer(tab.id);
      continue;
    }
    if (classification.document === "modified") {
      if (tab.externalState === "deleted") {
        markExternalState(tab, "none");
      }
      await handleExternalModification(tab.id);
    }
  }
  schedulePersistTabs();
}

async function handleExternalModification(tabId: number) {
  const tab = findTab(tabId);
  if (tab === null || tab.kind !== "workspace") {
    return;
  }
  if (tab.externalState === "deleted" || tab.externalState === "modified") {
    return;
  }
  if (
    (writesInFlight.get(tabId) ?? 0) > 0 ||
    isDirty(tab) ||
    tab.saveError !== null ||
    tab.mixedLineEndings
  ) {
    markExternalState(tab, "modified");
    clearTabSaveTimer(tabId);
    return;
  }
  const sequence = (externalReadSequence.get(tabId) ?? 0) + 1;
  externalReadSequence.set(tabId, sequence);
  let text: string;
  try {
    text = await readFile(tab.path);
  } catch {
    const current = findTab(tabId);
    if (
      sequence === externalReadSequence.get(tabId) &&
      current !== null &&
      current.kind === "workspace" &&
      current.path === tab.path &&
      current.generation === tab.generation &&
      workspace.value?.generation === current.generation
    ) {
      markExternalState(current, "deleted");
      clearTabSaveTimer(tabId);
    }
    return;
  }
  const current = findTab(tabId);
  if (
    sequence !== externalReadSequence.get(tabId) ||
    current === null ||
    current.kind !== "workspace" ||
    current.path !== tab.path ||
    current.generation !== tab.generation ||
    workspace.value?.generation !== current.generation ||
    current.externalState !== "none"
  ) {
    return;
  }
  if (
    isDirty(current) ||
    current.saveError !== null ||
    (writesInFlight.get(tabId) ?? 0) > 0
  ) {
    markExternalState(current, "modified");
    clearTabSaveTimer(tabId);
    return;
  }
  applyExternalText(current, text);
}

function applyExternalText(tab: TabModel, text: string) {
  const detected = detectLineEndings(text);
  const normalized = normalizeLineEndings(text);
  const active = tab.id === activeTabId.value;
  if (active) {
    applyingExternal = true;
  } else {
    const mapped = mapSnapshotForReplacement(
      tab.snapshot,
      tab.text,
      normalized,
    );
    tab.snapshot = mapped === null ? null : markRaw(mapped);
  }
  tab.lineEnding = detected.ending;
  tab.mixedLineEndings = detected.mixed;
  tab.originalText = normalized;
  tab.text = normalized;
  tab.saveError = null;
  tab.saveErrorDetail = null;
  tab.externalState = "none";
  tab.savePhase = detected.mixed ? "mixed" : "saved";
  tab.restored = false;
  forgetRecoveryForTab(tab);
  if (active && editor !== null) {
    editor.replaceDocument(normalized);
  }
  applyingExternal = false;
  if (active) {
    showNotice("已载入磁盘上的新内容", "success", NOTICE_DURATION_MS);
  }
}

async function loadDiskVersion() {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return;
  }
  if (tab.kind === "single") {
    let text: string;
    try {
      text = await readSingleFile(tab.path);
    } catch (error) {
      showNotice(`读取失败：${errorText(error)}`, "danger");
      return;
    }
    const current = findTab(tab.id);
    if (
      current === null ||
      current.kind !== "single" ||
      current.path !== tab.path
    ) {
      return;
    }
    applyExternalText(current, text);
    current.restored = false;
    forgetRecoveryForTab(current);
    return;
  }
  if (tab.kind !== "workspace") {
    return;
  }
  try {
    const text = await readFile(tab.path);
    const current = findTab(tab.id);
    if (
      current === null ||
      current.kind !== "workspace" ||
      current.path !== tab.path ||
      current.generation !== tab.generation ||
      workspace.value?.generation !== current.generation
    ) {
      return;
    }
    applyExternalText(current, text);
    current.restored = false;
    forgetRecoveryForTab(current);
  } catch (error) {
    const current = findTab(tab.id);
    if (
      current !== null &&
      current.kind === "workspace" &&
      current.path === tab.path &&
      current.generation === tab.generation &&
      workspace.value?.generation === current.generation
    ) {
      showNotice(`读取失败：${errorText(error)}`, "danger");
    }
  }
}

function keepMyVersion() {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return;
  }
  const revision = tab.revision;
  tab.externalState = "none";
  tab.restored = false;
  void saveTab(tab.id, true, revision);
}

async function latestRecoveryItem(
  id: string,
  generation: number,
): Promise<RecoveryItem | null> {
  const listing = await listRecovery(generation);
  return listing.items.find((item) => item.id === id) ?? null;
}

/** Updates only the disk baseline and external state; the text stays put. */
function applyRecoveryDiskChange(tab: TabModel, item: RecoveryItem) {
  clearTabSaveTimer(tab.id);
  clearSavingDisplay(tab.id);
  recoveryTicker.stop(tab.id);
  const missing = item.diskState === "missing";
  const detected = missing
    ? { ending: tab.lineEnding, mixed: false }
    : detectLineEndings(item.diskText);
  tab.originalText = missing ? "" : normalizeLineEndings(item.diskText);
  tab.lineEnding = detected.ending;
  tab.mixedLineEndings = detected.mixed;
  tab.externalState = missing ? "deleted" : "modified";
  tab.restored = false;
  tab.revision += 1;
  tab.savePhase = detected.mixed ? "mixed" : "editing";
}

async function keepRestoredContent() {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return;
  }
  const revision = tab.revision;
  const recoveryId = tab.recoveryId;
  if (recoveryId !== null) {
    const generation = recoveryGeneration();
    let item: RecoveryItem | null;
    try {
      item = await latestRecoveryItem(recoveryId, generation);
    } catch (error) {
      showNotice(`无法确认磁盘状态：${errorText(error)}`, "danger");
      return;
    }
    const current = findTab(tab.id);
    if (current === null || current.recoveryId !== recoveryId) {
      return;
    }
    if (current.revision !== revision || current.externalState !== "none") {
      // A watcher update landed while List was running. Its revision bump
      // makes the force save fail, but do not keep offering a stale decision.
      current.restored = false;
      return;
    }
    if (item !== null) {
      if (!item.restorable) {
        applyRecoveryDiskChange(current, item);
        return;
      }
      if (item.diskState === "missing") {
        applyRecoveryDiskChange(current, item);
        return;
      }
      // The page may have rewritten this copy without a disk hash after an
      // edit, so List reports "changed" even when the disk text is unchanged.
      // originalText is the baseline the user saw when reviewing the copy.
      if (normalizeLineEndings(item.diskText) !== current.originalText) {
        applyRecoveryDiskChange(current, item);
        return;
      }
    }
  }
  tab.restored = false;
  if (tab.savePhase === "paused") {
    tab.savePhase = tab.saveError === null ? "editing" : "failed";
  }
  void saveTab(tab.id, true, revision);
}

async function resaveDeleted() {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return;
  }
  const revision = tab.revision;
  const saved = await saveTab(tab.id, true, revision);
  if (!saved || tab.kind !== "workspace") {
    return;
  }
  // The watcher drops the create event for this app's own write, so the tree
  // would keep hiding the file that just came back. Reload its folder here.
  await sidebar.value?.refreshFolder(parentOfRelative(tab.path));
}

async function handleBannerAction(
  action:
    | "retry"
    | "load-disk"
    | "keep-mine"
    | "resave"
    | "close-tab"
    | "keep-restored"
    | "use-disk",
) {
  switch (action) {
    case "retry":
      if (currentMarkdown.value !== null) {
        await saveTab(currentMarkdown.value.id, true);
      }
      break;
    case "load-disk":
      await loadDiskVersion();
      break;
    case "use-disk":
      await loadDiskVersion();
      break;
    case "keep-mine":
      keepMyVersion();
      break;
    case "keep-restored":
      keepRestoredContent();
      break;
    case "resave":
      await resaveDeleted();
      break;
    case "close-tab":
      if (activeTabId.value !== null) {
        await closeTab(activeTabId.value);
      }
      break;
  }
}

async function confirmCloseTabs(models: readonly TabModel[]): Promise<boolean> {
  if (models.length === 0) {
    return true;
  }
  for (const model of models) {
    if (
      isDirty(model) &&
      model.externalState === "none" &&
      !model.mixedLineEndings
    ) {
      await saveTab(model.id);
    }
  }
  const currentModels = models
    .map((model) => findTab(model.id))
    .filter((model): model is TabModel => model !== null);
  const problems = currentModels.flatMap(tabCloseProblems);
  if (problems.length === 0) {
    return true;
  }
  const single = currentModels.length === 1 ? currentModels[0]! : null;
  const choice = await askDialog({
    title: single ? `关闭“${single.name}”？` : "关闭这些标签页？",
    message: single
      ? "关闭后，这个标签页中未保存的内容会丢失。"
      : "以下标签页中的未保存内容会丢失。",
    details: [...new Set(problems)],
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
  return choice === "close";
}

async function closeTabsById(
  ids: readonly number[],
  options: { record?: boolean } = {},
) {
  const closing = new Set(ids);
  if (closing.size === 0) {
    return;
  }
  const activeBefore = activeTabId.value;
  const activeIndex = tabs.value.findIndex((tab) => tab.id === activeBefore);
  const record = options.record ?? true;
  for (const tab of tabs.value) {
    if (!closing.has(tab.id)) continue;
    clearTabSaveTimer(tab.id);
    clearSavingDisplay(tab.id);
    forgetRecoveryForTab(tab);
    if (tab.kind === "single") {
      void releaseSingleFile(tab.path).catch(() => {});
    } else if (record) {
      const closed: ClosedTab = {
        kind: tab.kind === "preview" ? "preview" : "markdown",
        path: tab.path,
        name: tab.name,
      };
      closedTabs.value = [closed, ...closedTabs.value].slice(0, 20);
    }
  }
  tabs.value = tabs.value.filter((tab) => !closing.has(tab.id));
  if (activeBefore !== null && closing.has(activeBefore)) {
    if (tabs.value.length === 0) {
      activeTabId.value = null;
      clearEditor();
    } else {
      const nextIndex = Math.min(Math.max(activeIndex, 0), tabs.value.length - 1);
      const next = tabs.value[nextIndex]!;
      activeTabId.value = next.id;
      if (next.kind !== "single") {
        lastWorkspaceActivePath = next.path;
      }
      if (next.kind === "workspace" && workspace.value !== null) {
        rememberRecentWorkspaceFile(workspace.value.root, next.path);
      }
      await mountActive(true);
    }
  }
  schedulePersistTabs();
}

async function closeTab(id: number) {
  const tab = findTab(id);
  if (tab === null) {
    return;
  }
  if (!(await confirmCloseTabs([tab]))) {
    return;
  }
  await closeTabsById([id]);
}

async function closeActiveTab() {
  if (activeTabId.value !== null) {
    await closeTab(activeTabId.value);
  }
}

async function closeOtherTabs(id: number) {
  const targets = tabs.value.filter((tab) => tab.id !== id);
  if (!(await confirmCloseTabs(targets))) {
    return;
  }
  await closeTabsById(targets.map((tab) => tab.id));
}

async function closeTabsRight(id: number) {
  const index = tabs.value.findIndex((tab) => tab.id === id);
  if (index === -1) {
    return;
  }
  const targets = tabs.value.slice(index + 1);
  if (!(await confirmCloseTabs(targets))) {
    return;
  }
  await closeTabsById(targets.map((tab) => tab.id));
}

async function closeAllTabs() {
  const targets = [...tabs.value];
  if (!(await confirmCloseTabs(targets))) {
    return;
  }
  await closeTabsById(targets.map((tab) => tab.id));
}

async function reopenClosedTab() {
  const context = currentWorkspaceContext();
  if (context === null) {
    return;
  }
  const stillCurrent = () =>
    isCurrentWorkspace(context.root, context.generation);
  while (closedTabs.value.length > 0) {
    const closed = closedTabs.value.shift()!;
    const existing = tabs.value.find(
      (tab) => tab.kind !== "single" && tab.path === closed.path,
    );
    if (existing) {
      await activateTab(existing.id);
      return;
    }
    if (closed.kind === "preview") {
      let entry: { path: string; name: string; size: number } | null = null;
      try {
        const listing = await listDirectory(parentOfRelative(closed.path));
        if (!stillCurrent()) {
          return;
        }
        const found = listing.entries.find(
          (candidate) => candidate.path === closed.path && !candidate.isDir,
        );
        if (found) {
          entry = { path: found.path, name: found.name, size: found.size };
        }
      } catch {
        if (!stillCurrent()) {
          return;
        }
        entry = null;
      }
      if (entry !== null) {
        await openPreviewEntry(entry, { context });
        return;
      }
      continue;
    }
    if (
      await openWorkspaceFile(closed.path, absoluteBaseName(closed.path), {
        silent: true,
        reveal: false,
      })
    ) {
      return;
    }
    if (!stillCurrent()) {
      return;
    }
  }
  if (stillCurrent()) {
    showNotice("没有可重新打开的标签页", "muted");
  }
}

async function openSingleFile(
  path: string,
  name: string,
): Promise<boolean> {
  const context = currentWorkspaceContext();
  if (context !== null && isInFolder(context.root, path)) {
    return openWorkspaceFile(relativePath(context.root, path), name);
  }
  const existing = tabs.value.find(
    (tab) => tab.kind === "single" && tab.path === path,
  );
  if (existing) {
    await activateTab(existing.id);
    return true;
  }
  const key = openingKey("single", path);
  const pending = openingTabs.get(key);
  if (pending !== undefined) {
    return pending;
  }

  const task = (async (): Promise<boolean> => {
    let file;
    try {
      file = await acceptSingleFile(path);
    } catch (error) {
      showNotice(`无法打开文件：${errorText(error)}`, "danger");
      return false;
    }
    const alreadyOpen = tabs.value.find(
      (tab) => tab.kind === "single" && tab.path === file.path,
    );
    if (alreadyOpen) {
      await activateTab(alreadyOpen.id);
      return true;
    }
    let text: string;
    try {
      text = await readSingleFile(file.path);
    } catch (error) {
      const current = tabs.value.find(
        (tab) => tab.kind === "single" && tab.path === file.path,
      );
      if (current === undefined) {
        void releaseSingleFile(file.path).catch(() => {});
        showNotice(`读取失败：${errorText(error)}`, "danger");
      }
      return false;
    }
    const current = tabs.value.find(
      (tab) => tab.kind === "single" && tab.path === file.path,
    );
    if (current) {
      await activateTab(current.id);
      return true;
    }
    const tab = makeMarkdownTab(
      "single",
      file.path,
      file.name || name,
      text,
    );
    insertTab(tab);
    await activateTab(tab.id);
    return true;
  })();

  openingTabs.set(key, task);
  try {
    return await task;
  } finally {
    if (openingTabs.get(key) === task) {
      openingTabs.delete(key);
    }
  }
}

async function openPreviewDefault() {
  const tab = currentPreview.value;
  if (!tab || !workspace.value) {
    return;
  }
  try {
    await openWithDefaultApp(tab.path, workspace.value.generation);
  } catch (error) {
    showNotice(`打开失败：${errorText(error)}`, "danger");
  }
}

async function revealPreview() {
  const tab = currentPreview.value;
  if (!tab || !workspace.value) {
    return;
  }
  try {
    await revealEntry(tab.path, workspace.value.generation);
  } catch (error) {
    showNotice(`无法显示：${errorText(error)}`, "danger");
  }
}

function collapseAllFolders() {
  const current = workspace.value;
  if (current === null) {
    return;
  }
  const mounted = sidebar.value;
  if (mounted !== null) {
    mounted.collapseAll();
    return;
  }
  expandedByRoot.value = {
    ...expandedByRoot.value,
    [current.root]: [],
  };
  void setExpandedFolders(current.root, []).catch(() => {});
}

async function revealWorkspace() {
  const current = workspace.value;
  if (current === null) {
    return;
  }
  try {
    await revealEntry(".", current.generation);
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
  const context = currentWorkspaceContext();
  if (context === null || !isInFolder(context.root, path)) {
    await askOpenSingleFile(path);
    return;
  }
  const rel = relativePath(context.root, path);
  if (/\.md$/i.test(path)) {
    await openWorkspaceFile(rel, absoluteBaseName(path));
    return;
  }
  let size = 0;
  try {
    const listing = await listDirectory(parentOfRelative(rel));
    if (!isCurrentWorkspace(context.root, context.generation)) {
      return;
    }
    size = listing.entries.find((entry) => entry.path === rel)?.size ?? 0;
  } catch {
    if (!isCurrentWorkspace(context.root, context.generation)) {
      return;
    }
    // A stale file still opens as an empty preview.
  }
  await openPreviewEntry(
    { path: rel, name: absoluteBaseName(path), size },
    { context },
  );
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
      // The recovery decision comes first; otherwise askOpenSingleFile could
      // stack another modal on top of it.
      while (recoveryDialog.value !== null) {
        const wait = recoveryClosed;
        if (wait === null) {
          return;
        }
        await wait;
      }
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

/** Runs one registered app command with the current page context. */
function runAppCommand(id: string): boolean {
  const command = getCommand(id);
  if (
    command === undefined ||
    !isCommandAvailable(command) ||
    command.scope !== "app"
  ) {
    return false;
  }
  if (!commandContextAllows(command)) {
    return false;
  }
  return command.run(commandContext(editor?.view ?? null));
}

/** Runs a command requested by native chrome, honouring modal guards. */
function runChromeCommand(id: string) {
  if (dialogOpen || recoveryDialog.value !== null) {
    return;
  }
  runAppCommand(id);
}

/** Runs a command the native menu asked for, under the page's own guards. */
function handleRunCommand(event: Event) {
  const id = (event as CustomEvent<unknown>).detail;
  if (typeof id !== "string") {
    return;
  }
  runChromeCommand(id);
}

function dragHasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function handleDragEnter(event: DragEvent) {
  if (!startState.value || !dragHasFiles(event)) {
    return;
  }
  event.preventDefault();
  dragDepth += 1;
  dropActive.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!startState.value || !dragHasFiles(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = "copy";
  }
  dropActive.value = true;
}

function handleDragLeave() {
  if (!startState.value) {
    return;
  }
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropActive.value = false;
  }
}

function handleDomDrop(event: DragEvent) {
  if (!startState.value) {
    return;
  }
  event.preventDefault();
  dragDepth = 0;
  dropActive.value = false;
}

async function handleFolderDrop(drop: AssetDrop) {
  if (
    !startState.value ||
    dialogOpen ||
    recoveryDialog.value !== null ||
    recoveryChecking
  ) {
    return;
  }
  dropActive.value = false;
  if (drop.folderToken === undefined) {
    showNotice("只能拖入一个文件夹", "muted");
    return;
  }
  await startFolderOperation(async () => {
    let folder;
    try {
      folder = await openDroppedFolderInGo(drop.folderToken!);
    } catch (error) {
      showFolderOpenFailure(error);
      return false;
    }
    const applied = await applyWorkspace(folder);
    if (applied) {
      await maybeShowRecoveryDialog();
    }
    return applied;
  });
}

function setMode(next: EditorMode) {
  mode.value = next;
  editor?.setMode(next);
  editor?.focus();
}

function activateCurrentTab() {
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

function closePopoverMenus() {
  slashMenu?.close();
  topBar.value?.closeModeMenu();
}

function closePalettePopovers() {
  closePopoverMenus();
  overlaySidebar.value = false;
}

function extractPaletteHeadings(): HeadingExtraction {
  const tab = currentMarkdown.value;
  const activeEditor = tab !== null ? editor : null;
  if (activeEditor === null) {
    return { headings: [], complete: true };
  }
  return extractHeadingsWithStatus(activeEditor.view.state);
}

function openCommandPalette(mode: CommandPaletteMode) {
  if (
    dialogOpen ||
    recoveryDialog.value !== null ||
    recoveryChecking ||
    paletteSession.value !== null ||
    document.querySelector('[role="dialog"][aria-modal="true"]') !== null
  ) {
    return;
  }
  closePalettePopovers();
  const tab = currentMarkdown.value;
  const activeEditor = tab !== null ? editor : null;
  const headingResult =
    mode === "heading" ? extractPaletteHeadings() : null;
  paletteSession.value = {
    mode,
    tabId: tab?.id ?? null,
    doc: activeEditor?.view.state.doc ?? null,
    selection:
      activeEditor === null
        ? null
        : (activeEditor.view.state.selection.toJSON() as SavedSelection),
    headings: headingResult?.headings ?? [],
    headingsLoaded: mode === "heading" || activeEditor === null,
    headingsTruncated:
      headingResult !== null && headingResult.complete === false,
    recentFiles: [...recentFilesForRoot(workspace.value?.root ?? "")],
    recentCommandIds: readRecentCommandIds(),
  };
}

/**
 * Headings are extracted only when the panel first enters heading mode. That
 * keeps opening the command and file modes from blocking on a large document,
 * and the result stays cached for this panel session.
 */
function handlePaletteModeChange(mode: CommandPaletteMode) {
  const session = paletteSession.value;
  if (session === null) return;
  const switched =
    session.mode === mode ? session : { ...session, mode };
  if (mode !== "heading" || session.headingsLoaded) {
    if (switched !== session) {
      paletteSession.value = switched;
    }
    return;
  }
  const result = extractPaletteHeadings();
  paletteSession.value = {
    ...switched,
    headings: result.headings,
    headingsLoaded: true,
    headingsTruncated: !result.complete,
  };
}

function paletteModeForShortcut(
  event: KeyboardEvent,
): CommandPaletteMode | null {
  const command = matchCommand(event, platform.value, commandRegistry, "app");
  switch (command?.id) {
    case "nav.quick-open":
      return "file";
    case "nav.command-palette":
      return "command";
    case "nav.goto-heading":
      return "heading";
    default:
      return null;
  }
}


function closeCommandPalette() {
  paletteSession.value = null;
}

function restorePaletteEditor(session: PaletteSession) {
  if (
    session.tabId === null ||
    activeTabId.value !== session.tabId ||
    editor === null
  ) {
    return null;
  }
  const view = editor.view;
  // Positions captured when the panel opened are stale if the document was
  // replaced or edited externally. Do not write them into the new document.
  if (session.doc === null || view.state.doc !== session.doc) {
    return null;
  }
  view.focus();
  if (session.selection !== null) {
    const length = view.state.doc.length;
    const clamp = (position: number) =>
      Math.max(0, Math.min(length, Math.trunc(position)));
    const ranges = session.selection.ranges.map((range) =>
      EditorSelection.range(
        clamp(range.anchor),
        clamp(range.head ?? range.anchor),
      ),
    );
    if (ranges.length > 0) {
      const main = Math.max(
        0,
        Math.min(ranges.length - 1, session.selection.main),
      );
      view.dispatch({ selection: EditorSelection.create(ranges, main) });
    }
  }
  return view;
}

function commandContext(view: CommandContext["view"]): CommandContext {
  return {
    view,
    platform: platform.value,
    app: {
      chooseFolder: () => {
        void chooseFolder();
      },
      newFile: () => {
        void newFile();
      },
      saveCurrent: () => {
        const tab = currentMarkdown.value;
        if (tab !== null) {
          void saveTab(tab.id);
        }
      },
      toggleSidebar,
      setMode,
      toggleTheme: () => {
        void toggleTheme();
      },
      closeActiveTab: () => {
        void closeActiveTab();
      },
      closeWorkspace: () => {
        void closeWorkspace();
      },
      collapseAllFolders,
      revealWorkspace: () => {
        void revealWorkspace();
      },
      reopenClosedTab: () => {
        void reopenClosedTab();
      },
      nextTab: () => {
        cycleTab(1);
      },
      previousTab: () => {
        cycleTab(-1);
      },
      openCommandPalette,
    },
  };
}

async function runPaletteCommand(id: string) {
  const session = paletteSession.value;
  if (session === null) return;
  closeCommandPalette();
  await nextTick();
  const command = getCommand(id);
  if (command === undefined || !isCommandAvailable(command)) {
    return;
  }
  if (!commandContextAllows(command)) {
    return;
  }
  if (command.scope === "file-tree") {
    return;
  }
  const view =
    command.scope === "editor" ? restorePaletteEditor(session) : null;
  if (command.scope === "editor" && view === null) {
    return;
  }
  const handled = command.run(commandContext(view));
  if (handled) {
    rememberRecentCommandId(command.id);
  }
}

async function openPaletteFile(path: string) {
  closeCommandPalette();
  await nextTick();
  if (workspace.value === null) return;
  await openWorkspaceFile(path, absoluteBaseName(path));
}

async function jumpToPaletteHeading(position: number) {
  const session = paletteSession.value;
  if (session === null) return;
  closeCommandPalette();
  await nextTick();
  if (
    session.tabId === null ||
    activeTabId.value !== session.tabId ||
    editor === null
  ) {
    return;
  }
  const view = editor.view;
  if (session.doc === null || view.state.doc !== session.doc) {
    return;
  }
  const at = Math.max(0, Math.min(view.state.doc.length, position));
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "start" }),
  });
  view.focus();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  noteCompositionEndKey(event);
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (dialogOpen || recoveryDialog.value !== null) {
    return;
  }
  if (paletteSession.value !== null) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    const nextMode = paletteModeForShortcut(event);
    if (nextMode !== null) {
      event.preventDefault();
      palette.value?.switchMode(nextMode);
    }
    return;
  }
  if (event.key === "Escape") {
    if (overlaySidebar.value) {
      event.preventDefault();
      overlaySidebar.value = false;
    }
    return;
  }
  if (event.defaultPrevented || isTextInput(event.target)) {
    return;
  }
  const command = matchCommand(event, platform.value, commandRegistry, "app");
  if (command === null) {
    return;
  }
  if (!commandContextAllows(command)) {
    // The command stays registered for its shortcut, but it is not runnable
    // here. Swallow the key so it does not reach WebView/system defaults.
    event.preventDefault();
    return;
  }
  const handled = command.run(commandContext(editor?.view ?? null));
  if (handled) {
    event.preventDefault();
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

async function handleEntryRenamed(
  oldPath: string,
  newPath: string,
  isDir: boolean,
) {
  if (recentSelfRename?.oldPath === oldPath) {
    recentSelfRename.newPath = newPath;
    recentSelfRename.at = Date.now();
  }
  renameTabPaths(oldPath, newPath, isDir);
  schedulePersistTabs();
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
  await sidebar.value?.removePath(entry.path);
  const affected = tabs.value.filter(
    (tab) =>
      tab.kind !== "single" &&
      (tab.path === entry.path ||
        (entry.isDir && tab.path.startsWith(`${entry.path}/`))),
  );
  const previewIds = affected
    .filter((tab) => tab.kind === "preview")
    .map((tab) => tab.id);
  for (const tab of affected) {
    if (tab.kind === "workspace") {
      markExternalState(tab, "deleted");
      clearTabSaveTimer(tab.id);
    }
  }
  if (previewIds.length > 0) {
    await closeTabsById(previewIds, { record: false });
  }
  schedulePersistTabs();
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

function storedTabsPayload(): {
  tabs: StoredTab[];
  active: string;
  recentFiles: string[];
} {
  const workspaceTabs = tabs.value.filter((tab) => tab.kind !== "single");
  const activePath =
    lastWorkspaceActivePath !== null &&
    workspaceTabs.some((tab) => tab.path === lastWorkspaceActivePath)
      ? lastWorkspaceActivePath
      : workspaceTabs[0]?.path ?? "";
  const stored: StoredTab[] = workspaceTabs.map((tab) => {
    if (tab.kind === "preview") {
      return { kind: "preview", path: tab.path, size: tab.previewSize ?? 0 };
    }
    const snapshot =
      tab.id === activeTabId.value && editor !== null
        ? editor.getRestoreState()
        : tab.snapshot;
    const clean = tab.text === tab.originalText;
    return {
      kind: "markdown",
      path: tab.path,
      selection: clean ? snapshot?.selection ?? undefined : undefined,
      scrollTopLine: snapshot?.scrollTopLine ?? undefined,
      scrollTopOffset: snapshot?.scrollTopOffset ?? undefined,
    };
  });
  return {
    tabs: stored,
    active: activePath,
    recentFiles: recentFilesForRoot(workspace.value?.root ?? ""),
  };
}

function cancelPersistTimer() {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

async function persistTabsNow(): Promise<void> {
  cancelPersistTimer();
  if (restoringTabs) {
    return;
  }
  const current = workspace.value;
  if (current === null) {
    return;
  }
  const payload = storedTabsPayload();
  try {
    await saveTabsForRoot(
      current.root,
      payload.tabs,
      payload.active,
      payload.recentFiles,
    );
  } catch {
    // Remembering tabs is best effort; editing must keep working.
  }
}

function schedulePersistTabs() {
  if (restoringTabs) {
    return;
  }
  cancelPersistTimer();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistTabsNow();
  }, PERSIST_TABS_DELAY_MS);
}

async function openTabMenu(id: number, x: number, y: number) {
  const tab = findTab(id);
  if (tab === null) {
    return;
  }
  const index = tabs.value.findIndex((item) => item.id === id);
  const items = buildContextMenu({
    target: "tab",
    platform: platform.value,
    isMarkdown: tab.kind !== "preview",
    inWorkspace: tab.kind !== "single",
    hasOtherTabs: tabs.value.length > 1,
    hasTabsRight: index !== -1 && index < tabs.value.length - 1,
    canReopen: closedTabs.value.length > 0,
  });
  let choice = "";
  try {
    choice = await popupNativeMenu({
      x: Math.round(x),
      y: Math.round(y),
      items,
    });
  } catch (error) {
    showNotice(`菜单打开失败：${errorText(error)}`, "danger");
    return;
  }
  if (choice === "") {
    return;
  }
  const currentTab = findTab(id);
  if (currentTab === null) {
    return;
  }
  switch (choice) {
    case "close-tab":
      await closeTab(id);
      break;
    case "close-other-tabs":
      await closeOtherTabs(id);
      break;
    case "close-tabs-right":
      await closeTabsRight(id);
      break;
    case "close-all-tabs":
      await closeAllTabs();
      break;
    case "reopen-tab":
      await reopenClosedTab();
      break;
    case "reveal-in-tree":
      await activateTab(id);
      if (!sidebarShown.value) {
        if (isWide.value) {
          sidebarOpen.value = true;
        } else {
          overlaySidebar.value = true;
        }
      }
      await nextTick();
      if (currentTab.kind !== "single") {
        await sidebar.value?.reveal(currentTab.path);
      }
      break;
    case "reveal":
      try {
        if (currentTab.kind === "single") {
          await revealSingleFile(currentTab.path);
        } else if (workspace.value !== null) {
          await revealEntry(currentTab.path, workspace.value.generation);
        }
      } catch (error) {
        showNotice(`无法显示：${errorText(error)}`, "danger");
      }
      break;
    case "copy-path": {
      const absolute =
        currentTab.kind === "single"
          ? currentTab.path
          : `${workspace.value?.root ?? ""}/${currentTab.path}`;
      if (!(await copyText(absolute))) {
        showNotice("复制失败", "danger");
      }
      break;
    }
    case "copy-relative-path":
      if (currentTab.kind !== "single") {
        if (!(await copyText(currentTab.path))) {
          showNotice("复制失败", "danger");
        }
      }
      break;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    writeAllRecoveryCopies();
    void saveAllTabs();
    void persistTabsNow();
  }
}

function saveBeforeExit() {
  writeAllRecoveryCopies();
  void saveAllTabs();
  void persistTabsNow();
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
  window.addEventListener("nicole:run-command", handleRunCommand);
  offOpenFile = onOpenFile(() => {
    if (!appReady) {
      pendingOpenSignal = true;
      return;
    }
    void receiveOpenedFiles();
  });
  offFileDrop = onWindowFileDrop((drop) => {
    imageInsertion.handleDrop(drop);
    void handleFolderDrop(drop);
  });
  offSaveBeforeClose = onSaveBeforeClose(async (token) => {
    const started = Date.now();
    cancelOpenDialog();
    writeAllRecoveryCopies();
    await nextTick();
    const saved = await saveAllTabs();
    await persistTabsNow();
    // Give the copy writes and deletes a short window to finish, while
    // keeping room inside Go's five-second close timeout.
    const remaining = Math.max(
      0,
      Math.min(
        1000,
        RECOVERY_OPERATION_TIMEOUT_MS - (Date.now() - started) - 100,
      ),
    );
    await waitForRecoveryOperations(remaining);
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
    await maybeShowRecoveryDialog();
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
  window.removeEventListener("nicole:run-command", handleRunCommand);
  offOpenFile?.();
  offOpenFile = null;
  offFileDrop?.();
  offFileDrop = null;
  offSaveBeforeClose?.();
  offSaveBeforeClose = null;
  stopWatch();
  cancelPersistTimer();
  writeAllRecoveryCopies();
  for (const id of [...saveTimers.keys()]) {
    clearTabSaveTimer(id);
  }
  for (const id of [...savingTimers.keys()]) {
    clearSavingDisplay(id);
  }
  recoveryTicker.stopAll();
  if (noticeTimer !== null) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  void saveAllTabs();
  void persistTabsNow();
  clearEditor();
});

defineExpose({
  chooseFolder,
  closeWorkspace,
  openWorkspaceFile,
  openSingleFile,
  openCommandPalette,
  handleWatchEvents,
});
</script>

<template>
  <div
    class="relative flex h-full min-h-0 overflow-hidden bg-[var(--surface-canvas)] text-[var(--text-primary)]"
    :style="{ '--sidebar-width': `${sidebarWidth}px` }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDomDrop"
  >
    <AppSidebar
      v-if="sidebarShown && workspace"
      ref="sidebar"
      :width="sidebarWidth"
      :mode="isWide ? 'pinned' : 'overlay'"
      :platform="platform"
      :root-name="rootName"
      :root-path="workspace.root"
      :generation="workspace.generation"
      :selected-path="selectedTreePath"
      :initial-expanded="expandedForRoot"
      :is-dark="isDark"
      @hide-sidebar="toggleSidebar"
      @open-folder="chooseFolder"
      @toggle-theme="toggleTheme"
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
      @run-command="runChromeCommand"
      @status="(message) => showNotice(message, 'danger')"
    />

    <div
      class="flex min-w-0 flex-1 flex-col"
      @pointerdown.capture="handleContentPointerDown"
    >
      <TopBar
        ref="topBar"
        :tabs="topBarTabs"
        :active-tab-id="activeTabId"
        :mode="mode"
        :platform="platform"
        :compact="isCompactTopBar"
        :sidebar-shown="sidebarShown"
        :show-sidebar-toggle="showSidebarToggle"
        :show-open-folder="!hasWorkspace && tabs.length > 0"
        :show-outline="!startState"
        :outline-enabled="false"
        :outline-on="false"
        @close-tab="closeTab"
        @activate-tab="activateTab"
        @tab-menu="openTabMenu"
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
          <div class="relative isolate min-h-0 flex-1" data-editor-host>
            <EmptyState
              v-if="startState"
              ref="emptyState"
              mode="start"
              :recent-folders="recentFolders"
              :missing-folders="missingRecent"
              :missing-last-folder="missingLastFolder"
              :home-dir="homeDir"
              :platform="platform"
              :drop-active="dropActive"
              @open-folder="chooseFolder"
              @open-recent="openRecentFolder"
              @remove-recent="removeRecent"
              @new-file="newFile"
              @quick-open="openCommandPalette('file')"
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
              @quick-open="openCommandPalette('file')"
            />
            <NonMarkdownPlaceholder
              v-else-if="currentPreview"
              :name="currentPreview.name"
              :size="currentPreview.previewSize ?? 0"
              :folder="currentPreview.previewFolder ?? ''"
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
        :notice-detail="notice?.detail"
        :start-theme="startState"
        :is-dark="isDark"
        @toggle-theme="toggleTheme"
      />
    </div>

    <SlashMenu
      v-if="slashState"
      :state="slashState"
      @select="executeSlashCommand"
      @highlight="highlightSlashCommand"
    />

    <CommandPalette
      v-if="paletteSession"
      ref="palette"
      :mode="paletteSession.mode"
      :platform="platform"
      :commands="paletteCommands"
      :workspace-open="hasWorkspace"
      :recent-files="paletteSession.recentFiles"
      :recent-command-ids="paletteSession.recentCommandIds"
      :headings="paletteSession.headings"
      :headings-truncated="paletteSession.headingsTruncated"
      :has-markdown="isMarkdownOpen"
      :load-files="listFiles"
      @close="closeCommandPalette"
      @mode-change="handlePaletteModeChange"
      @run-command="runPaletteCommand"
      @open-file="openPaletteFile"
      @jump-heading="jumpToPaletteHeading"
    />

    <RecoveryDialog
      :open="recoveryDialog !== null"
      :items="recoveryDialog?.items ?? []"
      :other-folders="recoveryDialog?.otherFolders ?? 0"
      @discard="discardRecoveryCopies"
      @review="finishRecovery('review')"
      @restore="finishRecovery('restore')"
    />

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
                : 'button-primary'
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
