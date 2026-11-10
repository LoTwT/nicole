<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import { buildContextMenu } from "../app/context-menu";
import type { TreeEditState, TreeNode } from "../app/file-tree";
import type { AppPlatform } from "../app/platform";
import { commandShortcut } from "../commands/registry";
import { copyText } from "../services/clipboard";
import { popupNativeMenu } from "../services/menu";
import type { WorkspaceFileEvent } from "../services/mygo";
import AppIcon from "./AppIcon.vue";
import FileTree from "./FileTree.vue";
import ThemeToggle from "./ThemeToggle.vue";

export type SidebarMode = "pinned" | "overlay";

const props = defineProps<{
  width: number;
  mode: SidebarMode;
  platform: AppPlatform;
  rootName: string;
  rootPath: string;
  generation: number;
  selectedPath: string | null;
  initialExpanded: readonly string[];
  isDark: boolean;
}>();

const emit = defineEmits<{
  "hide-sidebar": [];
  "open-folder": [];
  "open-settings": [];
  "toggle-theme": [];
  "search-all": [];
  "width-change": [width: number];
  "width-commit": [width: number];
  "reset-width": [];
  "open-entry": [entry: TreeNode];
  "entry-created": [path: string, isDir: boolean];
  "entry-renaming": [oldPath: string, newPath: string, isDir: boolean];
  "entry-rename-failed": [oldPath: string];
  "entry-renamed": [oldPath: string, newPath: string, isDir: boolean];
  "trash-request": [entry: TreeNode];
  "expanded-change": [folders: string[]];
  "run-command": [id: string];
  status: [message: string];
}>();

const tree = ref<InstanceType<typeof FileTree> | null>(null);
const newFileButton = ref<HTMLButtonElement | null>(null);
const newFolderButton = ref<HTMLButtonElement | null>(null);
const moreButton = ref<HTMLButtonElement | null>(null);
const resizing = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;
let lastWidth = props.width;

const asideStyle = computed(() => ({
  width: `${props.width}px`,
}));

const sidebarShortcut = computed(() =>
  commandShortcut("nav.toggle-sidebar", props.platform),
);
const newFileHint = computed(
  () => `新建文件 ${commandShortcut("app.new-file", props.platform)}`,
);
const newFolderHint = computed(
  () => `新建文件夹 ${commandShortcut("file-tree.new-folder", props.platform)}`,
);
const collapseHint = "全部折叠";
const moreHint = "更多";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function startRootCreate(
  kind: "create-file" | "create-folder",
  returnFocus: HTMLElement | null,
) {
  void tree.value?.startCreate(kind, ".", returnFocus);
}

async function collapseAll() {
  await tree.value?.collapseAll();
}

async function openMoreMenu() {
  const rect = moreButton.value?.getBoundingClientRect();
  if (!rect) {
    return;
  }
  let choice = "";
  try {
    choice = await popupNativeMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
      items: buildContextMenu({
        target: "workspace-tools",
        platform: props.platform,
        isMarkdown: false,
        inWorkspace: true,
      }),
    });
  } catch (error) {
    emit("status", `菜单打开失败：${errorText(error)}`);
    return;
  }
  if (choice === "copy-workspace-path") {
    if (!(await copyText(props.rootPath))) {
      emit("status", "复制失败");
    }
    return;
  }
  if (choice !== "") {
    emit("run-command", choice);
  }
}

function startResize(event: PointerEvent) {
  if (event.button !== 0) {
    return;
  }
  event.preventDefault();
  resizing.value = true;
  dragStartX = event.clientX;
  dragStartWidth = props.width;
  lastWidth = props.width;
  window.addEventListener("pointermove", moveResize);
  window.addEventListener("pointerup", endResize, { once: true });
}

function moveResize(event: PointerEvent) {
  if (!resizing.value) {
    return;
  }
  const width = Math.min(
    400,
    Math.max(200, dragStartWidth + event.clientX - dragStartX),
  );
  lastWidth = width;
  emit("width-change", width);
}

function endResize() {
  if (!resizing.value) {
    return;
  }
  resizing.value = false;
  window.removeEventListener("pointermove", moveResize);
  emit("width-commit", lastWidth);
}

function resetWidth() {
  emit("reset-width");
}

function resizeWithKeyboard(event: KeyboardEvent) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
    return;
  }
  event.preventDefault();
  const delta = event.key === "ArrowLeft" ? -10 : 10;
  const width = Math.min(400, Math.max(200, props.width + delta));
  emit("width-change", width);
  emit("width-commit", width);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", moveResize);
});

defineExpose({
  refreshFolder(path: string) {
    return tree.value?.refreshFolder(path);
  },
  refreshFromEvents(events: readonly WorkspaceFileEvent[]) {
    return tree.value?.refreshFromEvents(events);
  },
  reveal(path: string) {
    return tree.value?.reveal(path);
  },
  removePath(path: string) {
    return tree.value?.removePath(path);
  },
  startCreate(
    kind: "create-file" | "create-folder",
    dir: string,
    returnFocus: HTMLElement | null = null,
  ) {
    return tree.value?.startCreate(kind, dir, returnFocus);
  },
  collapseAll() {
    return tree.value?.collapseAll();
  },
});
</script>

