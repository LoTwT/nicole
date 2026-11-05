<script setup lang="ts">
import { computed, ref } from "vue";

import { displayPath } from "../app/paths";
import type { AppPlatform } from "../app/platform";
import { commandShortcut } from "../commands/registry";
import AppIcon from "./AppIcon.vue";
import ThemeToggle from "./ThemeToggle.vue";

const props = defineProps<{
  mode: "start" | "no-file";
  recentFolders: readonly string[];
  missingFolders: readonly string[];
  missingLastFolder: string | null;
  homeDir: string;
  platform: AppPlatform;
  isDark: boolean;
  dropActive?: boolean;
}>();

const emit = defineEmits<{
  "open-folder": [];
  "open-recent": [path: string];
  "remove-recent": [path: string];
  "new-file": [];
  "quick-open": [];
  "toggle-theme": [];
}>();

const MAX_VISIBLE_RECENT = 5;

const missing = computed(() => new Set(props.missingFolders));
const visibleRecent = computed(() =>
  props.recentFolders.slice(0, MAX_VISIBLE_RECENT),
);
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

function folderName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index === -1 ? clean : clean.slice(index + 1);
}

defineExpose({
  focusOpenFolder() {
    openFolderButton.value?.focus();
  },
});
</script>

<template>
  <div
    class="relative flex h-full items-center justify-center overflow-auto px-6 py-10"
  >
    <div v-if="mode === 'start'" class="w-full max-w-[420px] text-center">
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
        class="focus-ring mt-5 inline-flex items-center gap-2 rounded-full bg-[var(--accent-primary)] px-4 py-2 text-[13px] font-medium text-[var(--accent-contrast)]"
        :aria-label="`打开文件夹 ${openFolderKey}`"
        :title="`打开文件夹 ${openFolderKey}`"
        @click="emit('open-folder')"
      >
        打开文件夹
      </button>

      <div v-if="visibleRecent.length > 0" class="mt-8 text-left">
        <h2 class="m-0 mb-2 text-[12px] font-semibold text-[var(--text-muted)]">
          最近打开
        </h2>
        <ul class="m-0 list-none space-y-1 p-0">
          <li
            v-for="folder in visibleRecent"
            :key="folder"
            class="group flex items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 hover:bg-[var(--surface-subtle)]"
          >
            <button
              type="button"
              class="focus-ring flex min-w-0 flex-1 items-baseline gap-2 rounded-[var(--radius-control)] text-left"
              :disabled="missing.has(folder)"
              @click="emit('open-recent', folder)"
            >
              <span class="shrink-0 text-[13px] text-[var(--text-primary)]">
                {{ folderName(folder) }}
              </span>
              <span class="min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                {{ displayPath(folder, homeDir) }}
              </span>
              <span
                v-if="missing.has(folder)"
                class="shrink-0 text-[11px] text-[var(--status-danger-fg)]"
              >
                已不存在
              </span>
            </button>
            <button
              type="button"
              class="focus-ring grid size-5 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
              aria-label="从最近打开中移除"
              @click="emit('remove-recent', folder)"
            >
              <AppIcon name="close" :size="12" />
            </button>
          </li>
        </ul>
      </div>

      <div
        v-if="dropActive"
        data-drop-hint
        class="pointer-events-none absolute inset-2 flex items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed border-[var(--accent-primary)] bg-[var(--accent-soft)]/40"
      >
        <p class="m-0 text-[13px] font-medium text-[var(--text-primary)]">
          松开以打开文件夹
        </p>
      </div>

      <div class="absolute bottom-0 left-2 flex h-[26px] items-center">
        <ThemeToggle :is-dark="isDark" @toggle="emit('toggle-theme')" />
      </div>
    </div>

    <div v-else class="text-center">
      <p class="m-0 text-[13px] text-[var(--text-secondary)]">选择一个文件开始写作</p>
      <p class="mt-2 flex items-center justify-center gap-4 text-[12px] text-[var(--text-muted)]">
        <button
          type="button"
          class="focus-ring rounded-[var(--radius-control)] hover:text-[var(--text-primary)]"
          :aria-label="`新建文件 ${newFileKey}`"
          :title="`新建文件 ${newFileKey}`"
          @click="emit('new-file')"
        >
          新建文件
        </button>
        <button
          type="button"
          class="focus-ring rounded-[var(--radius-control)] hover:text-[var(--text-primary)]"
          :aria-label="`快速打开 ${quickOpenKey}`"
          :title="`快速打开 ${quickOpenKey}`"
          @click="emit('quick-open')"
        >
          快速打开
        </button>
      </p>
    </div>
  </div>
</template>
