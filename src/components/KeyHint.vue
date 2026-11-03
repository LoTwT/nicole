<script setup lang="ts">
import { computed } from "vue";

import { shortcutKeycaps } from "../app/platform";

const props = withDefaults(
  defineProps<{ shortcut: string; variant?: "keycap" | "plain" }>(),
  { variant: "keycap" },
);

const keys = computed(() => shortcutKeycaps(props.shortcut));
</script>

<template>
  <span
    v-if="variant === 'plain'"
    class="shrink-0 font-sans text-[11px] text-[var(--text-muted)]"
    aria-hidden="true"
  >
    {{ shortcut }}
  </span>
  <span
    v-else
    class="inline-flex shrink-0 items-center gap-1 align-middle"
    aria-hidden="true"
  >
    <kbd
      v-for="(key, index) in keys"
      :key="`${key}-${index}`"
      class="inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface-canvas)] px-1 font-sans text-[10px] font-medium leading-none text-[var(--text-secondary)] shadow-[inset_0_-1px_0_var(--border-subtle)]"
    >
      {{ key }}
    </kbd>
  </span>
</template>
