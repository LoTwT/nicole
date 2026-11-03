<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
} from "vue";

import type { AppPlatform } from "../app/platform";
import {
  filterPaletteFiles,
  filterPaletteHeadings,
  paletteModeLabel,
  paletteModePrefix,
  type CommandPaletteMode,
} from "../app/command-palette";
import {
  filterCommands,
  loadPinyinMatcher,
  type PinyinMatcher,
} from "../commands/search";
import { formatCommandShortcut } from "../commands/registry";
import type { CommandDefinition } from "../commands/types";
import type { DocumentHeading } from "../editor/headings";
import AppIcon from "./AppIcon.vue";
import KeyHint from "./KeyHint.vue";

const props = defineProps<{
  mode: CommandPaletteMode;
  platform: AppPlatform;
  commands: readonly CommandDefinition[];
  workspaceOpen: boolean;
  recentFiles: readonly string[];
  recentCommandIds: readonly string[];
  headings: readonly DocumentHeading[];
  headingsTruncated: boolean;
  hasMarkdown: boolean;
  loadFiles: () => Promise<string[]>;
}>();

const emit = defineEmits<{
  close: [];
  "mode-change": [mode: CommandPaletteMode];
  "run-command": [id: string];
  "open-file": [path: string];
  "jump-heading": [position: number];
}>();

interface PaletteItem {
  key: string;
  kind: "command" | "file" | "heading";
  label: string;
  detail: string;
  glyph: string;
  icon: "file-text" | null;
  level: number;
  shortcut: string | null;
  placeholder?: boolean;
  commandId?: string;
  path?: string;
  position?: number;
}

/**
 * Clearing and writing in the same task can be coalesced into one mutation,
 * which VoiceOver in WKWebView and Narrator in WebView2 treat as no change and
 * do not announce. The empty state must be committed before the new text
 * arrives, so the write waits a short delay in a separate task, which crosses
 * a render pass in both WebViews. Whether 50 ms is enough has not been verified
 * with VoiceOver or Narrator on real hardware.
 */
const MODE_ANNOUNCEMENT_DELAY_MS = 50;

const panel = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const mode = ref<CommandPaletteMode>(props.mode);
const inputValue = ref("");
const modeAnnouncement = ref("");
let modeAnnouncementTimer: ReturnType<typeof setTimeout> | null = null;
const selectedIndex = ref(0);
const composing = ref(false);
const compositionStartValue = ref("");
const matcher = shallowRef<PinyinMatcher | null>(null);
const pinyinLoading = ref(false);
const files = ref<string[]>([]);
const filesLoading = ref(false);
const filesError = ref(false);
const instanceId = useId();
const listId = `command-palette-list-${instanceId}`;
const titleId = `command-palette-title-${instanceId}`;
const previousFocus =
  document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

const query = computed(() => inputValue.value);
const modePrefix = computed(() => paletteModePrefix(mode.value));

const commandItems = computed<PaletteItem[]>(() =>
  filterCommands(props.commands, query.value, {
    matcher: matcher.value,
    recentIds: props.recentCommandIds,
  }).map((command) => ({
    key: `command:${command.id}`,
    kind: "command",
    label: command.label,
    detail: "",
    glyph: command.glyph ?? command.label.slice(0, 2),
    icon: null,
    level: 1,
    shortcut: formatCommandShortcut(command, props.platform),
    commandId: command.id,
  })),
);

const fileItems = computed<PaletteItem[]>(() =>
  filterPaletteFiles(files.value, query.value, {
    matcher: matcher.value,
    recentFiles: props.recentFiles,
  }).map((path) => {
    const slash = path.lastIndexOf("/");
    return {
      key: `file:${path}`,
      kind: "file",
      label: slash === -1 ? path : path.slice(slash + 1),
      detail: slash === -1 ? "" : path.slice(0, slash),
      glyph: "",
      icon: "file-text",
      level: 1,
      shortcut: null,
      path,
    };
  }),
);

