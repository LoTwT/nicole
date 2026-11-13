<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import type { AppPlatform } from "../app/platform";
import { revealLabel } from "../app/platform";
import {
  LINK_IMAGE_POPOVER_MARGIN,
  LINK_IMAGE_POPOVER_WIDTH,
  intersectPopoverBounds,
  placeLinkImagePopover,
  type LinkImageEditorSession,
  type LinkImageFieldValues,
  type PopoverPlacement,
} from "../editor/link-editor";

const props = defineProps<{
  session: LinkImageEditorSession;
  initialFields: readonly LinkImageFieldValues[];
  platform: AppPlatform;
  isRevealablePath: (path: string) => boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  complete: [values: readonly LinkImageFieldValues[]];
  remove: [];
  reveal: [path: string];
  open: [address: string];
  "fields-change": [];
}>();

const popover = ref<HTMLElement | null>(null);
const fields = ref<LinkImageFieldValues[]>(
  props.initialFields.map((field) => ({ ...field })),
);
const composing = ref(false);
const position = ref<PopoverPlacement>({
  left: 8,
  top: 8,
  placement: "below",
});
const positioned = ref(false);
const availableWidth = ref(LINK_IMAGE_POPOVER_WIDTH);
const availableHeight = ref(0);
let unsubscribe: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;

const isImage = computed(() => props.session.kind === "image");
const title = computed(() => (isImage.value ? "编辑图片" : "编辑链接"));
const textLabel = computed(() => (isImage.value ? "替代文本" : "文本"));
const urlLabel = computed(() => (isImage.value ? "路径" : "链接"));
const revealable = computed(
  () =>
    isImage.value &&
    props.isRevealablePath(fields.value[0]?.url ?? ""),
);
const revealText = computed(() => revealLabel(props.platform));
const revealHint = computed(() =>
  revealable.value
    ? revealText.value
    : "仅当前工作区中的本地图片可在文件管理器中显示",
);

function labelFor(base: string, index: number): string {
  return fields.value.length > 1 ? `${base} ${index + 1}` : base;
}

function updatePosition() {
  const host = props.session.hostBounds();
  if (host === null) {
    positioned.value = false;
    return;
  }
  const bounds = intersectPopoverBounds(host, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  if (bounds === null) {
    positioned.value = false;
    return;
  }
  const width = Math.max(
    0,
    bounds.right - bounds.left - LINK_IMAGE_POPOVER_MARGIN * 2,
  );
  const height = Math.max(
    0,
    bounds.bottom - bounds.top - LINK_IMAGE_POPOVER_MARGIN * 2,
  );
  if (width <= 0 || height <= 0) {
    positioned.value = false;
    return;
  }
  const anchor = props.session.anchor();
  const rect = popover.value?.getBoundingClientRect();
  const size = {
    width: rect && rect.width > 0 ? rect.width : LINK_IMAGE_POPOVER_WIDTH,
    height: rect && rect.height > 0 ? rect.height : 160,
  };
  if (anchor === null) {
    const fallback = bounds.left + LINK_IMAGE_POPOVER_MARGIN;
    const top = bounds.top + LINK_IMAGE_POPOVER_MARGIN;
    position.value = placeLinkImagePopover(
      { left: fallback, right: fallback, top, bottom: top },
      size,
      bounds,
    );
  } else {
    position.value = placeLinkImagePopover(anchor, size, bounds);
  }
  availableWidth.value = width;
  availableHeight.value = height;
  positioned.value = true;
}

function focusFirstField() {
  const input = popover.value?.querySelector<HTMLInputElement>("input");
  if (!input) return;
  input.focus();
  input.select();
}

function complete() {
  emit(
    "complete",
    fields.value.map((field) => ({ text: field.text, url: field.url })),
  );
}

function cancel() {
  emit("cancel");
}

function remove() {
  emit("remove");
}

function reveal() {
  if (!revealable.value) return;
  emit("reveal", fields.value[0]?.url ?? "");
}

function open() {
  emit("open", fields.value[0]?.url ?? "");
}

function handleKeydown(event: KeyboardEvent) {
  if (composing.value || event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancel();
    return;
  }
  if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    event.stopPropagation();
    complete();
  }
}

