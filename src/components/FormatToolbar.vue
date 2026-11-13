<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import type { AppPlatform } from "../app/platform";
import type { FormatToolbarState } from "../commands/format";
import { commandShortcut, getCommand } from "../commands/registry";
import type { CommandDefinition } from "../commands/types";
import AppIcon from "./AppIcon.vue";
import KeyHint from "./KeyHint.vue";

type ToolbarIconName =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "link"
  | "pilcrow"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "list"
  | "list-ordered"
  | "list-todo"
  | "quote"
  | "square-code"
  | "table"
  | "image"
  | "more"
  | "chevron-down";

interface CommandItem {
  kind: "command";
  key: string;
  group: number;
  command: CommandDefinition;
}

interface ParagraphItem {
  kind: "paragraph";
  key: "paragraph";
  group: 2;
  commands: readonly CommandDefinition[];
}

type ToolbarItem = CommandItem | ParagraphItem;

type MenuKind = "paragraph" | "more";

interface MenuEntry {
  key: string;
  group: number;
  command: CommandDefinition;
  paragraphType: boolean;
  dividerBefore: boolean;
}

const props = defineProps<{
  platform: AppPlatform;
  active: FormatToolbarState;
  disabled: boolean;
}>();

const emit = defineEmits<{
  run: [id: string];
  "menus-will-open": [];
  "focus-editor": [];
}>();

const INLINE_IDS = [
  "format.bold",
  "format.italic",
  "format.strikethrough",
  "format.inline-code",
  "format.link",
] as const;
const PARAGRAPH_TYPE_IDS = [
  "format.paragraph",
  "format.heading-1",
  "format.heading-2",
  "format.heading-3",
] as const;
const PARAGRAPH_ACTION_IDS = [
  "format.bullet-list",
  "format.ordered-list",
  "format.task-list",
  "format.quote",
  "format.code-block",
] as const;
const CONTENT_IDS = ["insert.table", "insert.image"] as const;

// The measured row mirrors the real buttons without interactive elements, so
// a narrow toolbar can move whole commands into the More menu.
const GAP = 4;
const SEPARATOR_WIDTH = 1;
const SIDE_PADDING = 32;

function definitions(ids: readonly string[]): CommandDefinition[] {
  const found: CommandDefinition[] = [];
  for (const id of ids) {
    const command = getCommand(id);
    if (command !== undefined) found.push(command);
  }
  return found;
}

const paragraphCommands = computed(() =>
  definitions(PARAGRAPH_TYPE_IDS),
);
const allItems = computed<ToolbarItem[]>(() => {
  const items: ToolbarItem[] = definitions(INLINE_IDS).map((command) => ({
    kind: "command",
    key: command.id,
    group: 1,
    command,
  }));
  if (paragraphCommands.value.length > 0) {
    items.push({
      kind: "paragraph",
      key: "paragraph",
      group: 2,
      commands: paragraphCommands.value,
    });
  }
  for (const command of definitions(PARAGRAPH_ACTION_IDS)) {
    items.push({
      kind: "command",
      key: command.id,
      group: 2,
      command,
    });
  }
  for (const command of definitions(CONTENT_IDS)) {
    items.push({
      kind: "command",
      key: command.id,
      group: 3,
      command,
    });
  }
  return items;
});

const paragraphCommand = computed(
  () =>
    paragraphCommands.value.find(
      (command) => command.id === props.active.paragraph,
    ) ?? paragraphCommands.value[0],
);

const root = ref<HTMLElement | null>(null);
const measureRow = ref<HTMLElement | null>(null);
const paragraphTrigger = ref<HTMLButtonElement | null>(null);
const paragraphMenu = ref<HTMLElement | null>(null);
const moreTrigger = ref<HTMLButtonElement | null>(null);
const moreMenu = ref<HTMLElement | null>(null);
const paragraphOpen = ref(false);
const moreOpen = ref(false);
const visibleKeys = ref<ReadonlySet<string> | null>(null);
let resizeObserver: ResizeObserver | null = null;

// The paragraph trigger lives inside the item v-for, where a string ref would
// become an array. Assign the one trigger element explicitly.
function setParagraphTrigger(element: unknown) {
  paragraphTrigger.value =
    element instanceof HTMLButtonElement ? element : null;
}

function setParagraphMenu(element: unknown) {
  paragraphMenu.value = element instanceof HTMLElement ? element : null;
}

const visibleItems = computed(() => {
  const keys = visibleKeys.value;
  return keys === null
    ? allItems.value
    : allItems.value.filter((item) => keys.has(item.key));
});
const hasMore = computed(() => visibleKeys.value !== null);
const paragraphVisible = computed(
  () =>
    visibleKeys.value === null || visibleKeys.value.has("paragraph"),
);

