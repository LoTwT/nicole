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
  watch,
  watchEffect,
} from "vue";

import {
  normalizeRecentFiles,
  rememberRecentFilePath,
  type CommandPaletteMode,
} from "./app/command-palette";
import { buildContextMenu } from "./app/context-menu";
import { classifyLinkDestination, findHeadingByFragment } from "./app/link-navigation";
import { outlinePlacement } from "./app/outline";
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
  EMPTY_FORMAT_TOOLBAR_STATE,
  formatToolbarStateFor,
  type FormatToolbarState,
} from "./commands/format";
import {
  commandRegistry,
  getCommand,
  isCommandAvailable,
  nativeAccelerator,
  slashCommands as slashCommandList,
} from "./commands/registry";
import { createSnippetCommands } from "./commands/snippets";
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
  isDocumentTab,
  isEditableTab,
  mapSnapshotForReplacement,
  tabBadge,
  tabCloseProblems,
  tabTooltip,
  type DocumentTabModel,
  type SettingsTabModel,
  type TabModel,
} from "./app/tabs";
import {
  customFontStack,
  CODE_FONT_FALLBACK,
  READING_FONT_FALLBACK,
  UI_FONT_FALLBACK,
  fileDisplayName,
  type FontField,
  type SlashMode,
} from "./app/settings-display";
import { ESCAPE_HELP } from "./app/shortcut-help";
import { classifyWatchEvents } from "./app/watch-events";
import {
  locateSearchMatch,
  type SearchOpenTarget,
} from "./app/workspace-search";
import type { TreeNode } from "./app/file-tree";
import AppBanner from "./components/AppBanner.vue";
import AppDialog from "./components/AppDialog.vue";
import RecoveryDialog from "./components/RecoveryDialog.vue";
import AppSidebar from "./components/AppSidebar.vue";
import CommandPalette from "./components/CommandPalette.vue";
import EmptyState from "./components/EmptyState.vue";
import FindReplacePanel from "./components/FindReplacePanel.vue";
import FormatToolbar from "./components/FormatToolbar.vue";
import LinkImageEditor from "./components/LinkImageEditor.vue";
import NonMarkdownPlaceholder from "./components/NonMarkdownPlaceholder.vue";
import Outline from "./components/Outline.vue";
import SettingsView from "./components/SettingsView.vue";
import SlashMenu from "./components/SlashMenu.vue";
import StatusBar from "./components/StatusBar.vue";
import TopBar, { type TopBarTab } from "./components/TopBar.vue";
import {
  createEditor,
  type EditorHandle,
  type EditorMode,
  type EditorRestoreState,
  type FindReplaceController,
  type FindReplaceOptions,
  type LinkImageEditorSession,
  type LinkImageFieldValues,
  type SavedSelection,
} from "./editor";
import { EMPTY_FIND_OPTIONS } from "./editor/find";
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
import { resolveImageUrl, resolveLocalImagePath } from "./image-url";
import { getAppInfo, openExternalURL, type AppInfo } from "./services/app";
import { onWindowFileDrop, type AssetDrop } from "./services/assets";
import { copyText } from "./services/clipboard";
import {
  listDirectory,
  openWithDefaultApp,
  revealEntry,
  revealImage,
  trashEntry,
} from "./services/files";
import { popupNativeMenu, setSettingsAccelerator } from "./services/menu";
import { onOpenFile, takePendingOpenedEntries } from "./services/open-file";
import {
  getSettings,
  migrateLegacyTheme,
  setEditorMode,
  setExpandedFolders,
  setFonts,
  setHideMarkdownExtension,
  setOutlineVisible,
  setFormatToolbarVisible as persistFormatToolbarVisible,
  setShowAllFiles,
  setSidebarWidth,
  setSlashEnabled,
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
  listSnippets,
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

interface LinkImageEditorState {
  id: number;
  session: LinkImageEditorSession;
  initialFields: readonly LinkImageFieldValues[];
  fieldRevision: number;
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
let paletteReturnFocus: HTMLElement | null = null;
const searchOpen = ref(false);
let searchReturnFocus: HTMLElement | null = null;

const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const systemPrefersDark = ref(systemTheme.matches);

const viewportWidth = ref(window.innerWidth);
const isWide = computed(() => viewportWidth.value >= 960);
const isCompactTopBar = computed(() => viewportWidth.value < 760);
const sidebarOpen = ref(true);
const overlaySidebar = ref(false);

const outlineVisible = ref(false);
const outlineOverlayOpen = ref(false);
const outlinePanel = ref<InstanceType<typeof Outline> | null>(null);
const formatToolbarVisible = ref(false);
const showAllFiles = ref(true);
const hideMarkdownExtension = ref(false);
const uiFont = ref("");
const readingFont = ref("");
const codeFont = ref("");
const slashEnabled = ref<Record<SlashMode, boolean>>({
  live: true,
  immersive: true,
  source: true,
});
const formatToolbarState = shallowRef<FormatToolbarState>(
  EMPTY_FORMAT_TOOLBAR_STATE,
);
const formatToolbar = ref<InstanceType<typeof FormatToolbar> | null>(null);
const editorComposing = ref(false);
// `editor` is intentionally not reactive: only a changed view should rebuild
// the outline, not every transaction.
const editorRevision = ref(0);
let outlineChosen = false;
let formatToolbarChosen = false;
let themeChosen = false;
let showAllFilesChosen = false;
let hideMarkdownExtensionChosen = false;
const fontChosen: Record<FontField, boolean> = {
  ui: false,
  reading: false,
  code: false,
};
const slashModeChosen: Record<SlashMode, boolean> = {
  live: false,
  immersive: false,
  source: false,
};
let settingsWriteQueue: Promise<void> = Promise.resolve();
let fontWriteTimer: ReturnType<typeof setTimeout> | null = null;
const preferenceRevisions = new Map<string, number>();
// A preference has a saved baseline once the initial read or a successful
// write supplies one. A failed write before that can only restore after the
// read arrives, because the startup defaults are not the stored values.
const preferenceBaselines = new Set<string>();
const pendingPreferenceRestores = new Map<
  string,
  { revision: number; restore: () => void }
>();
let fontsBaselineReady = false;
let fontWritePending = false;
let fontBaselineFailureReported = false;
let initialSettingsLoadFinished = false;
let settingsBaselineRetry: Promise<boolean> | null = null;
let lastActiveDocumentId: number | null = null;
let lastSavedFonts = { ui: "", reading: "", code: "" };
let fontRevision = 0;
let savedPreferences = {
  theme: "system" as ThemeSetting,
  showAllFiles: true,
  hideMarkdownExtension: false,
  formatToolbarVisible: false,
  slashEnabled: { live: true, immersive: true, source: true },
};
let outlineOverlayReturnFocus: HTMLElement | null = null;
let outlineFocusSettlement: (() => void) | null = null;
const handledAppShortcutEvents = new WeakSet<KeyboardEvent>();

const dialog = ref<DialogState | null>(null);
const recoveryDialog = ref<RecoveryDialogState | null>(null);
let dialogResolve: ((value: string) => void) | null = null;
let dialogOpen = false;
let slashHandledEscape = false;
let folderOperation: Promise<boolean> | null = null;
let recoveryChecking = false;

let editor: EditorHandle | null = null;
const findController = shallowRef<FindReplaceController | null>(null);
let findOptions: FindReplaceOptions = { ...EMPTY_FIND_OPTIONS };
let mountSequence = 0;
let nextTabId = 1;
// Search result navigation captures this revision. Any later active-tab
// change makes the pending search intent stale before it can take focus.
let tabNavigationRevision = 0;
// A newer result click supersedes an older one even when both are still
// waiting for their files.
let searchNavigationSequence = 0;

watch(
  activeTabId,
  (id, previous) => {
    if (id !== previous) {
      tabNavigationRevision += 1;
      // A toolbar menu belongs to the current tab. Close it without taking
      // focus; the new tab's editor takes focus through the normal flow.
      formatToolbar.value?.closeMenus();
    }
  },
  { flush: "sync" },
);

let lastWorkspaceActivePath: string | null = null;
let slashMenu: SlashMenuController | null = null;
const slashState = shallowRef<SlashMenuSnapshot>(null);
const linkImageEditor = shallowRef<LinkImageEditorState | null>(null);
const linkImageEditorPanel = ref<InstanceType<typeof LinkImageEditor> | null>(
  null,
);
let linkImageReturnFocus: HTMLElement | null = null;
let nextLinkImageEditorID = 1;
let linkImageEditorRevision = 0;
let linkNavigationSequence = 0;
// The current root's user templates. Loading starts only when a command menu
// opens, and a newer request or a root change makes older results stale.
const workspaceSnippetCommands = shallowRef<readonly CommandDefinition[]>([]);
const workspaceSnippetCommandsLoading = ref(false);
let snippetLoadSequence = 0;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);
let applyingExternal = false;
let restoringTabs = false;
// Two entry points can request the same file before either read finishes.
const openingTabs = new Map<string, Promise<boolean>>();
const openingSingleRequests = new Map<string, number[]>();
// A pending ordinary read may satisfy several callers, but a newer Settings
// activation revokes the activation authority of reads requested before it.
let ordinaryOpenActivationRevision = 0;
function invalidateOlderOrdinaryOpens() {
  ordinaryOpenActivationRevision += 1;
}
function latestCurrentSingleOpenRequest(
  requests: readonly number[],
): number | undefined {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const revision = requests[index]!;
    if (revision === ordinaryOpenActivationRevision) return revision;
  }
  return undefined;
}
// A pending workspace read can satisfy several callers, but only the latest
// caller whose intent is still current may own the activation and its
// follow-up work (a search jump or heading anchor). Ordinary opens are kept
// current unless a Settings activation supersedes them.
interface WorkspaceOpenRequest {
  isRequestCurrent?: () => boolean;
  onHandoff?: (activation: WorkspaceActivation) => void;
  handedOff: boolean;
  navigationIntent: number;
}
const openingRequests = new Map<string, WorkspaceOpenRequest[]>();

let workspaceNavigationIntentRevision = 0;

function beginWorkspaceNavigationIntent(): number {
  workspaceNavigationIntentRevision += 1;
  return workspaceNavigationIntentRevision;
}

// A fixed, invalidatable snapshot of the target at the synchronous activation
// boundary. Follow-up work uses this credential instead of re-reading "current"
// state after an await; any later navigation or target lifecycle change makes
// it stale so an old caller cannot inherit a newer target's authority.
interface WorkspaceActivation {
  navigationIntent: number;
  tabNavigationRevision: number;
  tabId: number;
  kind: "workspace" | "single";
  path: string;
  workspaceRoot: string | null;
  workspaceGeneration: number;
  text: string;
  view: EditorView;
  doc: Text;
  dialogRevision: number;
  dialogId: number | null;
  dialogSession: LinkImageEditorSession | null;
  dialogFieldRevision: number;
}

function captureWorkspaceActivation(
  tab: DocumentTabModel,
  navigationIntent: number,
): WorkspaceActivation | null {
  if (editor === null || !isEditableTab(tab)) return null;
  return {
    navigationIntent,
    tabNavigationRevision: tabNavigationRevision,
    tabId: tab.id,
    kind: tab.kind,
    path: tab.path,
    workspaceRoot: workspace.value?.root ?? null,
    workspaceGeneration: workspace.value?.generation ?? 0,
    text: tab.text,
    view: editor.view,
    doc: editor.view.state.doc,
    dialogRevision: linkImageEditorRevision,
    dialogId: linkImageEditor.value?.id ?? null,
    dialogSession: linkImageEditor.value?.session ?? null,
    dialogFieldRevision: linkImageEditor.value?.fieldRevision ?? 0,
  };
}

