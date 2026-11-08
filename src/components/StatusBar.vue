<script setup lang="ts">
import { computed } from "vue";

import type { SaveStatusPresentation } from "../app/status";
import ThemeToggle from "./ThemeToggle.vue";

const props = defineProps<{
  saveStatus: SaveStatusPresentation | null;
  notice: string | null;
  noticeTone?: "success" | "danger" | "muted";
  noticeDetail?: string;
  startTheme?: boolean;
  isDark?: boolean;
}>();

const emit = defineEmits<{ "toggle-theme": [] }>();

const dotClass = computed(() => {
  if (props.notice) {
    if (props.noticeTone === "danger") {
      return "bg-[var(--status-danger-fg)]";
    }
    if (props.noticeTone === "muted") {
      return "bg-[var(--text-muted)]";
    }
    return "bg-[var(--status-success-fg)]";
  }
  switch (props.saveStatus?.tone) {
    case "success":
      return "bg-[var(--status-success-fg)]";
    case "warning":
      return "bg-[var(--status-warning-fg)]";
    case "danger":
      return "bg-[var(--status-danger-fg)]";
    case "muted":
      return "bg-[var(--text-muted)]";
    default:
      return "";
  }
});
</script>

<template>
  <footer
    class="flex h-[26px] shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] px-3.5 text-[12px] text-[var(--text-muted)]"
  >
    <div v-if="startTheme" class="-ml-1.5 flex shrink-0 items-center">
      <ThemeToggle :is-dark="isDark === true" @toggle="emit('toggle-theme')" />
    </div>
    <span class="flex min-w-0 flex-1 items-center gap-1.5">
      <template v-if="notice">
        <span class="size-[7px] shrink-0 rounded-full" :class="dotClass"></span>
        <span
          class="truncate"
          :title="noticeDetail"
          :class="{
            'text-[var(--status-danger-fg)]': noticeTone === 'danger',
            'text-[var(--text-muted)]': noticeTone === 'muted',
            'text-[var(--status-success-fg)]': noticeTone !== 'danger' && noticeTone !== 'muted',
          }"
        >
          {{ notice }}
        </span>
      </template>
      <template v-else-if="saveStatus">
        <span class="size-[7px] shrink-0 rounded-full" :class="dotClass"></span>
        <span
          class="truncate"
          :class="{
            'text-[var(--status-danger-fg)]': saveStatus.tone === 'danger',
            'text-[var(--status-warning-fg)]': saveStatus.tone === 'warning',
          }"
        >
          {{ saveStatus.label }}
        </span>
      </template>
    </span>
  </footer>
</template>
