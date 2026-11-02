<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { EditorMode } from "../editor";
import {
  shortcutText,
  type AppPlatform,
} from "../app/platform";
import AppIcon from "./AppIcon.vue";
import KeyHint from "./KeyHint.vue";

export interface TopBarTab {
  name: string;
  title: string;
  problem: "danger" | "warning" | null;
  problemLabel: string;
}

const props = defineProps<{
  tab: TopBarTab | null;
  mode: EditorMode;
  platform: AppPlatform;
  compact: boolean;
  sidebarShown: boolean;
  showSidebarToggle: boolean;
  showOpenFolder: boolean;
  outlineEnabled: boolean;
  outlineOn: boolean;
}>();

const emit = defineEmits<{
  "close-tab": [];
  "activate-tab": [];
  "set-mode": [mode: EditorMode];
  "toggle-sidebar": [];
  "toggle-outline": [];
  "open-folder": [];
}>();

const modes: readonly {
  id: EditorMode;
  label: string;
  full: string;
  command: "mode-live" | "mode-immersive" | "mode-source";
  icon: "live" | "immersive" | "source";
}[] = [
  { id: "live", label: "预览", full: "实时预览", command: "mode-live", icon: "live" },
  { id: "immersive", label: "沉浸", full: "沉浸", command: "mode-immersive", icon: "immersive" },
  { id: "source", label: "源码", full: "源码", command: "mode-source", icon: "source" },
];

const modeMenuOpen = ref(false);
const modeArea = ref<HTMLElement | null>(null);

const activeMode = computed(
  () => modes.find((item) => item.id === props.mode) ?? modes[0]!,
);

function modeTitle(id: EditorMode): string {
  const item = modes.find((entry) => entry.id === id) ?? modes[0]!;
  return `${item.full} ${shortcutText(item.command, props.platform)}`;
}

function chooseMode(next: EditorMode) {
  modeMenuOpen.value = false;
  emit("set-mode", next);
}

function handleModeKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && modeMenuOpen.value) {
    event.preventDefault();
    event.stopPropagation();
    modeMenuOpen.value = false;
  }
}

function handlePointerDown(event: PointerEvent) {
  if (!modeMenuOpen.value) {
    return;
  }
  if (event.target instanceof Node && modeArea.value?.contains(event.target)) {
    return;
  }
  modeMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("pointerdown", handlePointerDown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handlePointerDown, true);
});
</script>

<template>
  <header
    class="app-drag topbar relative flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pl-2"
    :class="{ 'topbar--inset-left': !sidebarShown }"
    @keydown="handleModeKeydown"
  >
    <button
      v-if="showSidebarToggle"
      type="button"
      data-sidebar-toggle
      class="app-no-drag focus-ring grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
      :aria-label="`显示侧栏 ${shortcutText('sidebar', platform)}`"
      :title="`显示侧栏 ${shortcutText('sidebar', platform)}`"
      @click="emit('toggle-sidebar')"
    >
      <AppIcon name="sidebar" />
    </button>

    <button
      v-if="showOpenFolder"
      type="button"
      class="app-no-drag focus-ring flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
      @click="emit('open-folder')"
    >
      <AppIcon name="folder" :size="14" />
      打开文件夹
    </button>

    <div
      class="app-no-drag flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      role="tablist"
      aria-label="打开的标签页"
    >
      <div
        v-if="tab"
        role="tab"
        aria-selected="true"
        tabindex="0"
        class="group flex h-7 min-w-24 max-w-50 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] pl-3 pr-1.5 text-[var(--text-primary)]"
        :title="tab.title"
        @click="emit('activate-tab')"
        @auxclick.middle.prevent="emit('close-tab')"
        @keydown.enter.prevent="emit('activate-tab')"
        @keydown.space.prevent="emit('activate-tab')"
      >
        <span class="min-w-0 flex-1 truncate text-[12px]">{{ tab.name }}</span>
        <span
          v-if="tab.problem"
          class="grid size-4 shrink-0 place-items-center"
          :title="tab.problemLabel"
          :aria-label="tab.problemLabel"
          role="img"
        >
          <span
            class="size-[7px] rounded-full"
            :class="
              tab.problem === 'danger'
                ? 'bg-[var(--status-danger-fg)]'
                : 'bg-[var(--status-warning-fg)]'
            "
          ></span>
        </span>
        <button
          v-else
          type="button"
          class="focus-ring grid size-4 shrink-0 place-items-center rounded-[3px] text-[var(--text-muted)] opacity-0 hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
          :aria-label="`关闭 ${tab.name}`"
          @click.stop="emit('close-tab')"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </div>
    </div>

    <div ref="modeArea" class="app-no-drag relative flex shrink-0 items-center gap-1">
      <div
        v-if="tab"
        class="flex gap-0.5 rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-0.5"
        role="group"
        aria-label="编辑模式"
      >
        <div v-if="compact" class="relative">
          <button
            type="button"
            class="focus-ring grid size-6 place-items-center rounded-[4px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
            :aria-label="`编辑模式：${activeMode.full}`"
            :title="modeTitle(activeMode.id)"
            :aria-expanded="modeMenuOpen"
            aria-haspopup="menu"
            @click="modeMenuOpen = !modeMenuOpen"
          >
            <AppIcon :name="activeMode.icon" :size="14" />
          </button>
          <div
            v-if="modeMenuOpen"
            role="menu"
            class="absolute right-0 top-[calc(100%+6px)] z-[var(--z-popover)] w-44 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1 text-[13px] shadow-[var(--shadow-lg)]"
          >
            <button
              v-for="item in modes"
              :key="item.id"
              type="button"
              role="menuitemradio"
              :aria-checked="mode === item.id"
              :aria-label="`${item.full} ${shortcutText(item.command, platform)}`"
              class="focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-[var(--surface-subtle)]"
              @click="chooseMode(item.id)"
            >
              <AppIcon :name="item.icon" :size="14" />
              <span class="flex-1">{{ item.full }}</span>
              <KeyHint :shortcut="shortcutText(item.command, platform)" />
            </button>
          </div>
        </div>
        <template v-else>
          <button
            v-for="item in modes"
            :key="item.id"
            type="button"
            class="focus-ring rounded-[4px] px-2 py-0.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            :class="{ 'bg-[var(--surface-subtle)] text-[var(--text-primary)]': mode === item.id }"
            :aria-pressed="mode === item.id"
            :title="modeTitle(item.id)"
            @click="chooseMode(item.id)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>

      <button
        type="button"
        class="focus-ring grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] disabled:cursor-default disabled:opacity-40"
        :class="{ 'bg-[var(--surface-subtle)] text-[var(--text-primary)]': outlineOn }"
        :disabled="!outlineEnabled"
        :aria-label="`显示或隐藏大纲 ${shortcutText('outline', platform)}`"
        :aria-pressed="outlineOn"
        :title="
          outlineEnabled
            ? `显示或隐藏大纲 ${shortcutText('outline', platform)}`
            : '大纲将在后续版本提供'
        "
        @click="emit('toggle-outline')"
      >
        <AppIcon name="outline" />
      </button>
    </div>
  </header>
</template>
