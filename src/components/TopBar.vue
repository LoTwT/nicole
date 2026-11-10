<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import type { EditorMode } from "../editor";
import type { AppPlatform } from "../app/platform";
import { commandShortcut } from "../commands/registry";
import AppIcon from "./AppIcon.vue";
import KeyHint from "./KeyHint.vue";

export interface TopBarTab {
  id: number;
  name: string;
  /** Same-name disambiguation, e.g. the parent folder name. */
  suffix: string | null;
  title: string;
  problem: "danger" | "warning" | null;
  problemLabel: string;
}

const props = defineProps<{
  tabs: readonly TopBarTab[];
  activeTabId: number | null;
  mode: EditorMode;
  platform: AppPlatform;
  compact: boolean;
  sidebarShown: boolean;
  showSidebarToggle: boolean;
  showOpenFolder: boolean;
  showOutline: boolean;
  outlineEnabled: boolean;
  outlineOn: boolean;
}>();

const emit = defineEmits<{
  "close-tab": [id: number];
  "activate-tab": [id: number];
  "tab-menu": [id: number, x: number, y: number];
  "set-mode": [mode: EditorMode];
  "toggle-sidebar": [];
  "toggle-outline": [];
  "open-folder": [];
}>();

const modes: readonly {
  id: EditorMode;
  label: string;
  full: string;
  command: "mode.live" | "mode.immersive" | "mode.source";
  icon: "live" | "immersive" | "source";
}[] = [
  { id: "live", label: "预览", full: "实时预览", command: "mode.live", icon: "live" },
  { id: "immersive", label: "沉浸", full: "沉浸", command: "mode.immersive", icon: "immersive" },
  { id: "source", label: "源码", full: "源码", command: "mode.source", icon: "source" },
];

const modeMenuOpen = ref(false);
const modeArea = ref<HTMLElement | null>(null);
const tablist = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

const activeMode = computed(
  () => modes.find((item) => item.id === props.mode) ?? modes[0]!,
);

function tabControlHoverClass(tabId: number): string {
  return tabId === props.activeTabId
    ? "hover:bg-[var(--surface-subtle)]"
    : "hover:bg-[var(--surface-muted)]";
}

function modeTitle(id: EditorMode): string {
  const item = modes.find((entry) => entry.id === id) ?? modes[0]!;
  return `${item.full} ${commandShortcut(item.command, props.platform)}`;
}

function chooseMode(next: EditorMode) {
  modeMenuOpen.value = false;
  emit("set-mode", next);
}

function closeModeMenu() {
  modeMenuOpen.value = false;
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

function tabElements(): HTMLElement[] {
  return [
    ...(tablist.value?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
  ];
}

function scrollActiveTabIntoView() {
  const active = tabElements().find(
    (element) => element.dataset.tabId === String(props.activeTabId),
  );
  active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function focusTab(index: number) {
  const elements = tabElements();
  if (elements.length === 0) {
    return;
  }
  const next = (index + elements.length) % elements.length;
  const element = elements[next]!;
  element.focus();
  element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function handleTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusTab(index + 1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusTab(index - 1);
    return;
  }
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target === event.currentTarget
  ) {
    event.preventDefault();
    emit("activate-tab", props.tabs[index]!.id);
  }
}

watch(
  () => [props.activeTabId, props.tabs.length] as const,
  async () => {
    await nextTick();
    scrollActiveTabIntoView();
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", handlePointerDown, true);
  scrollActiveTabIntoView();
  if (typeof ResizeObserver !== "undefined" && tablist.value) {
    resizeObserver = new ResizeObserver(() => scrollActiveTabIntoView());
    resizeObserver.observe(tablist.value);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handlePointerDown, true);
  resizeObserver?.disconnect();
  resizeObserver = null;
});

defineExpose({ closeModeMenu });
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
      :aria-label="`显示侧栏 ${commandShortcut('nav.toggle-sidebar', platform)}`"
      :title="`显示侧栏 ${commandShortcut('nav.toggle-sidebar', platform)}`"
      @mousedown.prevent
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
      ref="tablist"
      class="app-no-drag flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden"
      role="tablist"
      aria-label="打开的标签页"
    >
      <div
        v-for="(tab, index) in tabs"
        :key="tab.id"
        role="tab"
        :aria-selected="tab.id === activeTabId"
        :data-tab-id="tab.id"
        :tabindex="tab.id === activeTabId ? 0 : -1"
        class="group flex h-7 min-w-24 max-w-50 shrink-0 select-none items-center gap-1.5 rounded-[var(--radius-control)] pl-3 pr-1.5"
        :class="
          tab.id === activeTabId
            ? 'bg-[var(--surface-muted)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]'
        "
        :title="tab.title"
        @click="emit('activate-tab', tab.id)"
        @auxclick.middle.prevent="emit('close-tab', tab.id)"
        @contextmenu.prevent="
          emit('tab-menu', tab.id, $event.clientX, $event.clientY)
        "
        @keydown="handleTabKeydown($event, index)"
      >
        <span class="min-w-0 flex-1 truncate text-[12px]">{{ tab.name }}</span>
        <span
          v-if="tab.suffix"
          class="shrink-0 text-[11px] text-[var(--text-muted)]"
        >
          {{ tab.suffix }}
        </span>
        <button
          v-if="tab.problem"
          type="button"
          class="focus-ring grid size-4 shrink-0 place-items-center rounded-[3px]"
          :class="tabControlHoverClass(tab.id)"
          :title="tab.problemLabel"
          :aria-label="`关闭 ${tab.name}：${tab.problemLabel}`"
          @click.stop="emit('close-tab', tab.id)"
        >
          <span
            class="size-[7px] rounded-full"
            :class="
              tab.problem === 'danger'
                ? 'bg-[var(--status-danger-fg)]'
                : 'bg-[var(--status-warning-fg)]'
            "
            role="img"
            :aria-label="tab.problemLabel"
          ></span>
        </button>
        <button
          v-else
          type="button"
          class="focus-ring grid size-4 shrink-0 place-items-center rounded-[3px] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
          :class="[
            tab.id === activeTabId ? 'opacity-100' : 'opacity-0',
            tabControlHoverClass(tab.id),
          ]"
          :aria-label="`关闭 ${tab.name}`"
          @click.stop="emit('close-tab', tab.id)"
        >
          <AppIcon name="close" :size="12" />
        </button>
      </div>
    </div>

    <div ref="modeArea" class="app-no-drag relative flex shrink-0 items-center gap-1">
      <div
        v-if="tabs.length > 0"
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
              :aria-label="`${item.full} ${commandShortcut(item.command, platform)}`"
              class="focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-[var(--surface-subtle)]"
              @click="chooseMode(item.id)"
            >
              <AppIcon :name="item.icon" :size="14" />
              <span class="flex-1">{{ item.full }}</span>
              <KeyHint :shortcut="commandShortcut(item.command, platform)" />
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
        v-if="showOutline"
        type="button"
        class="focus-ring grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] disabled:cursor-default disabled:opacity-40"
        :class="{ 'bg-[var(--surface-subtle)] text-[var(--text-primary)]': outlineOn }"
        :disabled="!outlineEnabled"
        :aria-label="`显示或隐藏大纲 ${commandShortcut('nav.toggle-outline', platform)}`"
        :aria-pressed="outlineOn"
        :title="
          outlineEnabled
            ? `显示或隐藏大纲 ${commandShortcut('nav.toggle-outline', platform)}`
            : '大纲将在后续版本提供'
        "
        @click="emit('toggle-outline')"
      >
        <AppIcon name="outline" />
      </button>
    </div>
  </header>
</template>
