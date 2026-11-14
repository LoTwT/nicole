<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { absoluteBaseName, displayPath } from "../app/paths";
import type { AppPlatform } from "../app/platform";
import { layoutRecentRows } from "../app/recent-layout";
import { distinguishingSuffixes } from "../app/tabs";
import { commandShortcut } from "../commands/registry";
import brandMark from "../assets/brand-mark.png";
import AppIcon from "./AppIcon.vue";

const props = defineProps<{
  mode: "start" | "no-file";
  recentFolders: readonly string[];
  missingFolders: readonly string[];
  missingLastFolder: string | null;
  homeDir: string;
  platform: AppPlatform;
  dropActive?: boolean;
}>();

const emit = defineEmits<{
  "open-folder": [];
  "open-recent": [path: string];
  "remove-recent": [path: string];
  "new-file": [];
  "quick-open": [];
}>();

const MAX_VISIBLE_RECENT = 5;
const RECENT_GAP = 8;

interface RecentItem {
  id: number;
  path: string;
  name: string;
  suffix: string;
  pathLabel: string;
  missing: boolean;
}

const missing = computed(() => new Set(props.missingFolders));
const visibleRecent = computed(() =>
  props.recentFolders.slice(0, MAX_VISIBLE_RECENT),
);
const recentItems = computed<RecentItem[]>(() => {
  const paths = visibleRecent.value;
  const suffixEntries = paths.map((path, index) => ({
    id: index,
    name: folderName(path),
    path: path.replaceAll("\\", "/"),
  }));
  const suffixes = distinguishingSuffixes(suffixEntries, "根目录");
  return paths.map((path, index) => ({
    id: index,
    path,
    name: folderName(path),
    suffix: suffixes.get(index) ?? "",
    pathLabel: displayPath(path, props.homeDir),
    missing: missing.value.has(path),
  }));
});
const recentRows = ref<RecentItem[][]>([]);
const recentList = ref<HTMLElement | null>(null);
const recentRowBreaks = computed(() => {
  const breaks = new Set<number>();
  let offset = 0;
  for (const row of recentRows.value) {
    if (offset > 0) {
      breaks.add(offset);
    }
    offset += row.length;
  }
  return breaks;
});
const openFolderKey = computed(() =>
  commandShortcut("app.open-folder", props.platform),
);
const newFileKey = computed(() =>
  commandShortcut("app.new-file", props.platform),
);
const quickOpenKey = computed(() =>
  commandShortcut("nav.quick-open", props.platform),
);
const openFolderButton = ref<HTMLButtonElement | null>(null);
let recentObserver: ResizeObserver | null = null;
let pendingRemoveFocus: string | null | undefined = undefined;

function folderName(path: string): string {
  const name = absoluteBaseName(path);
  return name === "" ? (path === "" ? "/" : path) : name;
}

function recentDisplayName(item: RecentItem): string {
  return item.suffix ? `${item.name} · ${item.suffix}` : item.name;
}

function openRecentLabel(item: RecentItem): string {
  const missingLabel = item.missing ? "，已不存在，点击重试" : "";
  return `打开 ${item.name}（${item.pathLabel}）${missingLabel}`;
}

function recentPathTitle(item: RecentItem): string {
  return item.missing
    ? `${item.pathLabel}（已不存在，点击重试）`
    : item.pathLabel;
}

function removeRecentLabel(item: RecentItem): string {
  const missingLabel = item.missing ? "（已不存在）" : "";
  return `从最近打开中移除 ${recentDisplayName(item)}${missingLabel}`;
}

function recentElement(path: string): HTMLElement | null {
  return (
    [...(recentList.value?.querySelectorAll<HTMLElement>("[data-recent-item]") ?? [])].find(
      (element) => element.dataset.recentPath === path,
    ) ?? null
  );
}

function focusRecentOpen(path: string) {
  recentElement(path)
    ?.querySelector<HTMLButtonElement>('button[aria-label^="打开 "]')
    ?.focus();
}