const moreEntries = computed<MenuEntry[]>(() => {
  const keys = visibleKeys.value;
  if (keys === null) return [];
  const entries: MenuEntry[] = [];
  let previousGroup = 0;
  for (const item of allItems.value) {
    if (keys.has(item.key)) continue;
    const commands =
      item.kind === "paragraph" ? item.commands : [item.command];
    for (const command of commands) {
      entries.push({
        key: command.id,
        group: item.group,
        command,
        paragraphType: item.kind === "paragraph",
        dividerBefore: entries.length > 0 && item.group !== previousGroup,
      });
      previousGroup = item.group;
    }
  }
  return entries;
});

function iconFor(command: CommandDefinition): ToolbarIconName {
  return (command.icon ?? "pilcrow") as ToolbarIconName;
}

function commandTitle(command: CommandDefinition): string {
  const shortcut = commandShortcut(command.id, props.platform);
  return shortcut === "" ? command.label : `${command.label} ${shortcut}`;
}

function isActive(id: string): boolean {
  return props.active.active.has(id);
}

function elementWidth(element: Element): number {
  const rect = element.getBoundingClientRect();
  return rect.width || (element as HTMLElement).offsetWidth || 0;
}

/**
 * Fits whole commands from left to right. Widths come from the non-interactive
 * mirror, so hiding an item never creates a second working control.
 */
function fitItems(
  items: readonly ToolbarItem[],
  widths: ReadonlyMap<string, number>,
  available: number,
  moreWidth: number,
): ReadonlySet<string> | null {
  const total = (includeMore: boolean) => {
    let used = 0;
    let previousGroup = 0;
    for (const item of items) {
      if (previousGroup !== 0) {
        used += GAP;
        if (previousGroup !== item.group) used += SEPARATOR_WIDTH + GAP;
      }
      used += widths.get(item.key) ?? 0;
      previousGroup = item.group;
    }
    return includeMore ? used + GAP + moreWidth : used;
  };

  const allZero = items.every((item) => (widths.get(item.key) ?? 0) === 0);
  if (available <= 0 || allZero || total(false) <= available) {
    return null;
  }

  const reserve = GAP + moreWidth;
  const visible = new Set<string>();
  let used = 0;
  let previousGroup = 0;
  for (const item of items) {
    let addition = widths.get(item.key) ?? 0;
    if (previousGroup !== 0) {
      addition += GAP;
      if (previousGroup !== item.group) addition += SEPARATOR_WIDTH + GAP;
    }
    if (used + addition + reserve > available) break;
    used += addition;
    previousGroup = item.group;
    visible.add(item.key);
  }
  return visible;
}

function updateLayout() {
  const toolbar = root.value;
  const mirror = measureRow.value;
  if (!toolbar || !mirror) return;
  const available = Math.max(0, toolbar.getBoundingClientRect().width - SIDE_PADDING);
  const widths = new Map<string, number>();
  for (const element of mirror.querySelectorAll<HTMLElement>("[data-measure-key]")) {
    widths.set(element.dataset.measureKey!, elementWidth(element));
  }
  const moreWidth = widths.get("__more") ?? 0;
  visibleKeys.value = fitItems(
    allItems.value,
    widths,
    available,
    moreWidth,
  );
}

function focusFirstItem(menu: HTMLElement | null) {
  menu
    ?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
    ?.focus();
}

let menuFocusRequest = 0;

function isMenuOpen(kind: MenuKind): boolean {
  return kind === "paragraph" ? paragraphOpen.value : moreOpen.value;
}

function focusedMenuKind(): MenuKind | null {
  const active = document.activeElement;
  if (
    paragraphOpen.value &&
    active instanceof Node &&
    (paragraphMenu.value?.contains(active) ?? false)
  ) {
    return "paragraph";
  }
  if (
    moreOpen.value &&
    active instanceof Node &&
    (moreMenu.value?.contains(active) ?? false)
  ) {
    return "more";
  }
  return null;
}

function menuOwnsFocus(): boolean {
  return focusedMenuKind() !== null;
}

function visibleMenuTrigger(kind: MenuKind): HTMLElement | null {
  if (kind === "paragraph") {
    return paragraphVisible.value ? paragraphTrigger.value : null;
  }
  return hasMore.value ? moreTrigger.value : null;
}

/**
 * Prefer the trigger for the closed menu, then another toolbar trigger that
 * remains reachable after a responsive reflow. The document is the final
 * fallback so focus never remains on a removed menu item.
 */
function fallbackMenuTrigger(kind: MenuKind): HTMLElement | null {
  const direct = visibleMenuTrigger(kind);
  if (direct?.isConnected) return direct;
  const fallback = visibleMenuTrigger(
    kind === "paragraph" ? "more" : "paragraph",
  );
  return fallback?.isConnected ? fallback : null;
}

