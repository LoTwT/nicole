<script setup lang="ts">
import { computed } from "vue";

import type { Banner } from "../app/status";

const props = defineProps<{ banner: Banner }>();
const emit = defineEmits<{
  action: [action: Banner["actions"][number]];
}>();

const toneClass = computed(() => {
  switch (props.banner.tone) {
    case "danger":
      return "border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]";
    case "warning":
      return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]";
    case "info":
      return "border-[var(--status-info-border)] bg-[var(--status-info-bg)] text-[var(--status-info-fg)]";
  }
});

const buttonClass =
  "focus-ring rounded-[var(--radius-control)] border border-current px-2.5 py-1 text-[12px] hover:bg-[var(--surface-elevated)]";

const labels: Record<Banner["actions"][number], string> = {
  retry: "重试",
  "load-disk": "载入磁盘版本",
  "keep-mine": "保留我的版本",
  resave: "重新保存",
  "close-tab": "关闭标签页",
  "keep-restored": "保留恢复内容",
  "use-disk": "使用磁盘版本",
};
</script>

<template>
  <div
    class="flex min-h-8 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-1.5 text-[12px]"
    :class="toneClass"
    role="status"
  >
    <span class="min-w-0 flex-1" :title="banner.detail">{{ banner.message }}</span>
    <button
      v-for="action in banner.actions"
      :key="action"
      type="button"
      :class="buttonClass"
      @click="emit('action', action)"
    >
      {{ labels[action] }}
    </button>
  </div>
</template>
