<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import {
  createEditor,
  type EditorHandle,
  type EditorMode,
} from "./editor";
import { latestOperation } from "./latest-operation";
import { SAMPLE_DOCUMENT } from "./sample";
import { getAppInfo, type AppInfo } from "./services/app";
import {
  chooseFolder,
  confirmDiscard,
  finishClose,
  onSaveBeforeClose,
  readFile,
  writeFile,
} from "./services/workspace";

const editorHost = ref<HTMLElement | null>(null);
const mode = ref<EditorMode>("live");
const documentText = ref(SAMPLE_DOCUMENT);
const appInfo = ref<AppInfo | null>(null);
const appInfoError = ref(false);
const files = ref<string[]>([]);
const currentFile = ref<string | null>(null);
const hasWorkspace = ref(false);
const saveStatus = ref("");

const modes: readonly { id: EditorMode; label: string; hint: string }[] = [
  { id: "live", label: "实时预览", hint: "光标所在行显示原文" },
  { id: "immersive", label: "沉浸", hint: "符号隐藏，⌘B 切换加粗" },
  { id: "source", label: "源码", hint: "始终显示 Markdown 原文" },
];

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const storedTheme = localStorage.getItem("nicole-theme");
const theme = ref<"light" | "dark">(
  storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : prefersDark
      ? "dark"
      : "light",
);
document.documentElement.classList.toggle("dark", theme.value === "dark");

const activeMode = computed(
  () => modes.find((item) => item.id === mode.value) ?? modes[0]!,
);
const themeAction = computed(() =>
  theme.value === "light" ? "切换到暗色主题" : "切换到亮色主题",
);

let editor: EditorHandle | null = null;

const AUTOSAVE_DELAY_MS = 1000;
const MIXED_LINE_ENDINGS_STATUS =
  "换行风格混合，未自动保存；切换或关闭时可放弃更改";
type LineEnding = "\n" | "\r\n" | "\r";

interface PendingEdit {
  path: string;
  generation: number;
  text: string;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingEdit: PendingEdit | null = null;
let saveQueue: Promise<boolean> = Promise.resolve(true);
// CodeMirror normalizes line breaks to "\n". Remember the file's style so a
// save does not rewrite every CRLF file as LF.
let lineEnding: LineEnding = "\n";
let mixedLineEndings = false;
// The text as it was read or last saved, with CodeMirror's normalized line
// breaks. Returning to it means there is nothing left to save.
let originalText = "";
let workspaceGeneration = 0;
let offSaveBeforeClose: (() => void) | null = null;
// Reads cannot be cancelled at the IPC layer. Instead, only the newest file
// selection may apply its result; opening a folder invalidates all reads.
const fileSelection = latestOperation();

function detectLineEndings(text: string): {
  ending: LineEnding;
  mixed: boolean;
} {
  const styles = new Set<LineEnding>();
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") {
        styles.add("\r\n");
        index++;
      } else {
        styles.add("\r");
      }
    } else if (text[index] === "\n") {
      styles.add("\n");
    }
  }
  if (styles.size === 0) {
    return { ending: "\n", mixed: false };
  }
  return { ending: [...styles][0]!, mixed: styles.size > 1 };
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function createEditorFor(parent: HTMLElement, doc: string): EditorHandle {
  return createEditor({
    parent,
    doc,
    mode: mode.value,
    resolveImage: (src) => src,
    onChange: (next) => {
      documentText.value = next;
      scheduleSave(next);
    },
  });
}

// A new editor gives every file its own undo history and decorations. It
// keeps the current mode; the theme lives on the document element.
function mountEditor(doc: string) {
  editor?.destroy();
  editor = null;
  const host = editorHost.value;
  if (!host) {
    documentText.value = doc;
    return;
  }
  host.replaceChildren();
  documentText.value = doc;
  editor = createEditorFor(host, doc);
  editor.focus();
}

// A folder switch has no file selected yet. Destroying the editor makes the
// placeholder non-editable instead of leaving the previous file available
// while edits are silently ignored.
function clearEditor() {
  editor?.destroy();
  editor = null;
  editorHost.value?.replaceChildren();
  documentText.value = "";
}

function scheduleSave(text: string) {
  const path = currentFile.value;
  if (path === null) {
    return;
  }
  if (text === originalText) {
    pendingEdit = null;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveStatus.value = "";
    return;
  }
  pendingEdit = { path, generation: workspaceGeneration, text };
  if (mixedLineEndings) {
    saveStatus.value = MIXED_LINE_ENDINGS_STATUS;
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    return;
  }
  saveStatus.value = "未保存";
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    void savePending();
  }, AUTOSAVE_DELAY_MS);
}

