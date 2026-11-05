<script setup lang="ts">
import { computed } from "vue";

import AppIcon from "./AppIcon.vue";

const props = defineProps<{ isDark: boolean }>();
const emit = defineEmits<{ toggle: [] }>();

const action = computed(() =>
  props.isDark ? "切换到亮色主题" : "切换到暗色主题",
);
</script>

<template>
  <button
    type="button"
    class="focus-ring grid size-6 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
    :aria-label="action"
    :title="action"
    @click="emit('toggle')"
  >
    <AppIcon :name="isDark ? 'sun' : 'moon'" :size="14" />
  </button>
</template>
