<script setup lang="ts">
import { computed } from "vue";

import { revealLabel, type AppPlatform } from "../app/platform";

const props = defineProps<{
  name: string;
  size: number;
  folder: string;
  platform: AppPlatform;
}>();

const emit = defineEmits<{
  "open-default": [];
  reveal: [];
}>();

const extension = computed(() => {
  const index = props.name.lastIndexOf(".");
  return index <= 0 ? "文件" : props.name.slice(index + 1).toUpperCase();
});

const sizeLabel = computed(() => {
  if (props.size < 1024) {
    return `${props.size} B`;
  }
  if (props.size < 1024 * 1024) {
    return `${(props.size / 1024).toFixed(1)} KB`;
  }
  return `${(props.size / (1024 * 1024)).toFixed(1)} MB`;
});
</script>

<template>
  <div class="grid h-full place-items-center px-6 py-10">
    <div class="max-w-[420px] text-center">
      <div
        class="mx-auto mb-4 grid h-[68px] w-[56px] place-items-end justify-center rounded-md border-[1.5px] border-[var(--border-strong)] pb-2 text-[11px] text-[var(--text-muted)]"
        aria-hidden="true"
      >
        {{ extension }}
      </div>
      <p class="m-0 text-[13px] text-[var(--text-secondary)]">
        无法预览此类型的文件
      </p>
      <p class="mt-1 mb-4 truncate text-[12px] text-[var(--text-muted)]" :title="folder">
        {{ name }} · {{ sizeLabel }} · {{ folder }}
      </p>
      <div class="flex justify-center gap-2">
        <button
          type="button"
          class="focus-ring rounded-[var(--radius-control)] border border-[var(--border-default)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
          @click="emit('open-default')"
        >
          用默认应用打开
        </button>
        <button
          type="button"
          class="focus-ring rounded-[var(--radius-control)] border border-[var(--border-default)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
          @click="emit('reveal')"
        >
          {{ revealLabel(platform) }}
        </button>
      </div>
    </div>
  </div>
</template>