// Saves all pending edits before a switch. It returns false when the caller
// must stay on the current file: a failed write keeps the text pending, and a
// mixed-line-ending file is deliberately never auto-saved. Saves are queued
// so a switch waits for a write already in flight.
function savePending(): Promise<boolean> {
  const next = saveQueue.then(() => savePendingNow());
  saveQueue = next.then(
    (saved) => saved,
    () => false,
  );
  return next;
}

async function savePendingNow(): Promise<boolean> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  for (;;) {
    const edit = pendingEdit;
    if (edit === null) {
      return true;
    }
    // The edit belongs to the file and workspace that were active when it was
    // typed. Never write it under a newer file or generation; abandoning it
    // requires an explicit confirmation instead.
    if (
      edit.path !== currentFile.value ||
      edit.generation !== workspaceGeneration
    ) {
      return false;
    }
    if (mixedLineEndings) {
      saveStatus.value = MIXED_LINE_ENDINGS_STATUS;
      return false;
    }
    pendingEdit = null;
    saveStatus.value = "保存中…";
    try {
      await writeFile(
        edit.path,
        withOriginalLineEnding(edit.text),
        edit.generation,
      );
    } catch {
      if (currentFile.value === edit.path) {
        if (pendingEdit === null && documentText.value === edit.text) {
          pendingEdit = edit;
          saveStatus.value = "保存失败";
          return false;
        }
        // An undo may have restored the loaded text while the failed write
        // was in flight; there is nothing left to save in that case.
        if (pendingEdit === null && documentText.value === originalText) {
          saveStatus.value = "";
          return true;
        }
        saveStatus.value = "保存失败";
      }
      return false;
    }
    if (currentFile.value === edit.path) {
      originalText = edit.text;
      // The editor may have been changed while the write was in flight, even
      // back to the old text. Treat the on-disk text as the new baseline and
      // keep the current editor content pending.
      if (pendingEdit === null && documentText.value !== originalText) {
        pendingEdit = {
          path: edit.path,
          generation: edit.generation,
          text: documentText.value,
        };
      }
    }
    if (pendingEdit === null) {
      if (currentFile.value === edit.path) {
        saveStatus.value = "已保存";
      }
      return true;
    }
  }
}

function withOriginalLineEnding(text: string): string {
  if (lineEnding === "\n") {
    return text;
  }
  return text.replace(/\r\n?/g, "\n").replace(/\n/g, lineEnding);
}

function discardPending() {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  pendingEdit = null;
  if (currentFile.value !== null) {
    mountEditor(originalText);
    saveStatus.value = "已放弃更改";
  } else {
    saveStatus.value = "";
  }
}

async function confirmDiscardChanges(): Promise<boolean> {
  try {
    return await confirmDiscard();
  } catch {
    return false;
  }
}

// Returns true when it is safe to leave the current file. A failed save or a
// mixed-ending file needs an explicit discard confirmation; cancelling keeps
// the editor and its pending text untouched.
async function prepareToLeave(): Promise<boolean> {
  if (await savePending()) {
    return true;
  }
  if (!(await confirmDiscardChanges())) {
    return false;
  }
  discardPending();
  return true;
}

async function openFolder() {
  fileSelection.stop();
  if (!(await prepareToLeave())) {
    return;
  }
  let folder;
  try {
    folder = await chooseFolder();
  } catch {
    saveStatus.value = "打开失败";
    return;
  }
  if (folder.canceled) {
    return;
  }
  workspaceGeneration = folder.generation;
  files.value = folder.files;
  currentFile.value = null;
  pendingEdit = null;
  mixedLineEndings = false;
  lineEnding = "\n";
  originalText = "";
  hasWorkspace.value = true;
  clearEditor();
  saveStatus.value = "";
}

function loadFile(path: string, text: string) {
  const detected = detectLineEndings(text);
  lineEnding = detected.ending;
  mixedLineEndings = detected.mixed;
  originalText = normalizeLineEndings(text);
  currentFile.value = path;
  pendingEdit = null;
  mountEditor(originalText);
  saveStatus.value = detected.mixed ? MIXED_LINE_ENDINGS_STATUS : "";
}