<template>
  <aside
    class="sidebar flex min-h-0 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-panel)]"
    :class="{ 'sidebar--overlay': mode === 'overlay' }"
    :style="asideStyle"
    aria-label="侧栏"
  >
    <div
      class="app-drag sidebar-top flex h-10 shrink-0 items-center justify-end pr-2"
    >
      <button
        type="button"
        data-sidebar-hide
        class="app-no-drag focus-ring grid size-7 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
        :aria-label="`隐藏侧栏 ${sidebarShortcut}`"
        :title="`隐藏侧栏 ${sidebarShortcut}`"
        @mousedown.prevent
        @click="emit('hide-sidebar')"
      >
        <AppIcon name="sidebar" />
      </button>
    </div>

    <button
      type="button"
      class="focus-ring mx-2.5 mb-2 flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] px-2 py-1.5 text-[12px] text-[var(--text-muted)] disabled:cursor-default disabled:opacity-50"
      disabled
      :title="`搜索工作区 ${commandShortcut('nav.search', platform)}，将在后续版本提供`"
      :aria-label="`搜索工作区 ${commandShortcut('nav.search', platform)}，将在后续版本提供`"
      @click="emit('search-all')"
    >
      <AppIcon name="search" :size="13" />
      <span class="flex-1 text-left">搜索工作区</span>
    </button>

    <div
      class="flex h-[26px] shrink-0 items-center gap-0.5 px-2.5"
      role="group"
      aria-label="工作区操作"
    >
      <span
        class="min-w-0 flex-1 truncate text-[11px] font-semibold text-[var(--text-muted)]"
        :title="rootName"
      >
        {{ rootName }}
      </span>
      <button
        ref="newFileButton"
        type="button"
        class="focus-ring grid size-[22px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        :aria-label="newFileHint"
        :title="newFileHint"
        @click="startRootCreate('create-file', newFileButton)"
      >
        <AppIcon name="file-plus" :size="14" />
      </button>
      <button
        ref="newFolderButton"
        type="button"
        class="focus-ring grid size-[22px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        :aria-label="newFolderHint"
        :title="newFolderHint"
        @click="startRootCreate('create-folder', newFolderButton)"
      >
        <AppIcon name="folder-plus" :size="14" />
      </button>
      <button
        type="button"
        class="focus-ring grid size-[22px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        :aria-label="collapseHint"
        :title="collapseHint"
        @click="collapseAll"
      >
        <AppIcon name="chevrons-down-up" :size="14" />
      </button>
      <button
        ref="moreButton"
        type="button"
        class="focus-ring grid size-[22px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        :aria-label="moreHint"
        :title="moreHint"
        aria-haspopup="menu"
        @click="openMoreMenu"
      >
        <AppIcon name="more" :size="14" />
      </button>
    </div>

    <FileTree
      ref="tree"
      :root-path="rootPath"
      :generation="generation"
      :selected-path="selectedPath"
      :platform="platform"
      :initial-expanded="initialExpanded"
      @open-entry="emit('open-entry', $event)"
      @entry-created="(path, isDir) => emit('entry-created', path, isDir)"
      @entry-renaming="
        (oldPath, newPath, isDir) =>
          emit('entry-renaming', oldPath, newPath, isDir)
      "
      @entry-rename-failed="(oldPath) => emit('entry-rename-failed', oldPath)"
      @entry-renamed="
        (oldPath, newPath, isDir) =>
          emit('entry-renamed', oldPath, newPath, isDir)
      "
      @trash-request="emit('trash-request', $event)"
      @expanded-change="emit('expanded-change', $event)"
      @run-command="emit('run-command', $event)"
      @status="emit('status', $event)"
    />

    <div
      class="flex h-[26px] shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-2 py-0"
    >
      <button
        type="button"
        class="focus-ring grid size-6 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
        :aria-label="`切换文件夹 ${commandShortcut('app.open-folder', platform)}`"
        :title="`切换文件夹 ${commandShortcut('app.open-folder', platform)}`"
        @click="emit('open-folder')"
      >
        <AppIcon name="folder-open" :size="14" />
      </button>
      <div class="flex items-center gap-1">
        <ThemeToggle
          data-theme-toggle="sidebar"
          :is-dark="isDark"
          @toggle="emit('toggle-theme')"
        />
        <button
          type="button"
          class="focus-ring grid size-6 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] disabled:cursor-default disabled:opacity-50"
          disabled
          aria-label="设置，将在后续版本提供"
          title="设置将在后续版本提供"
          @click="emit('open-settings')"
        >
          <AppIcon name="gear" :size="14" />
        </button>
      </div>
    </div>

    <div
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="width"
      aria-valuemin="200"
      aria-valuemax="400"
      aria-label="调整侧栏宽度"
      tabindex="0"
      @pointerdown="startResize"
      @dblclick="resetWidth"
      @keydown="resizeWithKeyboard"
    ></div>
  </aside>
</template>