function focusRecent(path: string) {
  const item = recentItems.value.find((candidate) => candidate.path === path);
  if (item === undefined) {
    openFolderButton.value?.focus();
    return;
  }
  focusRecentOpen(path);
}

async function applyPendingFocus() {
  if (pendingRemoveFocus !== undefined) {
    const target = pendingRemoveFocus;
    pendingRemoveFocus = undefined;
    await nextTick();
    if (target === null) {
      openFolderButton.value?.focus();
    } else {
      focusRecent(target);
    }
    return;
  }
}

function openRecent(item: RecentItem) {
  emit("open-recent", item.path);
}

function removeRecent(item: RecentItem) {
  const index = visibleRecent.value.indexOf(item.path);
  pendingRemoveFocus =
    index >= 0
      ? (visibleRecent.value[index + 1] ?? visibleRecent.value[index - 1] ?? null)
      : null;
  emit("remove-recent", item.path);
}

function sameRows(left: readonly RecentItem[][], right: readonly RecentItem[][]) {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.length === right[index]?.length &&
        row.every((item, itemIndex) => item.path === right[index]?.[itemIndex]?.path),
    )
  );
}

async function measureRecentRows() {
  await nextTick();
  const container = recentList.value;
  if (container === null || recentItems.value.length === 0) {
    recentRows.value = [];
    return;
  }
  const elements = [
    ...container.querySelectorAll<HTMLElement>("[data-recent-item]"),
  ];
  const widths = elements.map(
    (element) => element.getBoundingClientRect().width,
  );
  const rows = layoutRecentRows(
    recentItems.value,
    widths,
    container.clientWidth,
    RECENT_GAP,
  );
  if (!sameRows(rows, recentRows.value)) {
    recentRows.value = rows;
  }
}

watch(recentList, (element, previous) => {
  if (recentObserver !== null) {
    if (previous !== null) {
      recentObserver.unobserve(previous);
    }
    if (element !== null) {
      recentObserver.observe(element);
    }
  }
  void measureRecentRows();
});

watch(recentItems, async () => {
  recentRows.value = [];
  await nextTick();
  await applyPendingFocus();
  void measureRecentRows();
});

onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    recentObserver = new ResizeObserver(() => {
      void measureRecentRows();
    });
    if (recentList.value !== null) {
      recentObserver.observe(recentList.value);
    }
  }
  void measureRecentRows();
});

onBeforeUnmount(() => {
  recentObserver?.disconnect();
  recentObserver = null;
});

defineExpose({
  focusOpenFolder() {
    openFolderButton.value?.focus();
  },
  focusRecentItem(path: string) {
    focusRecent(path);
  },
});
</script>