const headingItems = computed<PaletteItem[]>(() =>
  filterPaletteHeadings(props.headings, query.value, matcher.value).map(
    (heading) => ({
      key: `heading:${heading.position}`,
      kind: "heading",
      label: heading.text || "空标题",
      placeholder: heading.text === "",
      detail: "",
      glyph: `H${heading.level}`,
      icon: null,
      level: heading.level,
      shortcut: null,
      position: heading.position,
    }),
  ),
);

const items = computed<PaletteItem[]>(() => {
  switch (mode.value) {
    case "command":
      return commandItems.value;
    case "file":
      return fileItems.value;
    case "heading":
      return headingItems.value;
  }
});

const selectedId = computed(
  () => `command-palette-option-${instanceId}-${selectedIndex.value}`,
);
const activeDescendant = computed(() =>
  items.value.length === 0 ? undefined : selectedId.value,
);

const waitingForPinyin = computed(
  () =>
    query.value !== "" &&
    matcher.value === null &&
    pinyinLoading.value &&
    items.value.length === 0,
);

const emptyMessage = computed(() => {
  if (mode.value === "file" && !props.workspaceOpen) {
    return "先打开一个文件夹";
  }
  if (mode.value === "heading" && !props.hasMarkdown) {
    return "当前没有打开的 Markdown 文件";
  }
  if (waitingForPinyin.value) return "正在搜索";
  switch (mode.value) {
    case "command":
      return "没有匹配的命令";
    case "file":
      if (filesLoading.value) return "正在读取文件";
      if (filesError.value) return "读取文件列表失败";
      return query.value === "" ? "没有 Markdown 文件" : "没有匹配的文件";
    case "heading":
      return query.value === "" ? "当前文档没有标题" : "没有匹配的标题";
  }
});

const showEmpty = computed(
  () =>
    items.value.length === 0 &&
    !composing.value &&
    !(mode.value === "heading" && props.headingsTruncated),
);

const inputLabel = computed(() => {
  switch (mode.value) {
    case "command":
      return "命令面板，输入命令名称";
    case "file":
      return "命令面板，输入文件名";
    case "heading":
      return "命令面板，输入标题";
  }
});

function focusInput() {
  input.value?.focus();
  const length = inputValue.value.length;
  input.value?.setSelectionRange(length, length);
}

function clearModeAnnouncement() {
  if (modeAnnouncementTimer !== null) {
    clearTimeout(modeAnnouncementTimer);
    modeAnnouncementTimer = null;
  }
  modeAnnouncement.value = "";
}

function announceMode(next: CommandPaletteMode) {
  clearModeAnnouncement();
  modeAnnouncementTimer = setTimeout(() => {
    modeAnnouncementTimer = null;
    modeAnnouncement.value = `${paletteModeLabel(next)}模式`;
  }, MODE_ANNOUNCEMENT_DELAY_MS);
}

/**
 * In file mode, the first character typed or pasted into an empty query can
 * select another mode. The character is not part of the query.
 */
function adoptLeadingPrefix(previousValue: string) {
  if (mode.value !== "file" || previousValue !== "") return;
  const value = inputValue.value;
  const next: CommandPaletteMode | null = value.startsWith(">")
    ? "command"
    : value.startsWith("@")
      ? "heading"
      : null;
  if (next === null) return;
  mode.value = next;
  announceMode(next);
  inputValue.value = value.slice(1);
  void nextTick(focusInput);
}

/** Applies a shortcut-selected mode; the query text is preserved. */
function switchMode(next: CommandPaletteMode) {
  if (mode.value === next) {
    // The mode is unchanged, but the shortcut still confirms it to the user.
    announceMode(next);
    return;
  }
  mode.value = next;
  announceMode(next);
  void nextTick(focusInput);
}

