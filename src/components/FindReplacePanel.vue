<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";

import type { CommandPaletteMode } from "../app/command-palette";
import type { AppPlatform } from "../app/platform";
import {
  commandRegistry,
  commandShortcut,
} from "../commands/registry";
import { matchCommand } from "../commands/keybinding";
import type {
  FindReplaceController,
  FindReplaceState,
} from "../editor/find";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  controller: FindReplaceController;
  platform: AppPlatform;
}>();

const emit = defineEmits<{
  opened: [];
  "open-palette": [mode: CommandPaletteMode];
}>();

const state = shallowRef<FindReplaceState>(props.controller.snapshot());
const findInput = ref<HTMLInputElement | null>(null);
const replaceInput = ref<HTMLInputElement | null>(null);
const composing = ref(false);
let unsubscribe: (() => void) | null = null;

const nextShortcut = computed(() =>
  commandShortcut("edit.find-next", props.platform),
);
const previousShortcut = computed(() =>
  commandShortcut("edit.find-previous", props.platform),
);

const countLabel = computed(() =>
  state.value.error === null
    ? `${state.value.current}/${state.value.total}`
    : "正则无效",
);

const statusLabel = computed(() => {
  if (state.value.error !== null) return "正则表达式无效";
  if (state.value.query === "") return "查找内容为空";
  if (state.value.total === 0) return "无匹配";
  if (state.value.current === 0) {
    return `未选中匹配，共 ${state.value.total} 项`;
  }
  return `第 ${state.value.current} 项，共 ${state.value.total} 项`;
});

const replaceDisabled = computed(
  () => state.value.error !== null || state.value.total === 0,
);

function focusFindInput() {
  const input = findInput.value;
  if (input === null) return;
  input.focus();
  input.select();
}

watch(
  () => `${state.value.open}:${state.value.focusToken}`,
  async () => {
    if (!state.value.open) return;
    await nextTick();
    focusFindInput();
  },
);

onMounted(() => {
  unsubscribe = props.controller.subscribe((next) => {
    const activated =
      next.open && next.focusToken !== state.value.focusToken;
    state.value = next;
    if (activated) emit("opened");
  });
  if (state.value.open) void nextTick(() => focusFindInput());
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
});

function setQuery(event: Event) {
  props.controller.setQuery((event.target as HTMLInputElement).value);
}

function setReplacement(event: Event) {
  props.controller.setReplacement((event.target as HTMLInputElement).value);
}

function handleKeydown(event: KeyboardEvent) {
  // The candidate window owns every key during a composition. Enter, arrows
  // and Escape must not navigate, replace or close the panel.
  if (composing.value || event.isComposing || event.keyCode === 229) return;

  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    props.controller.close();
    return;
  }

  const command = matchCommand(
    event,
    props.platform,
    commandRegistry,
    "editor",
  );
  if (command?.id === "edit.find") {
    event.preventDefault();
    event.stopPropagation();
    props.controller.open(false);
    return;
  }
  if (command?.id === "edit.find-replace") {
    event.preventDefault();
    event.stopPropagation();
    props.controller.open(true);
    return;
  }
  if (command?.id === "edit.find-next") {
    event.preventDefault();
    event.stopPropagation();
    props.controller.next();
    return;
  }
  if (command?.id === "edit.find-previous") {
    event.preventDefault();
    event.stopPropagation();
    props.controller.previous();
    return;
  }

  // The window listener deliberately ignores text fields. The panel explicitly
  // hands the three registered palette entries back to the app, and leaves
  // dialogs, availability checks and other text-field protections untouched.
  const appCommand = matchCommand(
    event,
    props.platform,
    commandRegistry,
    "app",
  );
  const paletteMode: CommandPaletteMode | null =
    appCommand?.id === "nav.quick-open"
      ? "file"
      : appCommand?.id === "nav.command-palette"
        ? "command"
        : appCommand?.id === "nav.goto-heading"
          ? "heading"
          : null;
  if (paletteMode !== null) {
    event.preventDefault();
    event.stopPropagation();
    emit("open-palette", paletteMode);
    return;
  }

  if (event.key !== "Enter") return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  event.preventDefault();
  event.stopPropagation();
  if (target === replaceInput.value) {
    props.controller.replace();
  } else if (event.shiftKey) {
    props.controller.previous();
  } else {
    props.controller.next();
  }
}
</script>