<template>
  <div class="relative h-full">
    <div
      class="flex h-full items-center justify-center overflow-auto px-6 py-10"
    >
      <div v-if="mode === 'start'" class="my-auto w-full max-w-[420px] text-center">
        <img
          :src="brandMark"
          alt=""
          aria-hidden="true"
          width="96"
          height="96"
          draggable="false"
          class="mx-auto mb-5 block size-24"
        />
        <p
          v-if="missingLastFolder"
          class="mb-3 text-[12px] text-[var(--status-warning-fg)]"
        >
          上次打开的文件夹“{{ folderName(missingLastFolder) }}”已不存在
        </p>
        <h1 class="m-0 text-[24px] font-semibold tracking-tight">开始写作</h1>
        <p class="mt-2 text-[13px] text-[var(--text-secondary)]">
          打开一个文件夹作为工作区，里面的文件就是你的文章
        </p>
        <button
          ref="openFolderButton"
          type="button"
          class="button-primary focus-ring mt-5 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium"
          :aria-label="`打开文件夹 ${openFolderKey}`"
          :title="`打开文件夹 ${openFolderKey}`"
          @click="emit('open-folder')"
        >
          打开文件夹
        </button>

        <div v-if="visibleRecent.length > 0" class="mt-8 text-center">
          <h2 class="m-0 text-[12px] font-semibold text-[var(--text-muted)]">
            最近打开
          </h2>
          <div
            ref="recentList"
            role="list"
            class="mt-2 flex flex-wrap items-center justify-center gap-2"
          >
            <template v-for="(item, index) in recentItems" :key="item.path">
              <div
                v-if="recentRowBreaks.has(index)"
                class="basis-full h-0"
                aria-hidden="true"
              ></div>
              <div
                role="listitem"
                data-recent-item
                :data-recent-path="item.path"
                class="group relative inline-flex items-center"
                :style="{ maxWidth: 'min(200px, 100%)' }"
                :title="recentPathTitle(item)"
              >
                <div
                  data-recent-capsule
                  class="flex min-w-0 items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-primary)] transition-colors"
                  :class="
                    item.missing ? 'opacity-60' : 'hover:bg-[var(--surface-subtle)]'
                  "
                >
                  <button
                    type="button"
                    class="focus-ring flex min-w-0 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-left"
                    :aria-label="openRecentLabel(item)"
                    :title="recentPathTitle(item)"
                    @click="openRecent(item)"
                  >
                    <AppIcon
                      name="folder"
                      :size="14"
                      class="shrink-0 text-[var(--text-muted)]"
                    />
                    <span
                      class="min-w-0 flex-1 truncate text-[13px]"
                      :class="{ 'line-through': item.missing }"
                    >
                      {{ item.name }}
                    </span>
                    <span
                      v-if="item.suffix"
                      class="min-w-0 max-w-[80px] shrink truncate text-[11px] text-[var(--text-muted)]"
                    >
                      · {{ item.suffix }}
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  class="group/remove focus-ring absolute -right-2 -top-2 z-10 grid size-6 place-items-center rounded-full bg-transparent"
                  :class="
                    item.missing
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100'
                  "
                  :aria-label="removeRecentLabel(item)"
                  :title="removeRecentLabel(item)"
                  @click.stop="removeRecent(item)"
                >
                  <span
                    class="grid size-4 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-muted)] transition-colors group-hover/remove:bg-[var(--surface-muted)] group-hover/remove:text-[var(--text-primary)] group-active/remove:bg-[var(--surface-muted)] group-active/remove:text-[var(--text-primary)] group-focus-visible/remove:bg-[var(--surface-muted)] group-focus-visible/remove:text-[var(--text-primary)]"
                  >
                    <AppIcon name="close" :size="10" />
                  </span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>

      <div v-else class="text-center">
        <p class="m-0 text-[13px] text-[var(--text-secondary)]">选择一个文件开始写作</p>
        <div class="mt-3 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            class="button-secondary focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-[14px] py-[7px] text-[12px]"
            :aria-label="`新建文件 ${newFileKey}`"
            :title="`新建文件 ${newFileKey}`"
            @click="emit('new-file')"
          >
            <AppIcon name="file-plus" :size="14" class="text-[var(--text-secondary)]" />
            新建文件
          </button>
          <button
            type="button"
            class="button-secondary focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-[14px] py-[7px] text-[12px]"
            :aria-label="`快速打开 ${quickOpenKey}`"
            :title="`快速打开 ${quickOpenKey}`"
            @click="emit('quick-open')"
          >
            <AppIcon name="search" :size="14" class="text-[var(--text-secondary)]" />
            快速打开
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="mode === 'start' && dropActive"
      data-drop-hint
      class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed border-[var(--nicole-primary-fill)] bg-[var(--surface-canvas)]"
    >
      <div
        data-drop-hint-tint
        aria-hidden="true"
        class="absolute inset-0 rounded-[var(--radius-card)] bg-[var(--accent-soft)]/40"
      ></div>
      <p class="relative m-0 text-[13px] font-medium text-[var(--text-primary)]">
        松开以打开文件夹
      </p>
    </div>
  </div>
</template>