function workspaceActivationCurrent(activation: WorkspaceActivation): boolean {
  if (activation.navigationIntent !== workspaceNavigationIntentRevision) {
    return false;
  }
  if (activation.tabNavigationRevision !== tabNavigationRevision) return false;
  if (
    (workspace.value?.root ?? null) !== activation.workspaceRoot ||
    (workspace.value?.generation ?? 0) !== activation.workspaceGeneration
  ) {
    return false;
  }
  if (activeTabId.value !== activation.tabId) return false;
  const tab = findTab(activation.tabId);
  if (
    tab === null ||
    tab.kind !== activation.kind ||
    tab.path !== activation.path ||
    tab.text !== activation.text
  ) {
    return false;
  }
  if (
    editor === null ||
    editor.view !== activation.view ||
    activation.view.state.doc !== activation.doc
  ) {
    return false;
  }
  if (linkImageEditorRevision !== activation.dialogRevision) return false;
  const current = linkImageEditor.value;
  if (activation.dialogId === null) return current === null;
  return (
    current !== null &&
    current.id === activation.dialogId &&
    current.session === activation.dialogSession &&
    current.fieldRevision === activation.dialogFieldRevision
  );
}

// A source can be absent for workspace search (the start page or a preview),
// while link navigation itself still requires an active Markdown editor. The
// optional editor/view/doc fields therefore record both "present and exactly
// this instance" and "absent". The popup fields also record the initial null
// state so opening and closing a popup cannot restore an old request.
interface NavigationSourceSnapshot {
  navigationIntent: number;
  tabNavigationRevision: number;
  workspaceRoot: string | null;
  workspaceGeneration: number;
  tabId: number | null;
  tabKind: TabModel["kind"] | null;
  tabPath: string | null;
  tabText: string | null;
  editor: EditorHandle | null;
  view: EditorView | null;
  doc: Text | null;
  dialogRevision: number;
  dialogId: number | null;
  dialogSession: LinkImageEditorSession | null;
  dialogFieldRevision: number;
}

function captureNavigationSource(
  navigationIntent: number,
): NavigationSourceSnapshot {
  const tab = currentTab.value;
  const documentTab = tab !== null && isDocumentTab(tab) ? tab : null;
  const sourceEditor = editor;
  const view = sourceEditor?.view ?? null;
  return {
    navigationIntent,
    tabNavigationRevision,
    workspaceRoot: workspace.value?.root ?? null,
    workspaceGeneration: workspace.value?.generation ?? 0,
    tabId: tab?.id ?? null,
    tabKind: tab?.kind ?? null,
    tabPath: documentTab?.path ?? null,
    tabText: documentTab?.text ?? null,
    editor: sourceEditor,
    view,
    doc: view?.state.doc ?? null,
    dialogRevision: linkImageEditorRevision,
    dialogId: linkImageEditor.value?.id ?? null,
    dialogSession: linkImageEditor.value?.session ?? null,
    dialogFieldRevision: linkImageEditor.value?.fieldRevision ?? 0,
  };
}

function sourceDialogCurrent(source: NavigationSourceSnapshot): boolean {
  if (linkImageEditorRevision !== source.dialogRevision) return false;
  const current = linkImageEditor.value;
  if (source.dialogId === null) return current === null;
  return (
    current !== null &&
    current.id === source.dialogId &&
    current.session === source.dialogSession &&
    current.fieldRevision === source.dialogFieldRevision
  );
}

function navigationSourceCurrent(source: NavigationSourceSnapshot): boolean {
  if (source.navigationIntent !== workspaceNavigationIntentRevision) {
    return false;
  }
  if (source.tabNavigationRevision !== tabNavigationRevision) return false;
  if (
    (workspace.value?.root ?? null) !== source.workspaceRoot ||
    (workspace.value?.generation ?? 0) !== source.workspaceGeneration
  ) {
    return false;
  }
  if (source.tabId === null) {
    if (
      currentTab.value !== null ||
      activeTabId.value !== null ||
      editor !== null
    ) {
      return false;
    }
  } else {
    if (activeTabId.value !== source.tabId) return false;
    const tab = findTab(source.tabId);
    if (tab === null) return false;
    if (source.tabKind === "settings") {
      if (
        tab.kind !== "settings" ||
        currentTab.value?.kind !== "settings" ||
        source.tabPath !== null ||
        source.tabText !== null ||
        source.editor !== null ||
        source.view !== null ||
        source.doc !== null ||
        editor !== null
      ) {
        return false;
      }
    } else {
      if (
        !isDocumentTab(tab) ||
        tab.kind !== source.tabKind ||
        tab.path !== source.tabPath ||
        tab.text !== source.tabText
      ) {
        return false;
      }
      if (source.editor === null) {
        if (editor !== null) return false;
      } else if (
        editor !== source.editor ||
        source.view === null ||
        source.doc === null ||
        editor.view !== source.view ||
        source.view.state.doc !== source.doc
      ) {
        return false;
      }
    }
  }
  return sourceDialogCurrent(source);
}

function workspaceOpenRequestCurrent(request: WorkspaceOpenRequest): boolean {
  return (
    request.isRequestCurrent === undefined || request.isRequestCurrent()
  );
}

function latestCurrentWorkspaceOpenRequest(
  requests: readonly WorkspaceOpenRequest[],
): WorkspaceOpenRequest | undefined {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const request = requests[index]!;
    if (workspaceOpenRequestCurrent(request)) return request;
  }
  return undefined;
}

function grantWorkspaceOpenHandoff(
  request: WorkspaceOpenRequest,
  activation: WorkspaceActivation,
) {
  if (request.handedOff) return;
  if (!workspaceActivationCurrent(activation)) return;
  request.handedOff = true;
  request.onHandoff?.(activation);
}
let recentSelfRename:
  | { oldPath: string; newPath: string; at: number }
  | null = null;
const saveTimers = new Map<number, ReturnType<typeof setTimeout>>();
// Tabs whose composition flag CodeMirror never cleared; a real key press
// proves the IME is gone, until the next composition start or end.
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
// A startup settings response must not replace a mode or outline choice the
// user picked while that response was still pending.
let editorModeChosen = false;

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
const currentMarkdown = computed<DocumentTabModel | null>(() => {
  const tab = currentTab.value;
  return tab !== null && isEditableTab(tab) ? tab : null;
});
const currentPreview = computed<DocumentTabModel | null>(() => {
  const tab = currentTab.value;
  return tab?.kind === "preview" ? tab : null;
});
const currentSettings = computed<SettingsTabModel | null>(() => {
  const tab = currentTab.value;
  return tab?.kind === "settings" ? tab : null;
});
const isMarkdownOpen = computed(() => currentMarkdown.value !== null);
const effectiveHideMarkdownExtension = computed(
  () => !showAllFiles.value && hideMarkdownExtension.value,
);

/**
 * The content area is the editor-side region to the right of the sidebar. Its
 * width excludes the sidebar even while the sidebar is hidden, so toggling the
 * sidebar does not move the outline between fixed and floating layouts. At
 * window widths where the sidebar floats over the content, it does not take
 * layout width.
 */
const outlineContentWidth = computed(() => {
  if (!hasWorkspace.value || !isWide.value) {
    return viewportWidth.value;
  }
  return Math.max(0, viewportWidth.value - sidebarWidth.value);
});
const outlineWide = computed(
  () => outlinePlacement(outlineContentWidth.value) === "fixed",
);
const outlineEnabled = computed(() => currentMarkdown.value !== null);
const outlineDisplayed = computed(
  () =>
    outlineEnabled.value &&
    (outlineWide.value ? outlineVisible.value : outlineOverlayOpen.value),
);
const activeEditorView = computed(() => {
  // The editor handle is not reactive; bumping the revision after creating or
  // destroying a view is the signal that this computed depends on.
  void editorRevision.value;
  return editor?.view ?? null;
});
const outlinePanelKey = computed(() => {
  const tab = currentMarkdown.value;
  return tab === null ? "" : `${tab.id}:${editorRevision.value}`;
});

/** Whether the current page state satisfies a command's runtime requirements. */
function commandContextAllows(command: CommandDefinition): boolean {
  return (
    (!command.requiresWorkspace || hasWorkspace.value) &&
    (!command.requiresOpenTab || tabs.value.length > 0) &&
    (!command.requiresActiveMarkdown || currentMarkdown.value !== null) &&
    (!command.requiresMultipleTabs || tabs.value.length > 1) &&
    (!command.requiresClosedTab || closedTabs.value.length > 0) &&
    (command.formatToolbarState === undefined ||
      command.formatToolbarState ===
        (formatToolbarVisible.value ? "visible" : "hidden"))
  );
}

function buildPaletteCommands(): readonly CommandDefinition[] {
  return [...commandRegistry, ...workspaceSnippetCommands.value].filter(
    (command) =>
      isCommandAvailable(command) &&
      commandContextAllows(command) &&
      (command.scope === "app" ||
        (command.scope === "editor" && isMarkdownOpen.value && editor !== null)),
  );
}

/**
 * The command array the open palette actually renders. Keeping it in an
 * explicit ref instead of a computed cache lets close and root cleanup replace
 * the array synchronously, releasing the previous template definitions and
 * bodies even while the panel is unmounted.
 */
const paletteMenuCommands = shallowRef<readonly CommandDefinition[]>([]);

watchEffect(() => {
  if (paletteSession.value === null) {
    paletteMenuCommands.value = [];
    return;
  }
  paletteMenuCommands.value = buildPaletteCommands();
});

const sidebarShown = computed(
  () =>
    hasWorkspace.value &&
    (isWide.value ? sidebarOpen.value : overlaySidebar.value),
);
const showSidebarToggle = computed(
  () => hasWorkspace.value && !sidebarShown.value,
);

/** The element that currently owns focus, excluding the implicit page body. */
function focusedControl(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement &&
    active !== document.body &&
    active !== document.documentElement
    ? active
    : null;
}

/**
 * Moves focus to the control that replaces the one removed by a sidebar
 * visibility change. Routing by the removed element keeps shortcuts, palette
 * commands, pointer clicks and viewport changes on the same destinations.
 */
function focusAfterRemovedSidebarControl(
  removed: HTMLElement | null,
): boolean {
  if (removed === null) {
    return false;
  }
  let target: HTMLElement | null = null;
  if (removed.matches('[data-theme-toggle="status"]')) {
    target = document.querySelector<HTMLElement>(
      '[data-theme-toggle="sidebar"]',
    );
  } else if (removed.matches('[data-theme-toggle="sidebar"]')) {
    target = document.querySelector<HTMLElement>(
      '[data-theme-toggle="status"]',
    );
  } else if (
    removed.matches("[data-sidebar-toggle], [data-sidebar-hide]") ||
    removed.closest("aside") !== null
  ) {
    target =
      document.querySelector<HTMLElement>("[data-sidebar-hide]") ??
      document.querySelector<HTMLElement>("[data-sidebar-toggle]");
  }
  target?.focus();
  return target !== null;
}

// The overlay does not take focus when it opens, so remember where the user
// was before it replaced that part of the page. Esc and outside clicks are
// dismissed by the user, not by toggling the sidebar, and return there first.
let overlaySidebarReturnFocus: HTMLElement | null = null;
let overlayDismissal: {
  origin: HTMLElement | null;
  removed: HTMLElement | null;
} | null = null;

watch(overlaySidebar, (open) => {
  if (open) {
    overlaySidebarReturnFocus = focusedControl();
    focusOutlineToggleIfInside();
    closeOutlineOverlay(false);
  }
});

function dismissOverlaySidebar() {
  // A window that widened while the overlay was open leaves the overlay flag
  // set even though the sidebar is now pinned by sidebarOpen. Esc only clears
  // that stale flag; there is no overlay to dismiss or focus to restore.
  if (isWide.value) {
    overlaySidebar.value = false;
    return;
  }
  // The dismissal owns its focus restoration. It runs even when closing and
  // reopening the overlay in one tick leaves sidebarShown unchanged, so no
  // stale origin can be applied to a later visibility change.
  const dismissal = {
    origin: overlaySidebarReturnFocus,
    removed: focusedControl(),
  };
  overlayDismissal = dismissal;
  overlaySidebar.value = false;
  void nextTick().then(() => {
    if (overlayDismissal !== dismissal) {
      return;
    }
    overlayDismissal = null;
    if (focusedControl() !== null) {
      return;
    }
    if (dismissal.origin?.isConnected) {
      dismissal.origin.focus();
      return;
    }
    focusAfterRemovedSidebarControl(dismissal.removed);
  });
}

