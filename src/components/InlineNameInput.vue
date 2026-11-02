<script setup lang="ts">
import { nextTick, onMounted, ref } from "vue";

const props = defineProps<{
  value: string;
  selectStart?: number;
  selectEnd?: number;
  label: string;
}>();

const emit = defineEmits<{
  "update:value": [value: string];
  commit: [];
  cancel: [];
}>();

const input = ref<HTMLInputElement | null>(null);
const cancelled = ref(false);

function finish() {
  if (cancelled.value) {
    return;
  }
  emit("commit");
}

function cancel() {
  cancelled.value = true;
  emit("cancel");
}

onMounted(() => {
  void nextTick(() => {
    const element = input.value;
    if (!element) {
      return;
    }
    element.focus();
    element.setSelectionRange(
      props.selectStart ?? 0,
      props.selectEnd ?? props.value.length,
    );
  });
});
</script>

<template>
  <input
    ref="input"
    :value="value"
    :aria-label="label"
    type="text"
    class="h-[24px] min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--focus-ring-color)] bg-[var(--surface-canvas)] px-1.5 text-[13px] text-[var(--text-primary)] outline-none"
    @input="emit('update:value', ($event.target as HTMLInputElement).value)"
    @click.stop
    @mousedown.stop
    @keydown.enter.prevent.stop="finish"
    @keydown.esc.prevent.stop="cancel"
    @blur="finish"
  />
</template>