function closeMenus(restoreFocus = false) {
  // Any close, including a new popover taking over while this menu is already
  // closed, invalidates a focus restore queued by an earlier Escape.
  const request = ++menuFocusRequest;
  const paragraphWasOpen = paragraphOpen.value;
  const moreWasOpen = moreOpen.value;
  paragraphOpen.value = false;
  moreOpen.value = false;
  if (!restoreFocus) return;
  const kind: MenuKind | null = paragraphWasOpen
    ? "paragraph"
    : moreWasOpen
      ? "more"
      : null;
  if (kind === null) return;
  void nextTick(() => {
    if (request !== menuFocusRequest || paragraphOpen.value || moreOpen.value) {
      return;
    }
    const trigger = fallbackMenuTrigger(kind);
    if (trigger !== null) trigger.focus();
    else emit("focus-editor");
  });
}

function focusIsLostToPage(): boolean {
  const active = document.activeElement;
  return (
    !(active instanceof HTMLElement) ||
    !active.isConnected ||
    active === document.body ||
    active === document.documentElement
  );
}

function closeForLayout() {
  // Layout watches run before the DOM patch. Only restore when the old menu
  // owns focus; a new owner keeps its own focus.
  closeMenus(menuOwnsFocus());
}

function menuFocusLostAfterLayout(kind: MenuKind) {
  if (!isMenuOpen(kind) || menuOwnsFocus()) return;
  if (focusIsLostToPage()) closeMenus(true);
  else closeMenus();
}

function toggleParagraphMenu() {
  if (props.disabled) return;
  if (paragraphOpen.value) {
    closeMenus(true);
    return;
  }
  closeMenus();
  emit("menus-will-open");
  paragraphOpen.value = true;
  void nextTick(() => focusFirstItem(paragraphMenu.value));
}

function toggleMoreMenu() {
  if (props.disabled) return;
  if (moreOpen.value) {
    closeMenus(true);
    return;
  }
  closeMenus();
  emit("menus-will-open");
  moreOpen.value = true;
  void nextTick(() => focusFirstItem(moreMenu.value));
}

function run(commandId: string) {
  if (props.disabled) return;
  closeMenus();
  emit("run", commandId);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || (!paragraphOpen.value && !moreOpen.value)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  closeMenus(true);
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!paragraphOpen.value && !moreOpen.value) return;
  if (event.target instanceof Node && root.value?.contains(event.target)) {
    return;
  }
  closeMenus();
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeForLayout();
  },
);
watch(hasMore, (more) => {
  if (!more && moreOpen.value) closeForLayout();
});
watch(paragraphVisible, (visible) => {
  if (!visible && paragraphOpen.value) closeForLayout();
});
watch(
  visibleKeys,
  () => {
    const focusedKind = focusedMenuKind();
    if (focusedKind === null) return;
    void nextTick(() => menuFocusLostAfterLayout(focusedKind));
  },
  { flush: "sync" },
);
watch(
  () => props.active.paragraph,
  () => {
    void nextTick(updateLayout);
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  window.addEventListener("resize", updateLayout);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(updateLayout);
    if (root.value) resizeObserver.observe(root.value);
    if (measureRow.value) resizeObserver.observe(measureRow.value);
  }
  void nextTick(updateLayout);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
  window.removeEventListener("resize", updateLayout);
  resizeObserver?.disconnect();
  resizeObserver = null;
});

defineExpose({ closeMenus });
</script>

