<script setup lang="ts">
defineProps<{ shortcut: string }>();
</script>

<template>
  <span
    class="shrink-0 text-right font-sans text-[11px] text-[var(--text-muted)]"
    aria-hidden="true"
  >
    {{ shortcut }}
  </span>
</template>
