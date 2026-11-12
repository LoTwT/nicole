<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import {
  placeSlashMenu,
  SLASH_MENU_WIDTH,
  type SlashMenuPlacement,
  type SlashMenuState,
} from "../editor/slash";
import KeyHint from "./KeyHint.vue";

const props = defineProps<{ state: SlashMenuState }>();
const emit = defineEmits<{
  select: [index: number];
  highlight: [index: number];
}>();

const menu = ref<HTMLElement | null>(null);
const showLoading = computed(
  () => props.state.loading && props.state.items.length === 0,
);
const estimatedHeight = computed(
  () => 40 + props.state.items.length * 32 + (showLoading.value ? 32 : 0),
);
// Start at the estimated position so the first frame does not flash at (0, 0).
const position = ref<SlashMenuPlacement>(
  placeSlashMenu(
    props.state.anchor,
    { width: SLASH_MENU_WIDTH, height: estimatedHeight.value },
    { width: window.innerWidth, height: window.innerHeight },
  ),
);

function updatePosition() {
  const rect = menu.value?.getBoundingClientRect();
  const width = rect && rect.width > 0 ? rect.width : SLASH_MENU_WIDTH;
  const height = rect && rect.height > 0 ? rect.height : estimatedHeight.value;
  position.value = placeSlashMenu(props.state.anchor, { width, height }, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

function selectedItem() {
  return menu.value?.querySelector<HTMLElement>('[aria-selected="true"]');
}

onMounted(() => {
  updatePosition();
  window.addEventListener("resize", updatePosition);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updatePosition);
});

watch(
  () => [props.state.query, props.state.items.length],
  async () => {
    await nextTick();
    updatePosition();
  },
);

watch(
  () => props.state.selectedIndex,
  async () => {
    await nextTick();
    selectedItem()?.scrollIntoView?.({ block: "nearest" });
  },
);
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="fixed w-[260px] overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
        zIndex: 'var(--z-popover)',
      }"
      role="listbox"
      aria-label="Slash 命令"
      :data-placement="position.placement"
      @mousedown.prevent
    >
      <div
        class="border-b border-[var(--border-subtle)] px-2.5 py-1.5 text-[12px] text-[var(--text-muted)]"
      >
        {{ state.trigger }}{{ state.query }}
      </div>
      <div
        v-if="showLoading"
        class="flex h-8 items-center px-2.5 text-[12px] text-[var(--text-muted)]"
        role="status"
      >
        正在读取用户模板
      </div>
      <div class="py-1" role="presentation">
        <button
          v-for="(item, index) in state.items"
          :key="item.id"
          type="button"
          role="option"
          tabindex="-1"
          class="flex h-8 w-full items-center gap-2 px-2 text-left outline-none"
          :class="
            index === state.selectedIndex
              ? 'bg-[var(--nicole-selected-row)]'
              : 'hover:bg-[var(--surface-subtle)]'
          "
          :aria-selected="index === state.selectedIndex"
          :aria-label="
            item.shortcut ? `${item.label} ${item.shortcut}` : item.label
          "
          @pointerenter="emit('highlight', index)"
          @click="emit('select', index)"
        >
          <span
            class="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] border border-[var(--border-subtle)] bg-[var(--surface-canvas)] font-mono text-[10px] font-medium leading-none text-[var(--text-secondary)]"
            aria-hidden="true"
          >
            {{ item.glyph }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
          <KeyHint
            v-if="item.shortcut"
            :shortcut="item.shortcut"
            :tone="index === state.selectedIndex ? 'secondary' : 'muted'"
          />
        </button>
      </div>
    </div>
  </Teleport>
</template>
