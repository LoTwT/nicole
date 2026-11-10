<script setup lang="ts">
withDefaults(defineProps<{ shortcut: string; tone?: "muted" | "secondary" }>(), {
  tone: "muted",
});
</script>

<template>
  <span
    class="shrink-0 text-right font-sans text-[11px]"
    :class="
      tone === 'secondary'
        ? 'text-[var(--text-secondary)]'
        : 'text-[var(--text-muted)]'
    "
    aria-hidden="true"
  >
    {{ shortcut }}
  </span>
</template>