function keepPanelFocus(event: MouseEvent) {
  if (event.target === input.value) return;
  event.preventDefault();
  input.value?.focus();
}

defineExpose({ switchMode });

async function scrollSelectedIntoView() {
  await nextTick();
  panel.value
    ?.querySelector<HTMLElement>('[aria-selected="true"]')
    ?.scrollIntoView?.({ block: "nearest" });
}

function moveSelection(delta: number) {
  if (items.value.length === 0) return;
  selectedIndex.value =
    (selectedIndex.value + delta + items.value.length) % items.value.length;
  void scrollSelectedIntoView();
}

function execute(index = selectedIndex.value) {
  if (composing.value) return;
  const item = items.value[index];
  if (!item) return;
  switch (item.kind) {
    case "command":
      if (item.commandId) emit("run-command", item.commandId);
      break;
    case "file":
      if (item.path) emit("open-file", item.path);
      break;
    case "heading":
      if (item.position !== undefined) emit("jump-heading", item.position);
      break;
  }
}

function handleInputKeydown(event: KeyboardEvent) {
  // The IME owns every key while composing; leave Enter, arrows and Escape to
  // the candidate window.
  if (composing.value || event.isComposing || event.keyCode === 229) return;

  const key = event.key;
  if (key === "Backspace" && mode.value !== "file" && query.value === "") {
    const element = input.value;
    const start = element?.selectionStart ?? 0;
    const end = element?.selectionEnd ?? 0;
    if (start === 0 && end === 0) {
      event.preventDefault();
      event.stopPropagation();
      switchMode("file");
      return;
    }
  }
  if (key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    event.stopPropagation();
    moveSelection(key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    execute();
    return;
  }
  if (key === "Tab") {
    // The input is the panel's only tab stop; keep focus inside instead of
    // letting Tab reach the window controls or the page behind the scrim.
    event.preventDefault();
    input.value?.focus();
  }
}

function handleCompositionStart() {
  composing.value = true;
  compositionStartValue.value = inputValue.value;
}

function handleCompositionEnd() {
  composing.value = false;
  const startValue = compositionStartValue.value;
  void nextTick(() => {
    adoptLeadingPrefix(startValue);
    if (items.value.length > 0 && selectedIndex.value >= items.value.length) {
      selectedIndex.value = items.value.length - 1;
    }
  });
}

onMounted(async () => {
  pinyinLoading.value = true;
  void loadPinyinMatcher()
    .then((loaded) => {
      matcher.value = loaded;
    })
    .catch(() => {
      // Labels and ASCII aliases still work without pinyin.
    })
    .finally(() => {
      pinyinLoading.value = false;
    });

  if (props.workspaceOpen) {
    filesLoading.value = true;
    void props
      .loadFiles()
      .then((loaded) => {
        files.value = loaded.filter((path) => /\.md$/i.test(path));
      })
      .catch(() => {
        filesError.value = true;
      })
      .finally(() => {
        filesLoading.value = false;
      });
  }

  await nextTick();
  focusInput();
});

onBeforeUnmount(() => {
  clearModeAnnouncement();
  if (previousFocus?.isConnected) {
    previousFocus.focus();
  }
});

watch(
  inputValue,
  (_value, previous) => {
    selectedIndex.value = 0;
    if (composing.value) return;
    adoptLeadingPrefix(previous);
  },
);

watch(
  () => items.value.length,
  (length) => {
    if (length === 0) {
      selectedIndex.value = 0;
    } else if (selectedIndex.value >= length) {
      selectedIndex.value = length - 1;
    }
  },
);

watch(
  () => [mode.value, query.value],
  () => {
    selectedIndex.value = 0;
  },
);

watch(mode, (next) => {
  emit("mode-change", next);
});
</script>

<template>
  <Teleport to="body">
    <div
      class="command-palette-scrim fixed inset-0"
      :style="{ zIndex: 'var(--z-overlay)' }"
      @mousedown.self="emit('close')"
    >
      <section
        ref="panel"
        class="absolute left-1/2 flex max-h-[min(70vh,480px)] w-[min(560px,calc(100%-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
        :style="{ top: '72px' }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @mousedown="keepPanelFocus"
      >
        <h2 :id="titleId" class="sr-only">{{ paletteModeLabel(mode) }}面板</h2>
        <p
          class="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >{{ modeAnnouncement }}</p>
        <div
          class="command-palette-input-row flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4"
        >
          <span
            v-if="modePrefix"
            class="flex h-8 w-4 shrink-0 -translate-y-px select-none items-center justify-center text-[14px] font-medium text-[var(--text-muted)]"
            aria-hidden="true"
          >
            {{ modePrefix }}
          </span>
          <input
            ref="input"
            v-model="inputValue"
            type="text"
            class="command-palette-input h-8 min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-label="inputLabel"
            :aria-expanded="true"
            :aria-controls="listId"
            :aria-activedescendant="activeDescendant"
            :placeholder="
              mode === 'command'
                ? '搜索命令'
                : mode === 'file'
                  ? '搜索文件'
                  : '搜索标题'
            "
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            @keydown="handleInputKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
          />
        </div>

        <div
          :id="listId"
          class="min-h-0 flex-1 overflow-y-auto p-1"
          role="listbox"
          :aria-label="`${paletteModeLabel(mode)}列表`"
          @mousedown.prevent
        >
          <button
            v-for="(item, index) in items"
            :id="`command-palette-option-${instanceId}-${index}`"
            :key="item.key"
            type="button"
            role="option"
            tabindex="-1"
            class="flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left"
            :class="
              index === selectedIndex
                ? 'bg-[var(--accent-soft)]'
                : 'hover:bg-[var(--surface-subtle)]'
            "
            :style="{
              paddingLeft: `${8 + (item.kind === 'heading' ? (item.level - 1) * 12 : 0)}px`,
            }"
            :aria-selected="index === selectedIndex"
            :aria-label="
              item.shortcut ? `${item.label} ${item.shortcut}` : item.label
            "
            @pointerenter="selectedIndex = index"
            @click="execute(index)"
          >
            <span
              v-if="item.icon"
              class="grid size-[22px] shrink-0 place-items-center text-[var(--text-muted)]"
              aria-hidden="true"
            >
              <AppIcon :name="item.icon" :size="14" />
            </span>
            <span
              v-else
              class="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-[5px] border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-1 font-mono text-[10px] font-medium leading-none text-[var(--text-secondary)]"
              aria-hidden="true"
            >
              {{ item.glyph }}
            </span>
            <span class="min-w-0 flex-1">
              <span
                class="block truncate"
                :class="{ 'text-[var(--text-muted)]': item.placeholder }"
              >
                {{ item.label }}
              </span>
              <span
                v-if="item.detail"
                class="block truncate text-[11px] text-[var(--text-muted)]"
              >
                {{ item.detail }}
              </span>
            </span>
            <KeyHint v-if="item.shortcut" :shortcut="item.shortcut" />
          </button>
          <p
            v-if="mode === 'heading' && headingsTruncated"
            class="m-0 px-3 py-2 text-center text-[12px] text-[var(--text-muted)]"
          >
            文档较大，部分标题尚未解析
          </p>
          <p
            v-if="showEmpty"
            class="m-0 px-3 py-5 text-center text-[12px] text-[var(--text-muted)]"
          >
            {{ emptyMessage }}
          </p>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-palette-input:focus,
.command-palette-input:focus-visible {
  outline: none;
}

@media (prefers-contrast: more) {
  .command-palette-input-row {
    border-bottom-color: var(--focus-ring-color);
  }
}

@media (forced-colors: active) {
  .command-palette-input-row {
    border-bottom-color: Highlight;
  }
}
</style>
