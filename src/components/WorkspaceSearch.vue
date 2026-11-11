<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  addSearchLine,
  formatSearchSummary,
  searchErrorText,
  searchLineFromPart,
  type SearchFileGroup,
  type SearchOpenTarget,
  type SearchResultLine,
} from "../app/workspace-search";
import { searchWorkspace, type WorkspaceSearch } from "../services/search";const props = defineProps<{ generation: number }>();

const emit = defineEmits<{
  close: [];
  "open-result": [target: SearchOpenTarget];
}>();

type SearchStatus = "idle" | "searching" | "done" | "truncated" | "error";

const input = ref<HTMLInputElement | null>(null);
const query = ref("");
const caseSensitive = ref(false);
const regex = ref(false);
const composing = ref(false);
const groups = ref<SearchFileGroup[]>([]);
const status = ref<SearchStatus>("idle");
const errorText = ref("");
const summaryFiles = ref(0);
const summaryMatches = ref(0);

let session = 0;
let current: WorkspaceSearch | null = null;
let hadQuery = false;

const statusText = computed(() => {
  switch (status.value) {
    case "idle":
      return "输入内容开始搜索";
    case "searching":
      return "正在搜索";
    case "done":
      return formatSearchSummary(summaryFiles.value, summaryMatches.value);
    case "truncated":
      return "结果过多，请缩小范围";
    case "error":
      return errorText.value;
  }
});

function cancelSearch() {
  session += 1;
  current?.close();
  current = null;
}

function resetResults() {
  groups.value = [];
  summaryFiles.value = 0;
  summaryMatches.value = 0;
  errorText.value = "";
}

function startSearch() {
  cancelSearch();
  if (query.value === "") {
    resetResults();
    status.value = "idle";
    return;
  }
  resetResults();
  status.value = "searching";
  const id = session;
  let active: WorkspaceSearch;
  try {
    active = searchWorkspace(
      {
        generation: props.generation,
        query: query.value,
        caseSensitive: caseSensitive.value,
        regex: regex.value,
      },
      (part) => {
        if (id !== session) return;
        if (searchLineFromPart(part) === null) return;
        groups.value = addSearchLine(groups.value, part);
      },
    );
  } catch (error) {
    errorText.value = searchErrorText(error);
    status.value = "error";
    return;
  }
  current = active;
  void active.result
    .then((summary) => {
      if (id !== session) return;
      current = null;
      summaryFiles.value = summary.files;
      summaryMatches.value = summary.matches;
      status.value = summary.truncated ? "truncated" : "done";
    })
    .catch((error: unknown) => {
      if (id !== session) return;
      current = null;
      errorText.value = searchErrorText(error);
      status.value = "error";
    });
}

function updateQuery(value: string) {
  if (value === query.value) return;
  query.value = value;
  if (value === "") {
    cancelSearch();
    resetResults();
    status.value = "idle";
    if (hadQuery) emit("close");
    return;
  }
  hadQuery = true;
  startSearch();
}

function handleInput(event: Event) {
  if (composing.value) return;
  updateQuery((event.target as HTMLInputElement).value);
}

function handleCompositionStart() {
  composing.value = true;
}

function handleCompositionEnd() {
  composing.value = false;
  updateQuery(input.value?.value ?? "");
}

function toggleCaseSensitive() {
  caseSensitive.value = !caseSensitive.value;
  if (query.value !== "") startSearch();
}

function toggleRegex() {
  regex.value = !regex.value;
  if (query.value !== "") startSearch();
}

function openLine(line: SearchResultLine, event?: MouseEvent) {
  let match = line.matches[0];
  const target = event?.target;
  if (target instanceof Element) {
    const highlighted = target.closest("[data-search-match]");
    const raw = highlighted?.getAttribute("data-search-match");
    const index = raw === null || raw === undefined ? Number.NaN : Number(raw);
    if (Number.isInteger(index) && index >= 0 && index < line.matches.length) {
      match = line.matches[index];
    }
  }
  if (!match) return;
  emit("open-result", {
    generation: props.generation,
    line,
    match,
  });
}

function lineLabel(line: SearchResultLine): string {
  const text = line.text === "" ? "空行" : line.text;
  return `${line.path} 第 ${line.line} 行：${text}`;
}