async function selectFile(event: Event) {
  const select = event.target as HTMLSelectElement;
  const path = select.value;
  if (path === "") {
    return;
  }
  const operation = fileSelection.start();
  if (!(await prepareToLeave())) {
    select.value = currentFile.value ?? "";
    return;
  }
  let text: string;
  try {
    text = await readFile(path);
  } catch {
    if (!fileSelection.isCurrent(operation)) {
      select.value = currentFile.value ?? "";
      return;
    }
    select.value = currentFile.value ?? "";
    saveStatus.value = "读取失败";
    return;
  }
  if (!fileSelection.isCurrent(operation)) {
    select.value = currentFile.value ?? "";
    return;
  }
  // The old editor stays editable while the read runs. Save any edit typed in
  // that window before replacing the document; if it cannot be saved, ask
  // before discarding it and never carry its text into the newly selected
  // file.
  if (!(await prepareToLeave())) {
    select.value = currentFile.value ?? "";
    return;
  }
  if (!fileSelection.isCurrent(operation)) {
    select.value = currentFile.value ?? "";
    return;
  }
  loadFile(path, text);
  select.value = path;
}

function setMode(next: EditorMode) {
  mode.value = next;
  editor?.setMode(next);
  editor?.focus();
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme.value === "dark");
  localStorage.setItem("nicole-theme", theme.value);
}

function saveBeforeExit() {
  void savePending();
}

function saveWhenHidden() {
  if (document.visibilityState === "hidden") {
    void savePending();
  }
}

onMounted(async () => {
  window.addEventListener("beforeunload", saveBeforeExit);
  window.addEventListener("pagehide", saveBeforeExit);
  document.addEventListener("visibilitychange", saveWhenHidden);
  offSaveBeforeClose = onSaveBeforeClose(async (token) => {
    const saved = await savePending();
    try {
      await finishClose(token, saved);
    } catch {
      // The window may already be gone; the save result was already shown.
    }
  });
  mountEditor(SAMPLE_DOCUMENT);

  try {
    appInfo.value = await getAppInfo();
  } catch {
    appInfoError.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", saveBeforeExit);
  window.removeEventListener("pagehide", saveBeforeExit);
  document.removeEventListener("visibilitychange", saveWhenHidden);
  offSaveBeforeClose?.();
  offSaveBeforeClose = null;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void savePending();
  editor?.destroy();
  editor = null;
});
</script>

<template>
  <div
    class="flex h-full flex-col bg-[var(--surface-canvas)] text-[var(--text-primary)]"
  >
    <header
      class="flex shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] px-6 py-3"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="font-display text-lg font-semibold tracking-tight">
          Nicole
        </span>
        <span class="text-xs text-[var(--text-muted)]">
          {{ appInfo ? `v${appInfo.version}` : "" }}
        </span>
      </div>

      <button
        type="button"
        class="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
        @click="openFolder"
      >
        打开文件夹
      </button>

      <select
        class="max-w-48 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-panel)] px-3 py-1.5 text-sm text-[var(--text-secondary)] disabled:opacity-50"
        :value="currentFile ?? ''"
        :disabled="files.length === 0"
        aria-label="Markdown 文件"
        @change="selectFile"
      >
        <option value="" disabled>选择文件</option>
        <option v-for="file in files" :key="file" :value="file">
          {{ file }}
        </option>
      </select>

      <div
        class="mx-auto flex rounded-full border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-1"
        role="group"
        aria-label="编辑模式"
      >
        <button
          v-for="item in modes"
          :key="item.id"
          type="button"
          class="rounded-full px-4 py-1.5 text-sm transition-colors"
          :class="
            mode === item.id
              ? 'bg-[var(--accent-primary)] font-medium text-[var(--accent-contrast)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          "
          :aria-pressed="mode === item.id"
          :title="item.hint"
          @click="setMode(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <button
        type="button"
        class="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
        :aria-label="themeAction"
        :title="themeAction"
        @click="toggleTheme"
      >
        {{ theme === "light" ? "暗色" : "亮色" }}
      </button>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden">
      <div
        v-show="hasWorkspace && currentFile === null"
        data-placeholder="choose-file"
        class="flex h-full items-center justify-center text-sm text-[var(--text-muted)]"
      >
        选择一个 Markdown 文件开始编辑
      </div>
      <div
        v-show="!hasWorkspace || currentFile !== null"
        ref="editorHost"
        class="h-full"
        aria-label="Markdown 编辑器"
      ></div>
    </main>

    <footer
      class="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-6 py-2 text-xs text-[var(--text-muted)]"
    >
      <span>{{ activeMode.label }} · {{ activeMode.hint }}</span>
      <span class="flex items-center gap-3">
        <span v-if="saveStatus">{{ saveStatus }}</span>
        <span>{{ documentText.length }} 字符</span>
        <span v-if="appInfo">
          {{ appInfo.os }}/{{ appInfo.arch }} · {{ appInfo.goVersion }}
        </span>
        <span v-else-if="appInfoError">Go 服务未连接</span>
        <span v-else>连接 Go…</span>
      </span>
    </footer>
  </div>
</template>
