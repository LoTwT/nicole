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
  initialPaletteInput,
  paletteModeLabel,
  parsePaletteInput,
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
  hasMarkdown: boolean;
  loadFiles: () => Promise<string[]>;
}>();

const emit = defineEmits<{
  close: [];
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
  commandId?: string;
  path?: string;
  position?: number;
}

const panel = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const inputValue = ref(initialPaletteInput(props.mode));
const selectedIndex = ref(0);
const composing = ref(false);
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

const parsed = computed(() => parsePaletteInput(inputValue.value));
const mode = computed(() => parsed.value.mode);
const query = computed(() => parsed.value.query);

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
      label: heading.text || "未命名标题",
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

const showEmpty = computed(() => items.value.length === 0 && !composing.value);

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
}

function handleCompositionEnd() {
  composing.value = false;
  void nextTick(() => {
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
  if (previousFocus?.isConnected) {
    previousFocus.focus();
  }
});

watch(
  () => inputValue.value,
  () => {
    selectedIndex.value = 0;
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
      >
        <h2 :id="titleId" class="sr-only">{{ paletteModeLabel(mode) }}面板</h2>
        <div
          class="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3"
        >
          <AppIcon name="search" :size="14" class="text-[var(--text-muted)]" />
          <input
            ref="input"
            v-model="inputValue"
            type="text"
            class="focus-ring h-8 min-w-0 flex-1 appearance-none border-0 bg-transparent px-1 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
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
          <span class="shrink-0 text-[11px] text-[var(--text-muted)]">
            {{ paletteModeLabel(mode) }}
          </span>
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
              <span class="block truncate">{{ item.label }}</span>
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
