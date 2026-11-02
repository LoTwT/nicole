<script setup lang="ts">
type IconName =
  | "sidebar"
  | "search"
  | "plus"
  | "gear"
  | "chevron-right"
  | "chevron-down"
  | "close"
  | "folder"
  | "file-text"
  | "file"
  | "outline"
  | "sun"
  | "moon"
  | "more"
  | "live"
  | "immersive"
  | "source";

withDefaults(
  defineProps<{ name: IconName; size?: number }>(),
  { size: 16 },
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-if="name === 'sidebar'">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M6 3v10" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M8 3v10M3 8h10" />
    </template>
    <template v-else-if="name === 'gear'">
      <path d="M8 1.5l1.1 1.4 1.7-.5.6 1.7 1.7.6-.5 1.7L14.5 8l-1.4 1.1.5 1.7-1.7.6-.6 1.7-1.7-.5L8 14.5l-1.1-1.4-1.7.5-.6-1.7-1.7-.6.5-1.7L1.5 8l1.4-1.1-.5-1.7 1.7-.6.6-1.7 1.7.5Z" />
      <circle cx="8" cy="8" r="2.2" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="m6 4 4 4-4 4" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m4 6 4 4 4-4" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="m4 4 8 8M12 4l-8 8" />
    </template>
    <template v-else-if="name === 'folder'">
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.4l1.4 1.5h5.2A1.5 1.5 0 0 1 14 6v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5Z" />
    </template>
    <template v-else-if="name === 'file-text'">
      <path d="M4 2h5l3 3v9H4Z" />
      <path d="M9 2v3h3M6 8h4M6 10.5h4" />
    </template>
    <template v-else-if="name === 'file'">
      <path d="M4 2h5l3 3v9H4Z" />
      <path d="M9 2v3h3" />
    </template>
    <template v-else-if="name === 'outline'">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3v10M4.5 6h3M4.5 8.5h3M4.5 11h2" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="8" cy="8" r="2.6" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M12.8 9.6A5 5 0 0 1 6.4 3.2a5 5 0 1 0 6.4 6.4Z" />
    </template>
    <template v-else-if="name === 'more'">
      <circle cx="3.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'live'">
      <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </template>
    <template v-else-if="name === 'immersive'">
      <path d="M3 12.5 4.2 9 10.8 2.4a1.4 1.4 0 0 1 2 0l.8.8a1.4 1.4 0 0 1 0 2L7 11.8Z" />
      <path d="m9.8 3.4 2.8 2.8M3 12.5l3.5-.7" />
    </template>
    <template v-else>
      <path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5M9 2 7 14" />
    </template>
  </svg>
</template>