<template>
  <section
    v-if="state.open"
    data-find-replace
    role="search"
    aria-label="查找替换"
    class="absolute z-[var(--z-popover)] flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2 text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
    :style="{ top: '8px', right: '14px', width: 'min(380px, calc(100% - 22px))' }"
    @keydown="handleKeydown"
  >
    <div class="flex h-[26px] items-center gap-1">
      <input
        ref="findInput"
        type="text"
        :value="state.query"
        class="focus-ring h-[26px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
        aria-label="查找"
        placeholder="查找"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @input="setQuery"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @blur="composing = false"
      />
      <button
        type="button"
        class="focus-ring grid size-[24px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[12px] font-medium"
        :class="
          state.caseSensitive
            ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'
        "
        aria-label="区分大小写"
        title="区分大小写"
        :aria-pressed="state.caseSensitive"
        @click="controller.setCaseSensitive(!state.caseSensitive)"
      >
        Aa
      </button>
      <button
        type="button"
        class="focus-ring grid size-[24px] shrink-0 place-items-center rounded-[var(--radius-control)] font-mono text-[12px]"
        :class="
          state.regexp
            ? 'bg-[var(--accent-soft)] text-[var(--text-primary)]'
            : 'text-[var(--text-muted)] hover:bg-[var(--surface-muted)]'
        "
        aria-label="使用正则表达式"
        title="使用正则表达式"
        :aria-pressed="state.regexp"
        @click="controller.setRegexp(!state.regexp)"
      >
        .*
      </button>
      <span
        class="min-w-[3.5rem] shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]"
        aria-hidden="true"
      >{{ countLabel }}</span>
      <p
        class="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >{{ statusLabel }}</p>
      <button
        type="button"
        class="focus-ring grid size-[24px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :aria-label="`上一个匹配 ${previousShortcut}`"
        :title="`上一个匹配 ${previousShortcut}`"
        :disabled="state.total === 0"
        @click="controller.previous()"
      >
        <AppIcon name="chevron-down" :size="14" class="rotate-180" />
      </button>
      <button
        type="button"
        class="focus-ring grid size-[24px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        :aria-label="`下一个匹配 ${nextShortcut}`"
        :title="`下一个匹配 ${nextShortcut}`"
        :disabled="state.total === 0"
        @click="controller.next()"
      >
        <AppIcon name="chevron-down" :size="14" />
      </button>
      <button
        type="button"
        class="focus-ring grid size-[24px] shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
        aria-label="关闭"
        title="关闭"
        @click="controller.close()"
      >
        <AppIcon name="close" :size="14" />
      </button>
    </div>

    <div
      v-if="state.replaceVisible"
      class="flex h-[26px] items-center gap-1"
    >
      <input
        ref="replaceInput"
        type="text"
        :value="state.replacement"
        class="focus-ring h-[26px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
        aria-label="替换为"
        placeholder="替换为"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        @input="setReplacement"
        @compositionstart="composing = true"
        @compositionend="composing = false"
        @blur="composing = false"
      />
      <button
        type="button"
        class="button-secondary focus-ring h-[26px] shrink-0 rounded-[var(--radius-control)] border px-2 text-[12px] disabled:cursor-default disabled:opacity-40"
        :disabled="replaceDisabled"
        @click="controller.replace()"
      >
        替换
      </button>
      <button
        type="button"
        class="button-secondary focus-ring h-[26px] shrink-0 rounded-[var(--radius-control)] border px-2 text-[12px] disabled:cursor-default disabled:opacity-40"
        :disabled="replaceDisabled"
        @click="controller.replaceAll()"
      >
        全部替换
      </button>
    </div>
  </section>
</template>
