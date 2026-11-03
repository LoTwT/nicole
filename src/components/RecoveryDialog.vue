<script setup lang="ts">
import type { RecoveryDialogItem } from "../app/recovery";
import AppDialog from "./AppDialog.vue";

defineProps<{
  open: boolean;
  items: readonly RecoveryDialogItem[];
  otherFolders: number;
}>();

const emit = defineEmits<{
  discard: [];
  review: [];
  restore: [];
}>();

const actionClass =
  "focus-ring rounded-[var(--radius-control)] border px-3 py-1.5 text-[12px]";
</script>

<template>
  <AppDialog
    :open="open"
    title="发现未保存的内容"
    @cancel="emit('review')"
  >
    <p class="m-0">
      Nicole 上次没有正常退出，以下文件有比磁盘更新的内容。
    </p>
    <ul
      class="mt-3 mb-0 max-h-[50vh] list-none overflow-auto rounded-[var(--radius-control)] border border-[var(--border-subtle)] p-0"
    >
      <li
        v-for="item in items"
        :key="item.id"
        class="border-b border-[var(--border-subtle)] px-3 py-2 last:border-b-0"
      >
        <div class="flex items-baseline justify-between gap-3">
          <span class="min-w-0 truncate font-medium">{{ item.name }}</span>
          <span class="shrink-0 text-[12px] text-[var(--text-muted)]">
            {{ item.time }}
          </span>
        </div>
        <div
          class="mt-0.5 break-all text-[12px] text-[var(--text-muted)]"
          :title="item.location"
        >
          {{ item.location }}
        </div>
        <div
          class="mt-0.5 text-[12px]"
          :class="
            item.unable
              ? 'text-[var(--status-danger-fg)]'
              : 'text-[var(--text-secondary)]'
          "
        >
          {{ item.note }}
        </div>
      </li>
    </ul>
    <p
      v-if="otherFolders > 0"
      class="mt-3 mb-0 text-[12px] text-[var(--text-muted)]"
    >
      另外 {{ otherFolders }} 个文件夹还有未保存的内容，打开它们时会提示
    </p>
    <template #actions>
      <button
        type="button"
        :class="actionClass"
        class="border-transparent text-[var(--status-danger-fg)] hover:bg-[var(--status-danger-bg)]"
        @click="emit('discard')"
      >
        全部丢弃
      </button>
      <button
        type="button"
        :class="actionClass"
        data-autofocus
        class="border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
        @click="emit('review')"
      >
        逐个查看
      </button>
      <button
        type="button"
        :class="actionClass"
        class="border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-contrast)]"
        @click="emit('restore')"
      >
        全部恢复
      </button>
    </template>
  </AppDialog>
</template>
