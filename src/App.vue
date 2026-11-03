<script setup lang="ts">
import { EditorSelection } from "@codemirror/state";
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
import type { CommandContext } from "./commands/types";
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
import { onWindowFileDrop } from "./services/assets";
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
  getWorkspaceTabs,
  saveWorkspaceTabs as saveTabsForRoot,
  type StoredTab,
} from "./services/tabs";
import type { WorkspaceFileEvent } from "./services/mygo";
import {
  finishClose,
  listFiles,
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
const PERSIST_TABS_DELAY_MS = 400;

interface WorkspaceState {
  root: string;
  generation: number;
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

interface ClosedTab {
  kind: "markdown" | "preview";
  path: string;
  name: string;
}

interface PaletteSession {
  mode: CommandPaletteMode;
  tabId: number | null;
  selection: SavedSelection | null;
  headings: DocumentHeading[];
  headingsLoaded: boolean;
  headingsTruncated: boolean;
  recentFiles: string[];
  recentCommandIds: string[];
}

const editorHost = ref<HTMLElement | null>(null);
const sidebar = ref<InstanceType<typeof AppSidebar> | null>(null);
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
let dialogResolve: ((value: string) => void) | null = null;
let dialogOpen = false;
let folderOperation: Promise<boolean> | null = null;

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
const savingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const writesInFlight = new Map<number, number>();
const externalReadSequence = new Map<number, number>();
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

const paletteCommands = computed(() =>
  commandRegistry.filter(
    (command) =>
      isCommandAvailable(command) &&
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
const rootDisplayPath = computed(() =>
  workspace.value ? displayPath(workspace.value.root, homeDir.value) : "",
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

function markExternalState(tab: TabModel, next: "none" | "modified" | "deleted") {
  tab.externalState = next;
  tab.revision += 1;
}

function handleEditorChange(tabId: number, text: string) {
  const tab = findTab(tabId);
  if (tab === null) {
    return;
  }
  tab.text = text;
  if (applyingExternal) {
    return;
  }
  if (tab.text === tab.originalText) {
    clearTabSaveTimer(tabId);
    if (tab.savePhase !== "failed" && tab.savePhase !== "saving") {
      tab.savePhase = "saved";
    }
    return;
  }
  if (tab.mixedLineEndings) {
    clearTabSaveTimer(tabId);
    tab.savePhase = "mixed";
    return;
  }
  tab.savePhase = tab.saveError === null ? "editing" : "failed";
  clearTabSaveTimer(tabId);
  saveTimers.set(
    tabId,
    setTimeout(() => {
      saveTimers.delete(tabId);
      void saveTab(tabId);
    }, AUTOSAVE_DELAY_MS),
  );
}

function saveTab(
  tabId: number,
  force = false,
  revisionAtRequest?: number,
): Promise<boolean> {
  const tab = findTab(tabId);
  if (tab === null) {
    return Promise.resolve(true);
  }
  const revision = revisionAtRequest ?? tab.revision;
  const next = saveQueue.then(() => saveTabNow(tabId, force, revision));
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
): Promise<boolean> {
  let tab = findTab(tabId);
  if (tab === null) {
    return true;
  }
  if (force && tab.revision !== revisionAtRequest) {
    return stopForcedSave(tabId);
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

async function switchToFolder(path: string): Promise<boolean> {
  if (workspace.value?.root === path) {
    closeOverlaySidebar();
    return true;
  }
  const targetName = absoluteBaseName(path);
  const currentWorkspace = workspace.value;
  let hadProblems = false;

  if (currentWorkspace !== null) {
    const closingTabs = tabs.value.filter(
      (tab) => tab.kind === "workspace" || tab.kind === "preview",
    );
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
    await persistTabsNow();
  }

  let folder;
  try {
    folder = await openFolderAtPath(path);
  } catch (error) {
    showNotice(`打开失败：${errorText(error)}`, "danger");
    return false;
  }
  return applyWorkspace(folder);
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
    } catch {
      missingLastFolder.value = last;
      markMissing(last);
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
    tab.path = updated;
    tab.name = absoluteBaseName(updated);
    if (tab.kind === "preview") {
      tab.previewFolder = previewFolderFor(updated);
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
  if (tab?.kind !== "workspace") {
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
  void saveTab(tab.id, true, revision);
}

async function resaveDeleted() {
  const tab = currentMarkdown.value;
  if (tab === null) {
    return;
  }
  const revision = tab.revision;
  await saveTab(tab.id, true, revision);
}

async function handleBannerAction(
  action: "retry" | "load-disk" | "keep-mine" | "resave" | "close-tab",
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
    case "keep-mine":
      keepMyVersion();
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

function closePalettePopovers() {
  slashMenu?.close();
  topBar.value?.closeModeMenu();
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
  const at = Math.max(0, Math.min(view.state.doc.length, position));
  view.dispatch({
    selection: { anchor: at },
    effects: EditorView.scrollIntoView(at, { y: "start" }),
  });
  view.focus();
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (dialogOpen) {
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
  sidebar.value?.removePath(entry.path);
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
    void saveAllTabs();
    void persistTabsNow();
  }
}

function saveBeforeExit() {
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
    const saved = await saveAllTabs();
    await persistTabsNow();
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
  cancelPersistTimer();
  for (const id of [...saveTimers.keys()]) {
    clearTabSaveTimer(id);
  }
  for (const id of [...savingTimers.keys()]) {
    clearSavingDisplay(id);
  }
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