watch(sidebarShown, () => {
  const removed = focusedControl();
  void nextTick().then(() => {
    // The dismissal handler owns Esc and outside clicks. The command palette
    // focuses its input on mount and restores its own opener when it closes.
    if (overlayDismissal !== null || paletteSession.value !== null) {
      return;
    }
    if (focusedControl() !== null) {
      return;
    }
    focusAfterRemovedSidebarControl(removed);
  });
});
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
  const documents = tabs.value.filter(isDocumentTab);
  const suffixes = distinguishingSuffixes(documents, rootName.value);
  return tabs.value.map((tab) => {
    if (tab.kind === "settings") {
      return {
        id: tab.id,
        name: "设置",
        suffix: null,
        title: "设置",
        problem: null,
        problemLabel: "",
      };
    }
    const badge = tabBadge(tab);
    return {
      id: tab.id,
      name: fileDisplayName(
        { name: tab.name, isDir: false },
        effectiveHideMarkdownExtension.value,
      ),
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

function tabKey(tab: Pick<DocumentTabModel, "kind" | "path">): string {
  return `${tab.kind}\u0000${tab.path}`;
}

function workspaceAbsolutePath(root: string, path: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${path}`;
}

function sameFilePath(left: string, right: string): boolean {
  return left.replace(/\\/g, "/") === right.replace(/\\/g, "/");
}

/** True when a tab already represents a workspace-relative file path. */
function isTabForWorkspacePath(
  tab: Pick<DocumentTabModel, "kind" | "path">,
  root: string,
  path: string,
): boolean {
  if (tab.kind === "workspace") return tab.path === path;
  return (
    tab.kind === "single" &&
    sameFilePath(tab.path, workspaceAbsolutePath(root, path))
  );
}

/** Finds a workspace tab or a single-file tab for the same physical path. */
function findOpenTabForWorkspacePathIn(
  list: readonly TabModel[],
  root: string,
  path: string,
): DocumentTabModel | undefined {
  const workspaceTab = list.find(
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) && tab.kind === "workspace" && tab.path === path,
  );
  if (workspaceTab !== undefined) {
    return workspaceTab;
  }
  return list.find(
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) &&
      tab.kind === "single" &&
      isTabForWorkspacePath(tab, root, path),
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

/**
 * Font preferences only update inherited CSS variables. The editor theme
 * already reads them, so a change never rebuilds the view or touches its
 * selection and undo history.
 */
function applyFontPreferences() {
  const root = document.documentElement;
  const fonts: [string, string, string][] = [
    ["--app-font-sans", uiFont.value, UI_FONT_FALLBACK],
    ["--app-font-reading", readingFont.value, READING_FONT_FALLBACK],
    ["--app-font-mono", codeFont.value, CODE_FONT_FALLBACK],
  ];
  for (const [property, name, fallback] of fonts) {
    const stack = customFontStack(name, fallback);
    if (stack === null) {
      root.style.removeProperty(property);
    } else {
      root.style.setProperty(property, stack);
    }
  }
}

function isEditorMode(value: unknown): value is EditorMode {
  return value === "live" || value === "immersive" || value === "source";
}

function applySettings(
  loaded: AppSettings,
  options: { startup?: boolean } = {},
) {
  const normalizedTheme: ThemeSetting =
    loaded.theme === "light" || loaded.theme === "dark"
      ? loaded.theme
      : "system";
  if (!themeChosen) {
    theme.value = normalizedTheme;
  }
  if (!editorModeChosen) {
    const restored = isEditorMode(loaded.editorMode) ? loaded.editorMode : "live";
    mode.value = restored;
    editor?.setMode(restored);
  }
  if (!outlineChosen) {
    outlineVisible.value = loaded.outlineVisible === true;
  }
  if (!formatToolbarChosen) {
    formatToolbarVisible.value = loaded.formatToolbarVisible === true;
  }
  if (!showAllFilesChosen) {
    showAllFiles.value = loaded.showAllFiles !== false;
  }
  if (!hideMarkdownExtensionChosen) {
    hideMarkdownExtension.value = loaded.hideMarkdownExtension === true;
  }
  if (!fontChosen.ui) uiFont.value = loaded.uiFont ?? "";
  if (!fontChosen.reading) readingFont.value = loaded.readingFont ?? "";
  if (!fontChosen.code) codeFont.value = loaded.codeFont ?? "";
  const slash = loaded.slashEnabled;
  if (!slashModeChosen.live) slashEnabled.value.live = slash?.live !== false;
  if (!slashModeChosen.immersive) {
    slashEnabled.value.immersive = slash?.immersive !== false;
  }
  if (!slashModeChosen.source) slashEnabled.value.source = slash?.source !== false;
  if (!slashEnabled.value[mode.value]) {
    slashMenu?.close();
  }
  if (!fontsBaselineReady) {
    lastSavedFonts = {
      ui: loaded.uiFont ?? "",
      reading: loaded.readingFont ?? "",
      code: loaded.codeFont ?? "",
    };
    fontsBaselineReady = true;
  }
  if (!preferenceBaselines.has("theme")) {
    savedPreferences.theme = normalizedTheme;
  }
  if (!preferenceBaselines.has("showAllFiles")) {
    savedPreferences.showAllFiles = loaded.showAllFiles !== false;
  }
  if (!preferenceBaselines.has("hideMarkdownExtension")) {
    savedPreferences.hideMarkdownExtension =
      loaded.hideMarkdownExtension === true;
  }
  if (!preferenceBaselines.has("formatToolbarVisible")) {
    savedPreferences.formatToolbarVisible =
      loaded.formatToolbarVisible === true;
  }
  if (!preferenceBaselines.has("slash:live")) {
    savedPreferences.slashEnabled.live = slash?.live !== false;
  }
  if (!preferenceBaselines.has("slash:immersive")) {
    savedPreferences.slashEnabled.immersive = slash?.immersive !== false;
  }
  if (!preferenceBaselines.has("slash:source")) {
    savedPreferences.slashEnabled.source = slash?.source !== false;
  }
  for (const key of [
    "theme",
    "showAllFiles",
    "hideMarkdownExtension",
    "formatToolbarVisible",
    "slash:live",
    "slash:immersive",
    "slash:source",
  ]) {
    preferenceBaselines.add(key);
  }
  for (const [key, pending] of pendingPreferenceRestores) {
    if (!preferenceRevisionCurrent(key, pending.revision)) {
      pendingPreferenceRestores.delete(key);
      continue;
    }
    pending.restore();
    pendingPreferenceRestores.delete(key);
  }
  fontBaselineFailureReported = false;
  if (options.startup !== false) {
    sidebarWidth.value = Math.min(
      400,
      Math.max(200, loaded.sidebarWidth || 252),
    );
    recentFolders.value = [...loaded.recentFolders].slice(0, 10);
    expandedByRoot.value = { ...loaded.expandedFolders };
    workspaceClosed.value = loaded.workspaceClosed === true;
  }
  applyTheme();
  applyFontPreferences();
  if (fontWritePending) flushFontPreferences();
}

async function loadSettings() {
  try {
    const legacy = localStorage.getItem("nicole-theme");
    if (legacy !== null) {
      try {
        applySettings(await migrateLegacyTheme(legacy));
        if (themeChosen) {
          // Migration may have applied the legacy native appearance after the
          // user already chose another theme in this session.
          chooseTheme(theme.value, false);
        }
        localStorage.removeItem("nicole-theme");
        return;
      } catch {
        // Keep the legacy value for the next launch.
      }
    }
    try {
      applySettings(await getSettings());
    } catch {
      reportUnavailableFontBaseline();
    }
  } finally {
    initialSettingsLoadFinished = true;
  }
}

/**
 * A failed startup read leaves the font baseline unknown. A later explicit
 * Settings open or font edit gets one bounded retry; repeated user intent while
 * it is in flight shares that promise, and no workspace startup runs again.
 */
function retrySettingsBaseline(): Promise<boolean> | null {
  if (fontsBaselineReady || !initialSettingsLoadFinished) return null;
  if (settingsBaselineRetry !== null) return settingsBaselineRetry;
  if (fontWritePending) fontBaselineFailureReported = false;
  let task: Promise<boolean> | null = null;
  const started = (async () => {
    try {
      applySettings(await getSettings(), { startup: false });
      return true;
    } catch {
      reportUnavailableFontBaseline();
      return false;
    } finally {
      if (settingsBaselineRetry === task) {
        settingsBaselineRetry = null;
      }
    }
  })();
  task = started;
  settingsBaselineRetry = started;
  return started;
}

function reportUnavailableFontBaseline() {
  if (!fontWritePending || fontBaselineFailureReported) return;
  fontBaselineFailureReported = true;
  showNotice("保存设置失败", "danger", undefined, "设置尚未加载");
}

function handleSystemThemeChange(event: MediaQueryListEvent) {
  systemPrefersDark.value = event.matches;
  if (theme.value === "system") {
    applyTheme();
  }
}

function toggleTheme() {
  chooseTheme(isDark.value ? "light" : "dark", false);
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
  dismissOverlaySidebar();
}

function cancelPendingOutlineFocusSettlement() {
  const cancel = outlineFocusSettlement;
  outlineFocusSettlement = null;
  cancel?.();
}

function closeOutlineOverlay(restoreFocus = false) {
  cancelPendingOutlineFocusSettlement();
  const origin = outlineOverlayReturnFocus;
  outlineOverlayReturnFocus = null;
  if (!outlineOverlayOpen.value) {
    return;
  }
  outlineOverlayOpen.value = false;
  if (!restoreFocus) {
    return;
  }
  void nextTick().then(() => {
    if (origin?.isConnected) {
      origin.focus();
      return;
    }
    outlineToggleElement()?.focus();
  });
}

function outlineToggleElement(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>("[data-outline-toggle]");
}

/**
 * Keeps keyboard focus on a surviving control when another surface replaces
 * the outline. Its return-focus handlers would otherwise point at a heading
 * button that is about to unmount.
 */
function focusOutlineToggleIfInside() {
  const panel = document.querySelector("[data-outline-panel]");
  if (panel?.contains(document.activeElement)) {
    outlineToggleElement()?.focus();
  }
}

function toggleOutline() {
  if (!outlineEnabled.value) {
    return;
  }
  cancelPendingOutlineFocusSettlement();
  // Opening or closing the outline is a popover takeover: close any toolbar
  // menu without restoring its old focus or allowing a queued restore.
  formatToolbar.value?.closeMenus();
  // Opening the floating outline from the top bar or a shortcut must follow
  // the same popover-exclusion path as the command palette.
  topBar.value?.closeModeMenu();
  slashMenu?.close();
  closeLinkImageEditor({ restoreFocus: false });
  if (outlineWide.value) {
    outlineChosen = true;
    const next = !outlineVisible.value;
    const panelElement = document.querySelector<HTMLElement>(
      "[data-outline-panel]",
    );
    const focusWasInside =
      panelElement?.contains(document.activeElement) ?? false;
    outlineVisible.value = next;
    if (!next && focusWasInside) {
      void nextTick().then(() => outlineToggleElement()?.focus());
    }
    void setOutlineVisible(next).catch(() => {
      // Keep this session's choice if the write fails.
    });
    return;
  }
  if (outlineOverlayOpen.value) {
    closeOutlineOverlay(true);
    return;
  }
  // The floating outline and the find panel are both popovers. Closing find
  // first restores a connected return target before the outline takes focus.
  editor?.search.close();
  outlineOverlayReturnFocus = focusedControl();
  outlineOverlayOpen.value = true;
  void nextTick().then(() => {
    if (!outlineOverlayOpen.value) {
      return;
    }
    // Closing the mode menu can unmount the focused item. Keep a return
    // target that still exists before moving focus into the outline.
    if (
      outlineOverlayReturnFocus !== null &&
      !outlineOverlayReturnFocus.isConnected
    ) {
      outlineOverlayReturnFocus = outlineToggleElement();
    }
    outlinePanel.value?.focusActiveHeading();
  });
}

function handleOutlineNavigate() {
  cancelPendingOutlineFocusSettlement();
  outlineOverlayOpen.value = false;
  outlineOverlayReturnFocus = null;
}

/**
 * An outside pointer's default focus action runs after the pointerdown and
 * mousedown listeners, so deciding in a microtask is too early. Wait for the
 * mouse sequence to finish, then respect a control that took focus; only a
 * click that leaves the page body focused restores the pre-open control.
 */
function closeOutlineOverlayAfterPointer() {
  const origin = outlineOverlayReturnFocus;
  outlineOverlayReturnFocus = null;
  if (!outlineOverlayOpen.value) {
    return;
  }
  cancelPendingOutlineFocusSettlement();
  outlineOverlayOpen.value = false;

  let finished = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    document.removeEventListener("mousedown", settleLater, true);
    document.removeEventListener("pointerup", settleLater, true);
    document.removeEventListener("pointercancel", settleLater, true);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (outlineFocusSettlement === cleanup) {
      outlineFocusSettlement = null;
    }
  }

  function finish() {
    if (finished) {
      return;
    }
    finished = true;
    cleanup();
    if (focusedControl() !== null) {
      return;
    }
    if (origin?.isConnected) {
      origin.focus();
      return;
    }
    outlineToggleElement()?.focus();
  }

  function settleLater() {
    if (timer !== null || finished) {
      return;
    }
    timer = setTimeout(finish, 0);
  }

  outlineFocusSettlement = cleanup;
  document.addEventListener("mousedown", settleLater, true);
  document.addEventListener("pointerup", settleLater, true);
  document.addEventListener("pointercancel", settleLater, true);
}

function handleOutlinePointerDown(event: PointerEvent) {
  if (!outlineOverlayOpen.value) {
    return;
  }
  if (
    event.target instanceof Element &&
    event.target.closest("[data-outline-panel], [data-outline-toggle]")
  ) {
    return;
  }
  closeOutlineOverlayAfterPointer();
}

watch(outlineWide, () => {
  // A remembered wide-layout choice must not turn into an automatic floating
  // panel when the content narrows; the floating panel is always user-opened.
  focusOutlineToggleIfInside();
  closeOutlineOverlay(false);
});

watch(outlineEnabled, (enabled) => {
  if (!enabled) {
    focusOutlineToggleIfInside();
    closeOutlineOverlay(false);
  }
});

watch(slashState, (state) => {
  if (state !== null) {
    closeLinkImageEditor({ restoreFocus: false });
    closeOutlineOverlay(false);
  }
});

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
  if (!isDocumentTab(tab)) return false;
  return (
    recoveryKindFor(tab) !== null &&
    (isDirty(tab) || tab.externalState === "deleted")
  );
}

function recoveryPayload(tab: TabModel): RecoveryCopy | null {
  if (!isDocumentTab(tab)) return null;
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
      !isEditableTab(tab) ||
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
  if (!isDocumentTab(tab)) return;
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
  if (!isDocumentTab(tab)) return;
  recoveryTicker.stop(tab.id);
  recoveryWrites.delete(tab.id);
  recoveryEpoch.set(tab.id, (recoveryEpoch.get(tab.id) ?? 0) + 1);
  deleteRecoveryForTab(tab);
}

function writeRecoveryCopy(tabId: number) {
  const tab = findTab(tabId);
  if (tab === null || !isDocumentTab(tab) || !needsRecoveryCopy(tab)) {
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
        !isDocumentTab(current) ||
        current.kind !== tab.kind ||
        current.path !== captured.path ||
        !needsRecoveryCopy(current)
      ) {
        if (
          current === null ||
          !isDocumentTab(current) ||
          current.recoveryId !== id
        ) {
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
      if (
        currentState.queued &&
        current !== null &&
        isDocumentTab(current) &&
        isDirty(current)
      ) {
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
  tab: DocumentTabModel,
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
    closeLinkImageEditor({ restoreFocus: false });
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
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) &&
      tab.kind === "single" &&
      sameFilePath(tab.path, item.path),
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
    if (
      tab !== null &&
      isDocumentTab(tab) &&
      isDirty(tab) &&
      !tab.restored
    ) {
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
  if (!isDocumentTab(tab)) return;
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
  // A real key proves the IME handed the editor back even if WKWebView missed
  // compositionend. Re-enable the toolbar before the autosave-only check.
  editorComposing.value = false;
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
  if (tabId === activeTabId.value) {
    editorComposing.value = true;
  }
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
  if (tab === null || !isEditableTab(tab)) {
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
  if (!isEditableTab(tab)) return;
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
  if (tab === null || !isEditableTab(tab)) {
    return;
  }
  invalidatedCompositions.delete(tabId);
  if (tabId === activeTabId.value) {
    editorComposing.value = false;
    refreshFormatToolbarState();
  }
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
  if (tab === null || !isDocumentTab(tab)) {
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
        isDocumentTab(tab) &&
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
  if (tab === null || !isDocumentTab(tab)) {
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
    if (tab === null || !isDocumentTab(tab)) {
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
      if (
        current !== null &&
        isDocumentTab(current) &&
        current.path === edit.path
      ) {
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
    if (current === null || !isDocumentTab(current)) {
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
    isDocumentTab(tab) &&
    tab.externalState !== "deleted" &&
    tab.text !== tab.originalText
  ) {
    markExternalState(tab, "modified");
  }
  if (tab !== null && isDocumentTab(tab)) {
    tab.savePhase = "paused";
    writeRecoveryCopy(tabId);
  }
  return false;
}

async function saveAllTabs(force = false): Promise<boolean> {
  const ids = tabs.value
    .filter(isDocumentTab)
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
): DocumentTabModel {
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
): DocumentTabModel {
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
  if (tab === null || !isEditableTab(tab) || editor === null) {
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
  closeLinkImageEditor({ restoreFocus: false });
  slashMenu?.destroy();
  slashMenu = null;
  slashState.value = null;
  const search = editor?.search.snapshot();
  if (search !== undefined) {
    // Find conditions are shared by every tab; the open state, counts and
    // decorations belong to this view and are dropped with it.
    findOptions = {
      query: search.query,
      replacement: search.replacement,
      caseSensitive: search.caseSensitive,
      regexp: search.regexp,
    };
  }
  findController.value = null;
  editor?.destroy();
  editor = null;
  editorRevision.value += 1;
  editorComposing.value = false;
  formatToolbarState.value = EMPTY_FORMAT_TOOLBAR_STATE;
  editorHost.value?.replaceChildren();
}

async function mountActive(
  focus = true,
  navigationIntent?: number,
): Promise<WorkspaceActivation | null> {
  const sequence = ++mountSequence;
  clearEditor();
  const target = findTab(activeTabId.value);
  if (target === null || !isEditableTab(target)) {
    return null;
  }
  lastActiveDocumentId = target.id;
  await nextTick();
  if (sequence !== mountSequence) {
    return null;
  }
  const tab = findTab(activeTabId.value);
  if (tab === null || tab.id !== target.id || !isEditableTab(tab)) {
    return null;
  }
  const host = editorHost.value;
  if (!host) {
    return null;
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
    find: findOptions,
    resolveImage: (src) =>
      tab.kind === "workspace"
        ? resolveImageUrl(src, tab.path, tab.generation)
        : null,
    onPasteImage: (ticket) => imageInsertion.handlePaste(ticket),
    onChange: (text) => handleEditorChange(tab.id, text),
    onCompositionStart: () => handleEditorCompositionStart(tab.id),
    onCompositionEnd: () => handleEditorCompositionEnd(tab.id),
    onSelectionChange: refreshFormatToolbarState,
    onEditLinkImage: handleEditLinkImage,
    onOpenLink: (source) => {
      void openLinkAddress(source);
    },
  });
  editorComposing.value = false;
  refreshFormatToolbarState();
  const activation =
    navigationIntent === undefined
      ? null
      : captureWorkspaceActivation(tab, navigationIntent);
  editorRevision.value += 1;
  slashMenu = createSlashMenu({
    view: editor.view,
    platform: platform.value,
    commands: () => slashCommandList(workspaceSnippetCommands.value),
    enabled: () => slashEnabled.value[mode.value],
    onOpen: () => {
      void refreshSnippetCommands();
    },
    onClose: () => {
      // Closing the menu also releases the definitions and bodies it was
      // showing and invalidates any read for that menu.
      clearSnippetCommands();
    },
    onChange: (state) => {
      slashState.value = state;
    },
  });
  findController.value = editor.search;
  if (focus) {
    editor.focus();
  }
  return activation;
}

function executeSlashCommand(index: number) {
  slashMenu?.execute(index);
}

function highlightSlashCommand(index: number) {
  slashMenu?.highlight(index);
}

async function activateTab(
  id: number,
  focus = true,
  navigationIntent?: number,
): Promise<WorkspaceActivation | null> {
  const target = findTab(id);
  if (target === null) {
    return null;
  }
  if (target.kind === "settings") {
    invalidateOlderOrdinaryOpens();
  }
  if (activeTabId.value === id) {
    if (target.kind === "workspace" && workspace.value !== null) {
      rememberRecentWorkspaceFile(workspace.value.root, target.path);
    }
    if (isDocumentTab(target)) {
      lastActiveDocumentId = target.id;
    }
    closeOverlaySidebar();
    if (focus && isEditableTab(target)) {
      editor?.focus();
    }
    return navigationIntent === undefined || !isEditableTab(target)
      ? null
      : captureWorkspaceActivation(target, navigationIntent);
  }
  snapshotActiveEditor();
  activeTabId.value = id;
  if (target.kind === "workspace" || target.kind === "preview") {
    lastWorkspaceActivePath = target.path;
  }
  if (isDocumentTab(target)) {
    lastActiveDocumentId = target.id;
  }
  if (target.kind === "workspace" && workspace.value !== null) {
    rememberRecentWorkspaceFile(workspace.value.root, target.path);
  }
  // The preview placeholder and settings page have no editor view.
  let activation: WorkspaceActivation | null = null;
  if (isEditableTab(target)) {
    activation = await mountActive(focus, navigationIntent);
  } else {
    clearEditor();
  }
  closeOverlaySidebar();
  schedulePersistTabs();
  return activation;
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
  options: {
    silent?: boolean;
    reveal?: boolean;
    /** A caller-owned intent that must still be current before activation. */
    isRequestCurrent?: () => boolean;
    /** Called once when this caller wins the shared activation handoff. */
    onHandoff?: (activation: WorkspaceActivation) => void;
    /** A navigation intent already begun by the caller. */
    navigationIntent?: number;
  } = {},
): Promise<boolean> {
  const context = currentWorkspaceContext();
  if (context === null) {
    return false;
  }
  const ordinaryActivationRevision = ordinaryOpenActivationRevision;
  const requestIsCurrent =
    options.isRequestCurrent ??
    (() => ordinaryOpenActivationRevision === ordinaryActivationRevision);
  const request: WorkspaceOpenRequest = {
    isRequestCurrent: requestIsCurrent,
    onHandoff: options.onHandoff,
    handedOff: false,
    navigationIntent:
      options.navigationIntent ?? beginWorkspaceNavigationIntent(),
  };
  const existing = findOpenTabForWorkspacePath(context.root, path);
  if (existing !== undefined) {
    if (!requestIsCurrent()) return false;
    const activation = await activateTab(
      existing.id,
      true,
      request.navigationIntent,
    );
    if (activation !== null) grantWorkspaceOpenHandoff(request, activation);
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
    openingRequests.get(key)?.push(request);
    return pending;
  }

  const requests = [request];
  const task = (async (): Promise<boolean> => {
    let text: string;
    try {
      text = await readFile(path);
    } catch (error) {
      if (
        isCurrentWorkspace(context.root, context.generation) &&
        requests.some(workspaceOpenRequestCurrent) &&
        !options.silent
      ) {
        showNotice(`读取失败：${errorText(error)}`, "danger");
      }
      return false;
    }
    if (!isCurrentWorkspace(context.root, context.generation)) {
      return false;
    }
    const owner = latestCurrentWorkspaceOpenRequest(requests);
    if (owner === undefined) return false;
    const current = findOpenTabForWorkspacePath(context.root, path);
    if (current !== undefined) {
      const activation = await activateTab(
        current.id,
        true,
        owner.navigationIntent,
      );
      if (activation !== null) grantWorkspaceOpenHandoff(owner, activation);
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
    const activation = await activateTab(
      tab.id,
      true,
      owner.navigationIntent,
    );
    if (activation !== null) grantWorkspaceOpenHandoff(owner, activation);
    if (options.reveal ?? true) {
      void sidebar.value?.reveal(path);
    }
    return true;
  })();

  openingTabs.set(key, task);
  openingRequests.set(key, requests);
  try {
    return await task;
  } finally {
    if (openingTabs.get(key) === task) {
      openingTabs.delete(key);
      openingRequests.delete(key);
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

/**
 * Forgets the previous root's templates immediately. The body text lives in
 * the command closures, so dropping the list also drops every loaded body.
 */
function clearSnippetCommands() {
  snippetLoadSequence += 1;
  workspaceSnippetCommands.value = [];
  // Drop the palette's rendered snapshot in the same synchronous cleanup.
  // A closed panel must not keep the previous definitions or bodies through a
  // stale derived array.
  paletteMenuCommands.value = [];
  workspaceSnippetCommandsLoading.value = false;
  slashMenu?.setCommandLoading(false);
  slashMenu?.refreshCommands();
}

/**
 * Reads one fresh `.nicole/snippets/` snapshot when slash or the command
 * palette opens. A later request, a root switch, or a close makes an older
 * response stale before it can reach the current menus. Missing directories
 * and per-file warnings still leave the built-in commands usable.
 */
async function refreshSnippetCommands() {
  const current = workspace.value;
  if (current === null) {
    clearSnippetCommands();
    return;
  }
  const { root, generation } = current;
  const sequence = ++snippetLoadSequence;
  // A menu that opens shows the snapshot being read, not the previous open's
  // list. Reopening after a template change cannot execute the old body while
  // the new read is in flight.
  workspaceSnippetCommands.value = [];
  workspaceSnippetCommandsLoading.value = true;
  slashMenu?.setCommandLoading(true);
  slashMenu?.refreshCommands();
  try {
    const snapshot = await listSnippets(generation);
    if (
      sequence !== snippetLoadSequence ||
      !isCurrentWorkspace(root, generation)
    ) {
      return;
    }
    workspaceSnippetCommands.value = createSnippetCommands(snapshot.snippets);
    workspaceSnippetCommandsLoading.value = false;
    slashMenu?.setCommandLoading(false);
    slashMenu?.refreshCommands();
    const firstWarning = snapshot.warnings[0];
    if (firstWarning !== undefined) {
      showNotice(
        firstWarning,
        "danger",
        undefined,
        snapshot.warnings.join("\n"),
      );
    }
  } catch (error) {
    if (
      sequence !== snippetLoadSequence ||
      !isCurrentWorkspace(root, generation)
    ) {
      return;
    }
    workspaceSnippetCommands.value = [];
    workspaceSnippetCommandsLoading.value = false;
    slashMenu?.setCommandLoading(false);
    slashMenu?.refreshCommands();
    showNotice(`无法读取用户模板：${errorText(error)}`, "danger");
  }
}

function applyWorkspaceState(folder: {
  root: string;
  generation: number;
}) {
  clearSnippetCommands();
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
): Promise<{ tabs: DocumentTabModel[]; activePath: string | null } | null> {
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
  const restored: DocumentTabModel[] = [];
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
  closeWorkspaceSearch({ restoreFocus: false });
  const previous = findTab(activeTabId.value);
  const keepSingle = previous?.kind === "single";
  const settingsTab = findSettingsTab();
  const settingsActive =
    settingsTab !== null && activeTabId.value === settingsTab.id;
  const settingsIndex =
    settingsTab === null
      ? -1
      : tabs.value.findIndex((tab) => tab.id === settingsTab.id);
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
    const retained: TabModel[] = [...singles];
    if (settingsTab !== null) {
      retained.splice(
        Math.min(Math.max(settingsIndex, 0), retained.length),
        0,
        settingsTab,
      );
    }
    tabs.value = retained;
    const restoreStartActiveId = keepSingle
      ? previous.id
      : settingsTab?.id ?? null;
    activeTabId.value = restoreStartActiveId;
    const restoreStartNavigationRevision = tabNavigationRevision;
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
    const seen = new Set(
      merged.filter(isDocumentTab).map((tab) => tabKey(tab)),
    );
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
    const currentActive = findTab(activeTabId.value);
    const currentSettingsTab = findSettingsTab();
    const selectionChangedDuringRestore =
      tabNavigationRevision !== restoreStartNavigationRevision;
    // A background Settings page is only the restore placeholder. Keep it when
    // it was active before the switch or the user selected it during restore.
    const keepSettings =
      currentActive?.kind === "settings" &&
      (settingsActive ||
        selectionChangedDuringRestore ||
        currentActive.id !== restoreStartActiveId);
    // Leave a tab the user opened or activated during restore in front.
    if (keepSettings) {
      // The global page survives a root switch and stays in front. Remember a
      // document as the layout's active tab for the next open.
      lastWorkspaceActivePath = restored.activePath;
    } else if (currentActive === null || currentActive.kind === "settings") {
      const currentSingles = merged.filter(
        (tab): tab is DocumentTabModel =>
          isDocumentTab(tab) && tab.kind === "single",
      );
      const active =
        restored.activePath === null
          ? currentSingles.at(-1) ?? null
          : (merged.find(
              (tab): tab is DocumentTabModel =>
                isDocumentTab(tab) && tab.path === restored.activePath,
            ) ??
            findOpenTabForWorkspacePathIn(
              merged,
              context.root,
              restored.activePath,
            ) ??
            null);
      activeTabId.value = active?.id ?? currentSettingsTab?.id ?? null;
      if (active !== null) {
        lastActiveDocumentId = active.id;
      }
      if (active !== null && active.kind !== "single") {
        lastWorkspaceActivePath = active.path;
      }
      if (active === null && currentSettingsTab !== null) {
        // No document survives the switch; show the retained global page
        // instead of an empty content area.
        lastWorkspaceActivePath = restored.activePath;
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
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) &&
      (tab.kind === "workspace" || tab.kind === "preview"),
  );

  if (currentWorkspace !== null) {
    await saveWorkspaceTabs();
    if (closingTabs.length > 0) {
      const problems = closingTabs.flatMap(tabCloseProblems);
      const hadProblems = problems.length > 0;
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
    const closing = tabs.value.filter(isDocumentTab);
    await saveAllTabs();
    const problems = closing.flatMap(tabCloseProblems);
    if (problems.length > 0) {
      const workspaceTabCount = closing.filter(
        (tab) => tab.kind !== "single",
      ).length;
      const singleCount = closing.length - workspaceTabCount;
      const messageParts: string[] = [];
      if (workspaceTabCount > 0) {
        messageParts.push(
          `当前文件夹的 ${workspaceTabCount} 个标签页会关闭，下次打开“${rootName.value}”时会恢复这些标签页`,
        );
      }
      if (singleCount > 0) {
        messageParts.push(`${singleCount} 个单文件标签页会关闭且不会恢复`);
      }
      const message = messageParts.join("；");
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
    closeWorkspaceSearch({ restoreFocus: false });

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
    const currentSettingsTab = findSettingsTab();
    tabs.value = currentSettingsTab === null ? [] : [currentSettingsTab];
    activeTabId.value = currentSettingsTab?.id ?? null;
    lastActiveDocumentId = null;
    lastWorkspaceActivePath = null;
    closedTabs.value = [];
    clearSnippetCommands();
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
    if (currentSettingsTab === null) {
      emptyState.value?.focusOpenFolder();
    }
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
    if (!isDocumentTab(tab) || tab.kind === "single") {
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

  for (const tab of tabs.value.filter(
    (item): item is DocumentTabModel => item.kind === "workspace",
  )) {
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
  if (!isEditableTab(tab)) return;
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
    closeLinkImageEditor({ restoreFocus: false });
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
  if (!isDocumentTab(tab)) return;
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
    if (current === null || !isDocumentTab(current) || current.recoveryId !== recoveryId) {
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
  const documents = models.filter(isDocumentTab);
  if (documents.length === 0) {
    return true;
  }
  for (const model of documents) {
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
    .filter(
      (model): model is DocumentTabModel =>
        model !== null && isDocumentTab(model),
    );
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
  const activeBeforeSettings =
    findTab(activeBefore)?.kind === "settings";
  const record = options.record ?? true;
  for (const tab of tabs.value) {
    if (!closing.has(tab.id)) continue;
    clearTabSaveTimer(tab.id);
    clearSavingDisplay(tab.id);
    forgetRecoveryForTab(tab);
    if (!isDocumentTab(tab)) {
      continue;
    }
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
      // Closing the settings page returns to the last document the user was
      // reading when it still exists; otherwise the neighbouring tab wins.
      const previous =
        activeBeforeSettings && lastActiveDocumentId !== null
          ? tabs.value.find((tab) => tab.id === lastActiveDocumentId)
          : undefined;
      const nextIndex = Math.min(Math.max(activeIndex, 0), tabs.value.length - 1);
      const next = previous ?? tabs.value[nextIndex] ?? tabs.value[0]!;
      activeTabId.value = next.id;
      if (next.kind === "workspace" || next.kind === "preview") {
        lastWorkspaceActivePath = next.path;
      }
      if (isDocumentTab(next)) {
        lastActiveDocumentId = next.id;
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
      (tab): tab is DocumentTabModel =>
        isDocumentTab(tab) && tab.kind !== "single" && tab.path === closed.path,
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
  offerId = "",
): Promise<boolean> {
  const activationRevision = ordinaryOpenActivationRevision;
  const requestIsCurrent = () =>
    activationRevision === ordinaryOpenActivationRevision;
  const context = currentWorkspaceContext();
  if (context !== null && isInFolder(context.root, path)) {
    return openWorkspaceFile(relativePath(context.root, path), name);
  }
  const existing = tabs.value.find(
    (tab) => tab.kind === "single" && tab.path === path,
  );
  if (existing) {
    if (!requestIsCurrent()) return false;
    await activateTab(existing.id);
    return true;
  }
  const key = openingKey("single", path);
  const pending = openingTabs.get(key);
  if (pending !== undefined) {
    openingSingleRequests.get(key)?.push(activationRevision);
    return pending;
  }

  const requests = [activationRevision];
  const task = (async (): Promise<boolean> => {
    let file;
    try {
      file = await acceptSingleFile(path, offerId);
    } catch (error) {
      if (
        requests.some(
          (revision) => revision === ordinaryOpenActivationRevision,
        )
      ) {
        showNotice(`无法打开文件：${errorText(error)}`, "danger");
      }
      return false;
    }
    const alreadyOpen = tabs.value.find(
      (tab) => tab.kind === "single" && tab.path === file.path,
    );
    if (latestCurrentSingleOpenRequest(requests) === undefined) {
      if (alreadyOpen === undefined) {
        await releaseSingleFile(file.path).catch(() => {});
      }
      return false;
    }
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
        await releaseSingleFile(file.path).catch(() => {});
        if (
          latestCurrentSingleOpenRequest(requests) !== undefined
        ) {
          showNotice(`读取失败：${errorText(error)}`, "danger");
        }
      }
      return false;
    }
    const current = tabs.value.find(
      (tab) => tab.kind === "single" && tab.path === file.path,
    );
    if (latestCurrentSingleOpenRequest(requests) === undefined) {
      if (current === undefined) {
        await releaseSingleFile(file.path).catch(() => {});
      }
      return false;
    }
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
  openingSingleRequests.set(key, requests);
  try {
    return await task;
  } finally {
    if (openingTabs.get(key) === task) {
      openingTabs.delete(key);
      openingSingleRequests.delete(key);
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

async function askOpenSingleFile(path: string, offerId: string) {
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
    await openSingleFile(path, name, offerId);
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

async function openPathInWorkspace(path: string, offerId = "") {
  const context = currentWorkspaceContext();
  if (context === null || !isInFolder(context.root, path)) {
    await askOpenSingleFile(path, offerId);
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

async function handleOpenedPath(path: string, offerId: string) {
  const root = workspace.value?.root;
  if (root && isInFolder(root, path)) {
    await openPathInWorkspace(path, offerId);
    return;
  }
  const parent = absoluteParent(path);
  if (recentFolders.value.includes(parent) && parent !== root) {
    const opened = await startFolderOperation(() => switchToFolder(parent));
    if (opened) {
      await openPathInWorkspace(path, offerId);
    }
    return;
  }
  await askOpenSingleFile(path, offerId);
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
      const entries = await takePendingOpenedEntries();
      const last = entries.at(-1);
      if (last) {
        try {
          await handleOpenedPath(last.path, last.offerId);
        } finally {
          // The offer is one-time: opening the parent consumes it in Go,
          // AcceptSingleFile consumes it for a single file, and cancelling
          // or failing to open must not leave the directory grant behind.
          await dismissOfferedFile(last.path, last.offerId).catch(() => {});
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

/**
 * Runs one toolbar command against the live editor state. The toolbar never
 * stores document positions, so the command always uses the current selection
 * or caret. Link editing keeps its existing popover focus; every other command
 * returns focus to the document after the click.
 */
function runToolbarCommand(id: string) {
  if (editorComposing.value) return;
  const command = getCommand(id);
  if (
    command === undefined ||
    !isCommandAvailable(command) ||
    command.scope !== "editor" ||
    !commandContextAllows(command) ||
    editor === null
  ) {
    return;
  }
  command.run(commandContext(editor.view));
  if (command.id !== "format.link") {
    editor.focus();
  }
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
  editorModeChosen = true;
  mode.value = next;
  editor?.setMode(next);
  if (!slashEnabled.value[next]) {
    slashMenu?.close();
  }
  editor?.focus();
  void setEditorMode(next).catch(() => {
    // Keep this session's choice if the write fails.
  });
}

/**
 * The toolbar highlights follow the live editor selection. This runs from the
 * editor's selection-change signal, not from render or pointer movement.
 */
function refreshFormatToolbarState() {
  formatToolbarState.value =
    editor === null
      ? EMPTY_FORMAT_TOOLBAR_STATE
      : formatToolbarStateFor(editor.view.state);
}

/**
 * Serializes every preference write from the settings page and the format
 * toolbar command. A failed write is reported once; the control returns to
 * the last saved value unless the user already made a newer choice.
 */
function enqueueSettingsWrite(
  persist: () => Promise<unknown>,
  handlers: { onSuccess?: () => void; onError: (error: unknown) => void },
) {
  settingsWriteQueue = settingsWriteQueue
    .catch(() => {})
    .then(async () => {
      try {
        await persist();
        handlers.onSuccess?.();
      } catch (error) {
        handlers.onError(error);
      }
    });
}

function reportSettingsFailure(error: unknown) {
  showNotice("保存设置失败", "danger", undefined, errorText(error));
}

function nextPreferenceRevision(key: string): number {
  pendingPreferenceRestores.delete(key);
  const next = (preferenceRevisions.get(key) ?? 0) + 1;
  preferenceRevisions.set(key, next);
  return next;
}

function preferenceRevisionCurrent(key: string, revision: number): boolean {
  return (preferenceRevisions.get(key) ?? 0) === revision;
}

function markPreferenceBaseline(key: string) {
  preferenceBaselines.add(key);
}

/**
 * A failure can only restore a known saved value. Before the initial read
 * establishes that value, keep the user's preview and finish the rollback when
 * applySettings receives the stored baseline.
 */
function settlePreferenceFailure(
  key: string,
  revision: number,
  stillShowsFailedValue: () => boolean,
  restore: () => void,
) {
  const run = () => {
    if (!preferenceRevisionCurrent(key, revision)) return;
    if (!stillShowsFailedValue()) return;
    restore();
  };
  if (preferenceBaselines.has(key)) {
    run();
  } else {
    pendingPreferenceRestores.set(key, { revision, restore: run });
  }
}

function chooseTheme(next: ThemeSetting, reportFailure = true) {
  themeChosen = true;
  theme.value = next;
  applyTheme();
  const revision = nextPreferenceRevision("theme");
  enqueueSettingsWrite(
    () => setTheme(next),
    {
      onSuccess: () => {
        savedPreferences.theme = next;
        markPreferenceBaseline("theme");
      },
      onError: (error) => {
        if (reportFailure) {
          settlePreferenceFailure(
            "theme",
            revision,
            () => theme.value === next,
            () => {
              theme.value = savedPreferences.theme;
              applyTheme();
            },
          );
          reportSettingsFailure(error);
        }
      },
    },
  );
}

function setShowAllFilesPreference(value: boolean) {
  showAllFilesChosen = true;
  if (showAllFiles.value === value) return;
  showAllFiles.value = value;
  const revision = nextPreferenceRevision("showAllFiles");
  enqueueSettingsWrite(
    () => setShowAllFiles(value),
    {
      onSuccess: () => {
        savedPreferences.showAllFiles = value;
        markPreferenceBaseline("showAllFiles");
      },
      onError: (error) => {
        settlePreferenceFailure(
          "showAllFiles",
          revision,
          () => showAllFiles.value === value,
          () => {
            showAllFiles.value = savedPreferences.showAllFiles;
          },
        );
        reportSettingsFailure(error);
      },
    },
  );
}

function setHideMarkdownExtensionPreference(value: boolean) {
  hideMarkdownExtensionChosen = true;
  if (hideMarkdownExtension.value === value) return;
  hideMarkdownExtension.value = value;
  const revision = nextPreferenceRevision("hideMarkdownExtension");
  enqueueSettingsWrite(
    () => setHideMarkdownExtension(value),
    {
      onSuccess: () => {
        savedPreferences.hideMarkdownExtension = value;
        markPreferenceBaseline("hideMarkdownExtension");
      },
      onError: (error) => {
        settlePreferenceFailure(
          "hideMarkdownExtension",
          revision,
          () => hideMarkdownExtension.value === value,
          () => {
            hideMarkdownExtension.value =
              savedPreferences.hideMarkdownExtension;
          },
        );
        reportSettingsFailure(error);
      },
    },
  );
}

function setSlashEnabledPreference(modeToChange: SlashMode, value: boolean) {
  slashModeChosen[modeToChange] = true;
  if (slashEnabled.value[modeToChange] === value) return;
  slashEnabled.value = { ...slashEnabled.value, [modeToChange]: value };
  if (!value && mode.value === modeToChange) {
    slashMenu?.close();
  }
  const revisionKey = `slash:${modeToChange}`;
  const revision = nextPreferenceRevision(revisionKey);
  enqueueSettingsWrite(
    () => setSlashEnabled(modeToChange, value),
    {
      onSuccess: () => {
        savedPreferences.slashEnabled = {
          ...savedPreferences.slashEnabled,
          [modeToChange]: value,
        };
        markPreferenceBaseline(revisionKey);
      },
      onError: (error) => {
        settlePreferenceFailure(
          revisionKey,
          revision,
          () => slashEnabled.value[modeToChange] === value,
          () => {
            slashEnabled.value = {
              ...slashEnabled.value,
              [modeToChange]: savedPreferences.slashEnabled[modeToChange],
            };
          },
        );
        reportSettingsFailure(error);
      },
    },
  );
}

/**
 * Applies font text immediately for preview and writes the last snapshot
 * after a short pause. Continuous typing therefore produces one write.
 */
function setFontPreference(field: FontField, value: string) {
  fontChosen[field] = true;
  fontRevision += 1;
  fontWritePending = true;
  if (field === "ui") uiFont.value = value;
  else if (field === "reading") readingFont.value = value;
  else codeFont.value = value;
  applyFontPreferences();
  void retrySettingsBaseline();
  if (fontWriteTimer !== null) {
    clearTimeout(fontWriteTimer);
  }
  fontWriteTimer = setTimeout(() => {
    fontWriteTimer = null;
    flushFontPreferences();
  }, 350);
}

function flushFontPreferences() {
  if (fontWriteTimer !== null) {
    clearTimeout(fontWriteTimer);
    fontWriteTimer = null;
  }
  fontWritePending = true;
  if (!fontsBaselineReady) {
    return;
  }
  fontWritePending = false;
  const revision = fontRevision;
  const snapshot = {
    ui: uiFont.value,
    reading: readingFont.value,
    code: codeFont.value,
  };
  enqueueSettingsWrite(
    () => setFonts(snapshot.ui, snapshot.reading, snapshot.code),
    {
      onSuccess: () => {
        lastSavedFonts = snapshot;
      },
      onError: (error) => {
        if (revision !== fontRevision) {
          return;
        }
        uiFont.value = lastSavedFonts.ui;
        readingFont.value = lastSavedFonts.reading;
        codeFont.value = lastSavedFonts.code;
        applyFontPreferences();
        reportSettingsFailure(error);
      },
    },
  );
}

/**
 * Applies the global toolbar preference immediately and writes through the
 * shared preference queue. An older failed or slow write cannot make a newer
 * toggle lose the persisted value.
 */
function setFormatToolbarVisible(visible: boolean) {
  formatToolbarChosen = true;
  if (formatToolbarVisible.value === visible) return;
  formatToolbarVisible.value = visible;
  if (visible) refreshFormatToolbarState();
  const revision = nextPreferenceRevision("formatToolbarVisible");
  enqueueSettingsWrite(
    () => persistFormatToolbarVisible(visible),
    {
      onSuccess: () => {
        savedPreferences.formatToolbarVisible = visible;
        markPreferenceBaseline("formatToolbarVisible");
      },
      onError: (error) => {
        settlePreferenceFailure(
          "formatToolbarVisible",
          revision,
          () => formatToolbarVisible.value === visible,
          () => {
            formatToolbarVisible.value =
              savedPreferences.formatToolbarVisible;
          },
        );
        reportSettingsFailure(error);
      },
    },
  );
}

function findSettingsTab(): SettingsTabModel | null {
  return (
    tabs.value.find((tab): tab is SettingsTabModel => tab.kind === "settings") ??
    null
  );
}

/** The four entries all run the registry's app.settings command. */
function openSettings() {
  closeOverlaySidebar();
  void retrySettingsBaseline();
  const existing = findSettingsTab();
  if (existing !== null) {
    if (activeTabId.value === existing.id) {
      invalidateOlderOrdinaryOpens();
      void nextTick(() => {
        document.getElementById("settings-theme")?.focus();
      });
    } else {
      void activateTab(existing.id);
    }
    return;
  }
  const tab: SettingsTabModel = { id: nextTabId++, kind: "settings" };
  insertTab(tab);
  void activateTab(tab.id);
}

function pushNativeSettingsShortcut() {
  const command = getCommand("app.settings");
  if (command === undefined) return;
  const accelerator = nativeAccelerator(command, platform.value);
  if (accelerator === null) return;
  void setSettingsAccelerator(accelerator).catch(() => {
    // Windows and Linux have no native Settings item.
  });
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

/**
 * The workspace search field has no Escape handler of its own. It therefore
 * participates in the app-level overlay order even while the find panel is
 * open; other fields, such as the file-tree name editor, consume Escape before
 * it reaches the window listener.
 */
function isWorkspaceSearchInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.matches("[data-search-panel] [data-search-input]")
  );
}

// The Settings page uses native controls, so their text-editing ownership must
// stay intact. Only tab navigation and closing are global even from those
// controls; every other command still yields to the focused input.
const SETTINGS_GLOBAL_COMMANDS = new Set([
  "tab.next",
  "tab.previous",
  "tab.close",
]);

function settingsControlOwnsGlobalShortcut(
  target: EventTarget | null,
  commandId: string,
): boolean {
  return (
    currentSettings.value !== null &&
    target instanceof HTMLElement &&
    target.closest("[data-settings-view]") !== null &&
    SETTINGS_GLOBAL_COMMANDS.has(commandId)
  );
}

function closeLinkImageEditor(options: { restoreFocus?: boolean } = {}) {
  const state = linkImageEditor.value;
  if (state === null) return;
  linkImageEditorRevision += 1;
  const returnFocus = linkImageReturnFocus;
  linkImageEditor.value = null;
  linkImageReturnFocus = null;
  state.session.dispose();
  if (options.restoreFocus === false) return;
  void nextTick().then(() => {
    const active = document.activeElement;
    if (
      active !== null &&
      active !== document.body &&
      active !== document.documentElement
    ) {
      // Another control or popover took focus while this one closed.
      return;
    }
    if (returnFocus?.isConnected) {
      if (active !== returnFocus) returnFocus.focus();
      return;
    }
    editor?.focus();
  });
}

function handleEditLinkImage(session: LinkImageEditorSession | null) {
  if (session === null) {
    closeLinkImageEditor();
    return;
  }
  linkImageEditorRevision += 1;
  closePopoverMenus();
  linkImageReturnFocus =
    focusedControl() ?? editor?.view.contentDOM ?? null;
  linkImageEditor.value = {
    id: nextLinkImageEditorID++,
    session,
    initialFields: session.fields,
    fieldRevision: 0,
  };
}

function handleLinkImageFieldsChange() {
  const state = linkImageEditor.value;
  if (state !== null) {
    state.fieldRevision += 1;
  }
}

function completeLinkImage(values: readonly LinkImageFieldValues[]) {
  const state = linkImageEditor.value;
  if (state === null) return;
  state.session.complete(values);
  closeLinkImageEditor();
}

function removeLinkImage() {
  const state = linkImageEditor.value;
  if (state === null) return;
  state.session.remove();
  closeLinkImageEditor();
}

function linkImageRevealPath(path: string): string | null {
  const tab = currentMarkdown.value;
  if (tab === null || tab.kind !== "workspace" || workspace.value === null) {
    return null;
  }
  return resolveLocalImagePath(path, tab.path);
}

function isLinkImageRevealable(path: string): boolean {
  return linkImageRevealPath(path) !== null;
}

async function revealLinkImage(path: string) {
  const tab = currentMarkdown.value;
  const current = workspace.value;
  if (tab === null || current === null || tab.kind !== "workspace") return;
  const local = resolveLocalImagePath(path, tab.path);
  if (local === null) return;
  try {
    await revealImage(local, current.generation);
  } catch (error) {
    showNotice(`显示图片失败：${errorText(error)}`, "danger");
  }
}

type HeadingJumpResult = "found" | "missing" | "pending" | "stale";

async function jumpToHeading(
  view: EditorView,
  fragment: string,
  current: () => boolean,
): Promise<HeadingJumpResult> {
  if (!current()) return "stale";
  if (fragment === "") {
    view.dispatch({
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0, { y: "start" }),
    });
    view.focus();
    return "found";
  }
  let extraction = extractHeadingsWithStatus(view.state);
  if (!extraction.complete) {
    // One bounded handoff lets an already-running parse finish without
    // turning navigation into a polling loop.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (!current()) return "stale";
    extraction = extractHeadingsWithStatus(view.state);
  }
  if (!extraction.complete) {
    if (current()) showNotice("标题仍在解析，请稍后重试", "muted");
    return "pending";
  }
  const heading = findHeadingByFragment(extraction.headings, fragment);
  if (heading === null) {
    if (current()) showNotice("找不到标题", "danger");
    return "missing";
  }
  if (!current()) return "stale";
  view.dispatch({
    selection: { anchor: heading.position },
    effects: EditorView.scrollIntoView(heading.position, { y: "start" }),
  });
  view.focus();
  return "found";
}

/**
 * The single opening entry used by Mod/Ctrl-click and the link dialog. It
 * classifies the source destination, then delegates HTTP(S) to Go and
 * workspace/fragment navigation to the normal tab and heading flows.
 */
async function openLinkAddress(
  sourceAddress: string,
  options: { fromDialog?: boolean } = {},
) {
  const sourceTab = currentMarkdown.value;
  const sourceEditor = editor;
  if (sourceTab === null || sourceEditor === null) return;
  const navigationIntent = beginWorkspaceNavigationIntent();
  const source = captureNavigationSource(navigationIntent);
  if (options.fromDialog && source.dialogId === null) return;
  const sequence = ++linkNavigationSequence;
  const sourceCurrent = () =>
    linkNavigationSequence === sequence && navigationSourceCurrent(source);
  const sourceKind: "workspace" | "single" =
    sourceTab.kind === "workspace" ? "workspace" : "single";
  const sourceRoot = source.workspaceRoot;
  const sourceGeneration = source.workspaceGeneration;
  const destination = classifyLinkDestination(sourceAddress, {
    kind: sourceKind,
    path: sourceTab.path,
    root: sourceRoot,
  });

  if (destination.kind === "empty") {
    showNotice("链接地址为空", "muted");
    return;
  }
  if (destination.kind === "unsupported") {
    showNotice(destination.message, "danger");
    return;
  }
  if (destination.kind === "external") {
    try {
      await openExternalURL(destination.url);
    } catch (error) {
      if (!sourceCurrent()) return;
      showNotice(`打开链接失败：${errorText(error)}`, "danger");
    }
    return;
  }
  if (destination.kind === "fragment") {
    if (!sourceCurrent()) return;
    const result = await jumpToHeading(
      sourceEditor.view,
      destination.fragment,
      sourceCurrent,
    );
    if (
      result === "found" &&
      options.fromDialog &&
      sourceDialogCurrent(source)
    ) {
      closeLinkImageEditor({ restoreFocus: false });
    }
    return;
  }

  if (sourceRoot === null || sourceGeneration === 0) return;
  const handoff: { activation: WorkspaceActivation | null } = {
    activation: null,
  };
  const opened = await openWorkspaceFile(destination.path, undefined, {
    reveal: false,
    isRequestCurrent: sourceCurrent,
    navigationIntent,
    onHandoff: (granted) => {
      handoff.activation = granted;
    },
  });
  const activation = handoff.activation;
  if (
    !opened ||
    activation === null ||
    !workspaceActivationCurrent(activation) ||
    linkNavigationSequence !== sequence ||
    !isCurrentWorkspace(sourceRoot, sourceGeneration)
  ) {
    return;
  }
  if (
    !isTabForWorkspacePath(activation, sourceRoot, destination.path)
  ) {
    return;
  }
  if (destination.fragment === null) {
    if (
      options.fromDialog &&
      sourceDialogCurrent(source) &&
      workspaceActivationCurrent(activation)
    ) {
      closeLinkImageEditor({ restoreFocus: false });
    }
    return;
  }
  const result = await jumpToHeading(
    activation.view,
    destination.fragment,
    () => workspaceActivationCurrent(activation),
  );
  if (
    result === "found" &&
    options.fromDialog &&
    sourceDialogCurrent(source) &&
    workspaceActivationCurrent(activation)
  ) {
    closeLinkImageEditor({ restoreFocus: false });
  }
}

function openLinkImage(address: string) {
  void openLinkAddress(address, { fromDialog: true });
}

function closePopoverMenus() {
  closeLinkImageEditor({ restoreFocus: false });
  slashMenu?.close();
  topBar.value?.closeModeMenu();
  formatToolbar.value?.closeMenus();
  focusOutlineToggleIfInside();
  closeOutlineOverlay(false);
}

/** The compact mode menu is a popover; opening it replaces other popovers. */
function handleModeMenuWillOpen() {
  closeLinkImageEditor({ restoreFocus: false });
  editor?.search.close({ restoreFocus: false });
  formatToolbar.value?.closeMenus();
  focusOutlineToggleIfInside();
  closeOutlineOverlay(false);
}

/** Toolbar menus replace the other temporary popovers in the editor area. */
function handleFormatToolbarMenuWillOpen() {
  closeLinkImageEditor({ restoreFocus: false });
  slashMenu?.close();
  topBar.value?.closeModeMenu();
  editor?.search.close({ restoreFocus: false });
  focusOutlineToggleIfInside();
  closeOutlineOverlay(false);
}

/** Find is a popover, so opening it replaces the temporary outline. */
function handleFindOpened() {
  topBar.value?.closeModeMenu();
  formatToolbar.value?.closeMenus();
  closeOutlineOverlay(false);
}

function closePalettePopovers() {
  closePopoverMenus();
  editor?.search.close();
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
  paletteReturnFocus = focusedControl();
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
  void refreshSnippetCommands();
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
  if (paletteSession.value === null) return;
  paletteSession.value = null;
  // The panel no longer owns a visible list. Release its snapshot and make
  // any pending response stale before it can show a warning or repopulate a
  // later menu. Command execution captures its command before this call.
  clearSnippetCommands();
}

function showSidebarForSearch() {
  if (isWide.value) {
    sidebarOpen.value = true;
  } else {
    overlaySidebar.value = true;
  }
}

/** Opens the sidebar search view, or focuses its input when already open. */
function openWorkspaceSearch() {
  if (
    workspace.value === null ||
    dialogOpen ||
    recoveryDialog.value !== null ||
    recoveryChecking
  ) {
    return;
  }
  if (!searchOpen.value) {
    searchReturnFocus = focusedControl();
    searchOpen.value = true;
  }
  formatToolbar.value?.closeMenus();
  showSidebarForSearch();
  void nextTick(() => sidebar.value?.focusSearchInput());
}

/**
 * Leaves the search view for the file tree. The opener receives focus again;
 * if it disappeared with an overlay sidebar, the search entry or the sidebar
 * toggle is the fallback.
 */
function closeWorkspaceSearch(options: { restoreFocus?: boolean } = {}) {
  if (!searchOpen.value) return;
  const origin = searchReturnFocus;
  searchReturnFocus = null;
  searchOpen.value = false;
  if (options.restoreFocus === false) return;
  void nextTick().then(() => {
    if (focusedControl() !== null) return;
    if (overlaySidebar.value) {
      sidebar.value?.focusSearchButton();
      return;
    }
    if (origin?.isConnected) {
      origin.focus();
      return;
    }
    sidebar.value?.focusSearchButton();
    if (focusedControl() === null) {
      document.querySelector<HTMLElement>("[data-sidebar-toggle]")?.focus();
    }
  });
}

/**
 * Opens a result through the normal tab flow, so an existing dirty tab is
 * switched to rather than reread. The navigation intent and full source
 * snapshot are captured before the disk read; a later source or active-tab
 * change makes this request stale before it can insert, activate or focus
 * another tab. The open flow still protects the workspace generation, and the
 * stable line and UTF-16 column plus full line/match fingerprints decide
 * whether the target is still provable.
 */
async function openSearchResult(target: SearchOpenTarget): Promise<boolean> {
  const current = workspace.value;
  if (current === null || current.generation !== target.generation) {
    showNotice("工作区已切换，请重新搜索", "danger");
    return false;
  }
  const root = current.root;
  const generation = current.generation;
  const navigationIntent = beginWorkspaceNavigationIntent();
  const source = captureNavigationSource(navigationIntent);
  const searchSequence = ++searchNavigationSequence;
  const isRequestCurrent = () =>
    searchSequence === searchNavigationSequence &&
    navigationSourceCurrent(source);
  const handoff: { activation: WorkspaceActivation | null } = {
    activation: null,
  };
  const opened = await openWorkspaceFile(target.line.path, undefined, {
    reveal: false,
    isRequestCurrent,
    navigationIntent,
    onHandoff: (granted) => {
      handoff.activation = granted;
    },
  });
  const activation = handoff.activation;
  if (
    !opened ||
    activation === null ||
    !workspaceActivationCurrent(activation) ||
    searchSequence !== searchNavigationSequence ||
    !isCurrentWorkspace(root, generation)
  ) {
    return false;
  }

  if (
    activation.workspaceRoot !== root ||
    activation.workspaceGeneration !== generation ||
    !isTabForWorkspacePath(activation, root, target.line.path)
  ) {
    return false;
  }
  const located = locateSearchMatch(activation.text, target.line, target.match);
  if (located === null) {
    if (workspaceActivationCurrent(activation)) {
      showNotice("搜索结果已过期，请重新搜索", "danger");
    }
    return false;
  }
  if (!workspaceActivationCurrent(activation)) {
    return false;
  }
  activation.view.dispatch({
    selection: EditorSelection.single(located.from, located.to),
    effects: EditorView.scrollIntoView(located.from, { y: "center" }),
  });
  activation.view.focus();
  return true;
}

watch(paletteSession, async (session, previousSession) => {
  if (session !== null || previousSession === null) {
    return;
  }
  const origin = paletteReturnFocus;
  paletteReturnFocus = null;
  await nextTick();
  // The panel restores a connected opener itself. When the opener was inside
  // the overlay sidebar, that sidebar was already hidden when the panel
  // opened, so apply the same fallback as an explicit sidebar dismissal.
  if (focusedControl() !== null) {
    return;
  }
  focusAfterRemovedSidebarControl(origin);
});

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
      toggleOutline,
      setFormatToolbarVisible,
      setMode,
      toggleTheme,
      openSettings,
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
      openWorkspaceSearch,
    },
  };
}

async function runPaletteCommand(id: string) {
  const session = paletteSession.value;
  if (session === null) return;
  // Capture the exact command the open panel displayed before closing, which
  // now releases the workspace snapshot. A command that differs from the
  // static registry entry came from the workspace menu snapshot.
  const command = getCommand(id, paletteMenuCommands.value);
  const isSnippetCommand =
    command !== undefined && command !== getCommand(id);
  const sourceWorkspace = workspace.value;
  closeCommandPalette();
  await nextTick();
  if (command === undefined || !isCommandAvailable(command)) {
    return;
  }
  if (isSnippetCommand) {
    const current = workspace.value;
    if (
      current === null ||
      sourceWorkspace === null ||
      current.root !== sourceWorkspace.root ||
      current.generation !== sourceWorkspace.generation
    ) {
      return;
    }
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

/**
 * Slash-menu Escape is handled inside CodeMirror before the window listener
 * runs and already changes `slashState`. Remember that it owned the key so the
 * same Escape does not also close the find panel or the overlay sidebar.
 */
function noteSlashEscape(event: KeyboardEvent) {
  if (event.key !== ESCAPE_HELP.eventKey) return;
  slashHandledEscape =
    slashState.value !== null &&
    !event.isComposing &&
    event.keyCode !== 229;
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
    if (event.key === ESCAPE_HELP.eventKey) {
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
  if (event.key === ESCAPE_HELP.eventKey) {
    const handledBySlash = slashHandledEscape;
    slashHandledEscape = false;
    if (handledBySlash) {
      return;
    }
    if (editor?.search.snapshot().open) {
      // Another text field, such as a rename box, owns its own Escape. The
      // find panel stops propagation itself and does not reach this branch;
      // the workspace search field deliberately yields to this order.
      if (isTextInput(event.target) && !isWorkspaceSearchInput(event.target)) {
        return;
      }
      event.preventDefault();
      editor.search.close();
      return;
    }
    if (outlineOverlayOpen.value) {
      event.preventDefault();
      closeOutlineOverlay(true);
      return;
    }
    if (overlaySidebar.value) {
      event.preventDefault();
      dismissOverlaySidebar();
    } else if (searchOpen.value) {
      event.preventDefault();
      closeWorkspaceSearch();
    }
    return;
  }
  runAppShortcutEvent(event);
}

/**
 * Runs one application shortcut, swallowing it even when its runtime
 * requirements are not met so WebView and system defaults do not act on it.
 */
function runAppShortcutEvent(event: KeyboardEvent): boolean {
  if (handledAppShortcutEvents.has(event)) {
    return true;
  }
  if (event.defaultPrevented) {
    return false;
  }
  const command = matchCommand(event, platform.value, commandRegistry, "app");
  if (command === null) {
    return false;
  }
  if (
    isTextInput(event.target) &&
    !settingsControlOwnsGlobalShortcut(event.target, command.id)
  ) {
    return false;
  }
  handledAppShortcutEvents.add(event);
  if (!commandContextAllows(command)) {
    event.preventDefault();
    return true;
  }
  const handled = command.run(commandContext(editor?.view ?? null));
  if (handled) {
    event.preventDefault();
  }
  return true;
}

function linkImageEditorElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-link-image-editor]");
}

function targetInsideLinkImageEditor(target: EventTarget | null): boolean {
  return (
    target instanceof Node &&
    linkImageEditorElement()?.contains(target) === true
  );
}

function editorOwnsKeyboardFocus(): boolean {
  if (editor === null) return false;
  const active = document.activeElement;
  return (
    active === editor.view.contentDOM ||
    editor.view.contentDOM.contains(active)
  );
}

/**
 * A plain click in immersive mode leaves focus in the document. Escape closes
 * the dialog from there, and Tab moves into its first field before CodeMirror
 * or the browser can move focus elsewhere.
 */
function handleLinkImageCapture(event: KeyboardEvent) {
  if (
    linkImageEditor.value === null ||
    event.isComposing ||
    event.keyCode === 229 ||
    dialogOpen ||
    recoveryDialog.value !== null ||
    paletteSession.value !== null
  ) {
    return;
  }
  if (event.key === ESCAPE_HELP.eventKey) {
    if (
      targetInsideLinkImageEditor(event.target) ||
      !editorOwnsKeyboardFocus()
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeLinkImageEditor();
    return;
  }
  if (
    event.key !== "Tab" ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    !linkImageEditor.value.session.preserveEditorFocus ||
    targetInsideLinkImageEditor(event.target)
  ) {
    return;
  }
  if (!editorOwnsKeyboardFocus()) return;
  event.preventDefault();
  event.stopPropagation();
  linkImageEditorPanel.value?.focusFirstField();
}

/**
 * Application shortcuts run in the capture phase so a registered binding such
 * as Windows Ctrl+Shift+L wins over CodeMirror's editor keymap instead of
 * selecting the same word first. Escape and panel keys stay in the bubble
 * handler, where their overlay order is decided.
 */
function handleAppShortcutCapture(event: KeyboardEvent) {
  if (event.key === ESCAPE_HELP.eventKey) {
    return;
  }
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (dialogOpen || recoveryDialog.value !== null || paletteSession.value !== null) {
    return;
  }
  runAppShortcutEvent(event);
}

async function newFile() {
  if (!workspace.value) {
    return;
  }
  if (searchOpen.value) {
    closeWorkspaceSearch();
    await nextTick();
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
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) &&
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
  const workspaceTabs = tabs.value.filter(
    (tab): tab is DocumentTabModel =>
      isDocumentTab(tab) &&
      (tab.kind === "workspace" || tab.kind === "preview"),
  );
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
    isSettings: tab.kind === "settings",
    inWorkspace: tab.kind === "workspace" || tab.kind === "preview",
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
  const documentTab = isDocumentTab(currentTab) ? currentTab : null;
  if (
    documentTab === null &&
    (choice === "reveal-in-tree" ||
      choice === "reveal" ||
      choice === "copy-path" ||
      choice === "copy-relative-path")
  ) {
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
      if (documentTab !== null && documentTab.kind !== "single") {
        await sidebar.value?.reveal(documentTab.path);
      }
      break;
    case "reveal":
      try {
        if (documentTab !== null && documentTab.kind === "single") {
          await revealSingleFile(documentTab.path);
        } else if (documentTab !== null && workspace.value !== null) {
          await revealEntry(documentTab.path, workspace.value.generation);
        }
      } catch (error) {
        showNotice(`无法显示：${errorText(error)}`, "danger");
      }
      break;
    case "copy-path": {
      const absolute =
        documentTab !== null && documentTab.kind === "single"
          ? documentTab.path
          : `${workspace.value?.root ?? ""}/${documentTab?.path ?? ""}`;
      if (!(await copyText(absolute))) {
        showNotice("复制失败", "danger");
      }
      break;
    }
    case "copy-relative-path":
      if (documentTab !== null && documentTab.kind !== "single") {
        if (!(await copyText(documentTab.path))) {
          showNotice("复制失败", "danger");
        }
      }
      break;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === "hidden") {
    if (fontWriteTimer !== null) flushFontPreferences();
    writeAllRecoveryCopies();
    void saveAllTabs();
    void persistTabsNow();
  }
}

function saveBeforeExit() {
  if (fontWriteTimer !== null) flushFontPreferences();
  writeAllRecoveryCopies();
  void saveAllTabs();
  void persistTabsNow();
}

function handleWindowResize() {
  handleResize();
}

// The native app menu reads the registry-formatted Settings shortcut from the
// page. Re-send it when the real platform arrives after App.Info().
watch(platform, pushNativeSettingsShortcut, { immediate: true });

onMounted(async () => {
  window.addEventListener("beforeunload", saveBeforeExit);
  window.addEventListener("pagehide", saveBeforeExit);
  window.addEventListener("resize", handleWindowResize);
  window.addEventListener("keydown", noteSlashEscape, true);
  window.addEventListener("keydown", handleLinkImageCapture, true);
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("keydown", handleAppShortcutCapture, true);
  document.addEventListener("pointerdown", handleOutlinePointerDown, true);
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
  cancelPendingOutlineFocusSettlement();
  if (fontWriteTimer !== null) {
    flushFontPreferences();
  }
  window.removeEventListener("beforeunload", saveBeforeExit);
  window.removeEventListener("pagehide", saveBeforeExit);
  window.removeEventListener("resize", handleWindowResize);
  window.removeEventListener("keydown", noteSlashEscape, true);
  window.removeEventListener("keydown", handleLinkImageCapture, true);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("keydown", handleAppShortcutCapture, true);
  document.removeEventListener("pointerdown", handleOutlinePointerDown, true);
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
  closeWorkspaceSearch({ restoreFocus: false });
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
  clearSnippetCommands();
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
      :search-active="searchOpen"
      :show-all-files="showAllFiles"
      :hide-markdown-extension="effectiveHideMarkdownExtension"
      @hide-sidebar="toggleSidebar"
      @open-folder="chooseFolder"
      @toggle-theme="toggleTheme"
      @search-all="openWorkspaceSearch"
      @close-search="closeWorkspaceSearch"
      @open-search-result="openSearchResult"
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
        :show-mode="tabs.length > 0 && currentSettings === null"
        :show-outline="!startState && currentSettings === null"
        :outline-enabled="outlineEnabled"
        :outline-on="outlineDisplayed"
        @close-tab="closeTab"
        @activate-tab="activateTab"
        @tab-menu="openTabMenu"
        @set-mode="setMode"
        @toggle-sidebar="toggleSidebar"
        @toggle-outline="toggleOutline"
        @open-folder="chooseFolder"
        @mode-menu-will-open="handleModeMenuWillOpen"
      />

      <div class="relative flex min-h-0 flex-1">
        <main class="flex min-w-0 flex-1 flex-col">
          <FormatToolbar
            v-if="formatToolbarVisible && isMarkdownOpen"
            ref="formatToolbar"
            :platform="platform"
            :active="formatToolbarState"
            :disabled="editorComposing"
            @run="runToolbarCommand"
            @menus-will-open="handleFormatToolbarMenuWillOpen"
            @focus-editor="editor?.focus()"
          />
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
            <SettingsView
              v-else-if="currentSettings"
              :platform="platform"
              :theme="theme"
              :ui-font="uiFont"
              :reading-font="readingFont"
              :code-font="codeFont"
              :show-all-files="showAllFiles"
              :hide-markdown-extension="hideMarkdownExtension"
              :format-toolbar-visible="formatToolbarVisible"
              :slash-enabled="slashEnabled"
              @update:theme="chooseTheme"
              @update:font="setFontPreference"
              @update:show-all-files="setShowAllFilesPreference"
              @update:hide-markdown-extension="
                setHideMarkdownExtensionPreference
              "
              @update:format-toolbar-visible="setFormatToolbarVisible"
              @update:slash-enabled="setSlashEnabledPreference"
            />
            <div
              ref="editorHost"
              v-show="isMarkdownOpen"
              class="h-full"
              aria-label="Markdown 编辑器"
            ></div>
            <FindReplacePanel
              v-if="findController"
              :controller="findController"
              :platform="platform"
              @opened="handleFindOpened"
              @open-palette="openCommandPalette"
            />
          </div>
        </main>
        <Outline
          v-if="outlineDisplayed && activeEditorView && currentMarkdown"
          :key="outlinePanelKey"
          ref="outlinePanel"
          :view="activeEditorView"
          :text="currentMarkdown.text"
          :fixed="outlineWide"
          @navigate="handleOutlineNavigate"
        />
      </div>

      <StatusBar
        :save-status="saveStatus"
        :notice="notice?.text ?? null"
        :notice-tone="notice?.tone"
        :notice-detail="notice?.detail"
        :show-theme-toggle="!sidebarShown"
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
      :commands="paletteMenuCommands"
      :commands-loading="workspaceSnippetCommandsLoading"
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

    <LinkImageEditor
      v-if="linkImageEditor"
      ref="linkImageEditorPanel"
      :key="linkImageEditor.id"
      :session="linkImageEditor.session"
      :initial-fields="linkImageEditor.initialFields"
      :platform="platform"
      :is-revealable-path="isLinkImageRevealable"
      @cancel="closeLinkImageEditor()"
      @complete="completeLinkImage"
      @remove="removeLinkImage"
      @reveal="revealLinkImage"
      @open="openLinkImage"
      @fields-change="handleLinkImageFieldsChange"
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
              : 'button-secondary'
          "
          @click="resolveDialog(action.value)"
        >
          {{ action.label }}
        </button>
      </template>
    </AppDialog>
  </div>
</template>
