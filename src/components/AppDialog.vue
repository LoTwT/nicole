<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";

const props = defineProps<{
  open: boolean;
  title: string;
  width?: number;
}>();

const emit = defineEmits<{ cancel: [] }>();

const titleId = `dialog-${useId()}`;
const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusables(): HTMLElement[] {
  if (!panel.value) {
    return [];
  }
  return [...panel.value.querySelectorAll<HTMLElement>(focusableSelector)];
}

function focusInitial() {
  const items = focusables();
  const initial =
    items.find((item) => item.hasAttribute("data-autofocus")) ?? items[0];
  initial?.focus();
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      await nextTick();
      focusInitial();
      return;
    }
    const restore = previousFocus;
    previousFocus = null;
    if (restore?.isConnected) {
      await nextTick();
      restore.focus();
    }
  },
  { flush: "post" },
);

function handleKeydown(event: KeyboardEvent) {
  if (!props.open || event.isComposing || event.keyCode === 229) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const items = focusables();
  if (items.length === 0) {
    event.preventDefault();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey) {
    if (active === first || !panel.value?.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || !panel.value?.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(() => {
  // Capture at the document level so Tab and Esc still work if WebKit keeps
  // focus on the editor for a frame after the dialog opens.
  document.addEventListener("keydown", handleKeydown, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown, true);
  const restore = previousFocus;
  previousFocus = null;
  if (restore?.isConnected) {
    restore.focus();
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="app-modal-scrim fixed inset-0 grid place-items-center"
      :style="{ zIndex: 'var(--z-modal)' }"
    >
      <div
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        class="max-h-[calc(100vh-2rem)] overflow-auto rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
        :style="{ width: `min(${width ?? 440}px, calc(100vw - 2rem))` }"
      >
        <h2
          :id="titleId"
          class="m-0 text-[15px] font-semibold text-[var(--text-primary)]"
        >
          {{ title }}
        </h2>
        <div class="mt-3 text-[var(--text-secondary)]">
          <slot />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