onMounted(() => {
  updatePosition();
  unsubscribe = props.session.subscribe(updatePosition);
  document.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);
  if (typeof ResizeObserver !== "undefined" && popover.value) {
    resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(popover.value);
  }
  if (!props.session.preserveEditorFocus) {
    void nextTick(focusFirstField);
  }
});

onBeforeUnmount(() => {
  unsubscribe?.();
  unsubscribe = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener("scroll", updatePosition, true);
  window.removeEventListener("resize", updatePosition);
});

watch(
  fields,
  () => {
    emit("fields-change");
    void nextTick(updatePosition);
  },
  { deep: true, flush: "sync" },
);

defineExpose({ focusFirstField });
</script>

<template>
  <Teleport to="body">
    <div
      ref="popover"
      v-show="positioned"
      class="fixed flex w-[340px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-3 text-[13px] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
        maxWidth: `${availableWidth}px`,
        maxHeight: `${availableHeight}px`,
        zIndex: 'var(--z-popover)',
      }"
      role="dialog"
      :aria-label="title"
      :data-placement="position.placement"
      :data-batch="fields.length > 1 ? '' : undefined"
      data-link-image-editor
      @keydown="handleKeydown"
    >
      <div class="flex min-h-0 flex-col gap-2">
        <div
          class="max-h-[min(50vh,320px)] min-h-0 space-y-3 overflow-y-auto pr-1"
          data-link-image-fields
        >
          <fieldset
            v-for="(field, index) in fields"
            :key="index"
            class="m-0 min-w-0 border-0 p-0"
          >
            <legend
              v-if="fields.length > 1"
              class="mb-1 text-[12px] font-medium text-[var(--text-secondary)]"
            >
              链接 {{ index + 1 }}
            </legend>
            <div class="flex flex-col gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-[12px] text-[var(--text-muted)]">
                  {{ labelFor(textLabel, index) }}
                </span>
                <input
                  v-model="field.text"
                  type="text"
                  class="focus-ring h-[26px] w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
                  :aria-label="labelFor(textLabel, index)"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  @compositionstart="composing = true"
                  @compositionend="composing = false"
                  @blur="composing = false"
                />
              </label>
              <label class="flex flex-col gap-1">
                <span class="text-[12px] text-[var(--text-muted)]">
                  {{ labelFor(urlLabel, index) }}
                </span>
                <input
                  v-model="field.url"
                  type="text"
                  class="focus-ring h-[26px] w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 text-[13px] text-[var(--text-primary)]"
                  :aria-label="labelFor(urlLabel, index)"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  @compositionstart="composing = true"
                  @compositionend="composing = false"
                  @blur="composing = false"
                />
              </label>
            </div>
          </fieldset>
        </div>
        <div class="mt-1 flex shrink-0 flex-wrap justify-end gap-1.5">
          <button
            v-if="session.kind === 'image'"
            type="button"
            class="button-secondary focus-ring h-[26px] rounded-[var(--radius-control)] border px-2 text-[12px] disabled:cursor-default disabled:opacity-40"
            :disabled="!revealable"
            :title="revealHint"
            @click="reveal"
          >
            {{ revealText }}
          </button>
          <button
            v-if="session.kind === 'link'"
            type="button"
            class="button-secondary focus-ring h-[26px] rounded-[var(--radius-control)] border px-2 text-[12px]"
            @click="open"
          >
            打开
          </button>
          <button
            v-if="session.canRemove"
            type="button"
            class="button-secondary focus-ring h-[26px] rounded-[var(--radius-control)] border px-2 text-[12px]"
            @click="remove"
          >
            移除链接
          </button>
          <button
            type="button"
            class="button-primary focus-ring h-[26px] rounded-[var(--radius-control)] border px-2.5 text-[12px]"
            @click="complete"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
