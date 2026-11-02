<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import type { TreeEditState, TreeNode } from "../app/file-tree";
import {
  shortcutText,
  type AppPlatform,
} from "../app/platform";
import type { WorkspaceFileEvent } from "../services/mygo";
import AppIcon from "./AppIcon.vue";
import FileTree from "./FileTree.vue";

export type SidebarMode = "pinned" | "overlay";

const props = defineProps<{
  width: number;
  mode: SidebarMode;
  platform: AppPlatform;
  rootName: string;
  rootPath: string;
  rootDisplayPath: string;
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
  status: [message: string];
}>();

const tree = ref<InstanceType<typeof FileTree> | null>(null);
const resizing = ref(false);
let dragStartX = 0;
let dragStartWidth = 0;
let lastWidth = props.width;

const asideStyle = computed(() => ({
  width: `${props.width}px`,
}));

const sidebarShortcut = computed(() =>
  shortcutText("sidebar", props.platform),
);
const themeAction = computed(() =>
  props.isDark ? "切换到亮色主题" : "切换到暗色主题",
);

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
  refreshFromEvents(events: readonly WorkspaceFileEvent[]) {
    return tree.value?.refreshFromEvents(events);
  },
  reveal(path: string) {
    return tree.value?.reveal(path);
  },
  removePath(path: string) {
    tree.value?.removePath(path);
  },
  startCreate(kind: "create-file" | "create-folder", dir: string) {
    return tree.value?.startCreate(kind, dir);
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
        class="app-no-drag focus-ring grid size-7 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
        :aria-label="`隐藏侧栏 ${sidebarShortcut}`"
        :title="`隐藏侧栏 ${sidebarShortcut}`"
        @click="emit('hide-sidebar')"
      >
        <AppIcon name="sidebar" />
      </button>
    </div>

    <button
      type="button"
      class="focus-ring mx-2.5 mb-2 flex shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] px-2 py-1.5 text-[12px] text-[var(--text-muted)] disabled:cursor-default"
      disabled
      :title="`搜索全部文件夹 ${shortcutText('search', platform)}，将在后续版本提供`"
      aria-label="搜索全部文件夹，将在后续版本提供"
      @click="emit('search-all')"
    >
      <AppIcon name="search" :size="13" />
      <span class="flex-1 text-left">搜索全部文件夹</span>
      <kbd class="text-[11px]">{{ shortcutText('search', platform) }}</kbd>
    </button>

    <FileTree
      ref="tree"
      :root-name="rootName"
      :root-path="rootPath"
      :root-display-path="rootDisplayPath"
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
      @status="emit('status', $event)"
    />

    <div
      class="flex shrink-0 items-center justify-between border-t border-[var(--border-subtle)] px-2 py-1.5"
    >
      <button
        type="button"
        class="focus-ring flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
        @click="emit('open-folder')"
      >
        <AppIcon name="plus" :size="13" />
        打开文件夹
      </button>
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="focus-ring grid size-6 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
          :aria-label="themeAction"
          :title="themeAction"
          @click="emit('toggle-theme')"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="14" />
        </button>
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