function groupLabel(group: SearchFileGroup): string {
  return `${group.path}，${group.matchCount} 处结果`;
}

function focusInput() {
  input.value?.focus();
}

watch(
  () => props.generation,
  () => {
    cancelSearch();
    resetResults();
    status.value = "idle";
  },
);

onMounted(() => {
  void nextTick(() => input.value?.focus());
});

onBeforeUnmount(() => {
  cancelSearch();
});

defineExpose({ focusInput });
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-search-panel>
    <div class="shrink-0 px-2.5 pb-1.5">
      <div
        class="flex h-7 items-center gap-1 rounded-[var(--radius-control)] bg-[var(--surface-subtle)] pl-2 pr-1"
      >
        <input
          ref="input"
          type="text"
          class="focus-ring min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          aria-label="搜索工作区"
          placeholder="搜索工作区"
          autocomplete="off"
          spellcheck="false"
          @input="handleInput"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
        />
        <button
          type="button"
          data-search-case
          class="focus-ring grid size-5 shrink-0 place-items-center rounded-[var(--radius-control)] text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          :class="{ 'bg-[var(--nicole-selected-row)] text-[var(--text-primary)]': caseSensitive }"
          :aria-label="'区分大小写'"
          :aria-pressed="caseSensitive"
          title="区分大小写"
          @click="toggleCaseSensitive"
        >
          <span aria-hidden="true">Aa</span>
        </button>
        <button
          type="button"
          data-search-regex
          class="focus-ring grid size-5 shrink-0 place-items-center rounded-[var(--radius-control)] text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          :class="{ 'bg-[var(--nicole-selected-row)] text-[var(--text-primary)]': regex }"
          aria-label="使用正则表达式"
          :aria-pressed="regex"
          title="使用正则表达式"
          @click="toggleRegex"
        >
          <span aria-hidden="true">.*</span>
        </button>
      </div>
    </div>

    <div
      class="min-h-[26px] shrink-0 px-2.5 py-1 text-[11px] leading-4 text-[var(--text-muted)]"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {{ statusText }}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto pb-2" role="region" aria-label="搜索结果">
      <div
        v-for="group in groups"
        :key="group.path"
        role="group"
        :aria-label="groupLabel(group)"
        :data-search-path="group.path"
      >
        <div
          class="flex items-baseline gap-1.5 px-2.5 pb-0.5 pt-2"
          role="heading"
          aria-level="2"
        >
          <span
            class="min-w-0 truncate text-[11px] font-semibold text-[var(--text-secondary)]"
            :title="group.path"
          >
            {{ group.name }}
          </span>
          <span
            v-if="group.folder"
            class="min-w-0 truncate text-[10px] text-[var(--text-muted)]"
          >
            {{ group.folder }}
          </span>
          <span class="ml-auto shrink-0 text-[10px] text-[var(--text-muted)]">
            {{ group.matchCount }} 处
          </span>
        </div>
        <button
          v-for="line in group.lines"
          :key="`${group.path}:${line.line}`"
          type="button"
          data-search-result
          :data-search-line="line.line"
          class="focus-ring flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--nicole-file-tree-hover)] hover:text-[var(--text-primary)]"
          :aria-label="lineLabel(line)"
          :title="line.text"
          @click="openLine(line, $event)"
        >
          <span class="w-7 shrink-0 text-right text-[10px] text-[var(--text-muted)]">
            {{ line.line }}
          </span>
          <span class="min-w-0 flex-1 truncate">
            <span v-if="line.prefixTruncated" aria-hidden="true">…</span>
            <template v-for="(segment, index) in line.segments" :key="index">
              <mark
                v-if="segment.highlighted && !segment.zeroWidth"
                class="rounded-[2px] bg-[var(--status-warning-bg)] px-px text-[var(--text-primary)]"
                :data-search-match="segment.matchIndex ?? undefined"
              >{{ segment.text }}</mark>
              <mark
                v-else-if="segment.zeroWidth"
                class="inline-block h-[0.9em] w-[2px] rounded-[1px] bg-[var(--status-warning-fg)] align-[-0.1em]"
                :data-search-match="segment.matchIndex ?? undefined"
                aria-hidden="true"
              ></mark>
              <template v-else>{{ segment.text }}</template>
            </template>
            <span v-if="line.suffixTruncated" aria-hidden="true">…</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