<template>
  <div
    ref="root"
    data-format-toolbar
    class="relative flex h-9 shrink-0 items-center justify-center border-b border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-4"
    @keydown="handleKeydown"
  >
    <div data-format-row class="flex h-full min-w-0 items-center gap-1">
      <template v-for="(item, index) in visibleItems" :key="item.key">
        <span
          v-if="index > 0 && item.group !== visibleItems[index - 1]!.group"
          class="h-5 w-px shrink-0 bg-[var(--border-subtle)]"
          aria-hidden="true"
        ></span>

        <button
          v-if="item.kind === 'command'"
          type="button"
          class="focus-ring grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
          :class="{
            'bg-[var(--accent-soft)] text-[var(--text-primary)]': isActive(
              item.command.id,
            ),
          }"
          :data-format-command="item.command.id"
          :data-active="isActive(item.command.id) ? '' : undefined"
          :aria-label="commandTitle(item.command)"
          :aria-pressed="isActive(item.command.id)"
          :title="commandTitle(item.command)"
          :disabled="disabled"
          @mousedown.prevent
          @click="run(item.command.id)"
        >
          <AppIcon :name="iconFor(item.command)" :size="15" />
        </button>

        <div v-else class="relative">
          <button
            :ref="setParagraphTrigger"
            type="button"
            data-format-paragraph-trigger
            class="focus-ring flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-2 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
            :class="{
              'bg-[var(--accent-soft)] text-[var(--text-primary)]': isActive(
                paragraphCommand?.id ?? '',
              ),
            }"
            :aria-expanded="paragraphOpen"
            aria-haspopup="menu"
            aria-label="段落类型"
            title="段落类型"
            :disabled="disabled"
            @mousedown.prevent
            @click="toggleParagraphMenu"
          >
            <AppIcon
              v-if="paragraphCommand"
              :name="iconFor(paragraphCommand)"
              :size="14"
            />
            <span>{{ paragraphCommand?.label ?? "正文" }}</span>
            <AppIcon name="chevron-down" :size="12" />
          </button>

          <div
            v-if="paragraphOpen"
            :ref="setParagraphMenu"
            data-format-menu="paragraph"
            role="menu"
            aria-label="段落类型"
            class="absolute left-0 top-[calc(100%+4px)] z-[var(--z-popover)] w-48 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1 text-[13px] shadow-[var(--shadow-lg)]"
          >
            <button
              v-for="command in paragraphCommands"
              :key="command.id"
              type="button"
              role="menuitemradio"
              :aria-checked="active.paragraph === command.id"
              :aria-label="commandTitle(command)"
              :title="commandTitle(command)"
              :data-format-command="command.id"
              class="focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-[var(--surface-subtle)] disabled:cursor-default disabled:opacity-40"
              :class="{
                'bg-[var(--accent-soft)]': active.paragraph === command.id,
              }"
              :disabled="disabled"
              @mousedown.prevent
              @click="run(command.id)"
            >
              <AppIcon :name="iconFor(command)" :size="14" />
              <span class="flex-1">{{ command.label }}</span>
              <KeyHint :shortcut="commandShortcut(command.id, platform)" />
            </button>
          </div>
        </div>
      </template>

      <div v-if="hasMore" class="relative">
        <button
          ref="moreTrigger"
          type="button"
          data-format-more
          class="focus-ring grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40"
          :aria-expanded="moreOpen"
          aria-haspopup="menu"
          aria-label="更多"
          title="更多"
          :disabled="disabled"
          @mousedown.prevent
          @click="toggleMoreMenu"
        >
          <AppIcon name="more" :size="16" />
        </button>

        <div
          v-if="moreOpen"
          ref="moreMenu"
          data-format-menu="more"
          role="menu"
          aria-label="更多格式"
          class="absolute right-0 top-[calc(100%+4px)] z-[var(--z-popover)] max-h-[min(70vh,420px)] w-56 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1 text-[13px] shadow-[var(--shadow-lg)]"
        >
          <template v-for="entry in moreEntries" :key="entry.key">
            <div
              v-if="entry.dividerBefore"
              class="my-1 h-px bg-[var(--border-subtle)]"
              role="separator"
            ></div>
            <button
              type="button"
              role="menuitem"
              :data-format-command="entry.command.id"
              :aria-label="commandTitle(entry.command)"
              :title="commandTitle(entry.command)"
              class="focus-ring flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left hover:bg-[var(--surface-subtle)] disabled:cursor-default disabled:opacity-40"
              :class="{
                'bg-[var(--accent-soft)]':
                  isActive(entry.command.id) ||
                  (entry.paragraphType &&
                    active.paragraph === entry.command.id),
              }"
              :disabled="disabled"
              @mousedown.prevent
              @click="run(entry.command.id)"
            >
              <AppIcon :name="iconFor(entry.command)" :size="14" />
              <span class="flex-1">{{ entry.command.label }}</span>
              <KeyHint :shortcut="commandShortcut(entry.command.id, platform)" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <div
      ref="measureRow"
      data-format-measure
      aria-hidden="true"
      class="pointer-events-none invisible absolute left-[-10000px] top-0 flex h-9 items-center gap-1"
    >
      <template v-for="item in allItems" :key="`measure-${item.key}`">
        <span
          v-if="item.kind === 'command'"
          :data-measure-key="item.command.id"
          class="grid size-7 place-items-center"
        >
          <AppIcon :name="iconFor(item.command)" :size="15" />
        </span>
        <span
          v-else
          data-measure-key="paragraph"
          class="flex h-7 items-center gap-1 px-2 text-[12px]"
        >
          <AppIcon
            v-if="paragraphCommand"
            :name="iconFor(paragraphCommand)"
            :size="14"
          />
          <span>{{ paragraphCommand?.label ?? "正文" }}</span>
          <AppIcon name="chevron-down" :size="12" />
        </span>
      </template>
      <span
        data-measure-key="__more"
        class="grid size-7 place-items-center"
      >
        <AppIcon name="more" :size="16" />
      </span>
    </div>
  </div>
</template>
