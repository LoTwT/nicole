<script setup lang="ts">
import type { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import {
  activeOutlineHeadingIndex,
  outlineHeadings,
  OUTLINE_JUMP_MARGIN,
  OUTLINE_PANEL_WIDTH,
  OUTLINE_UPDATE_DELAY_MS,
} from "../app/outline";
import { extractHeadingsWithStatus } from "../editor/headings";
import type { DocumentHeading } from "../editor/headings";
import { visibleTopHeight } from "../editor/scroll";

// The first pass gets the same bounded budget as the command palette. Later
// passes use a smaller slice so a large document still fills in without
// monopolizing the main thread.
const INITIAL_PARSE_BUDGET_MS = 250;
const FOLLOW_UP_PARSE_BUDGET_MS = 80;
const FOLLOW_UP_DELAY_MS = 300;
// CodeMirror 6.43.15 ends Safari's dead-key composition from a 20ms timer
// without dispatching compositionend. A single post-change check lets those
// public flags settle without polling; a real composition stays paused until
// its own DOM compositionend.
const COMPOSITION_END_CHECK_MS = 150;

const props = defineProps<{
  view: EditorView;
  text: string;
  fixed: boolean;
}>();

const emit = defineEmits<{ navigate: [] }>();

const headings = ref<DocumentHeading[]>([]);
const complete = ref(true);
const hasLoaded = ref(false);
const activeIndex = ref<number | null>(null);
const panel = ref<HTMLElement | null>(null);

let updateTimer: ReturnType<typeof setTimeout> | null = null;
let followUpTimer: ReturnType<typeof setTimeout> | null = null;
let compositionCheckTimer: ReturnType<typeof setTimeout> | null = null;
// The immutable Text object the current heading list was extracted from. A
// changed document invalidates every position until the debounced refresh.
let headingsDoc: Text | null = null;
let viewportObserver: ResizeObserver | null = null;
// DOM composition events own the pause. CodeMirror's flags can outlive a lost
// compositionend, so they are only used to notice that CodeMirror has already
// ended the composition itself.
let domComposing = false;
let destroyed = false;

function clearUpdateTimer() {
  if (updateTimer !== null) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }
}

function clearFollowUpTimer() {
  if (followUpTimer !== null) {
    clearTimeout(followUpTimer);
    followUpTimer = null;
  }
}

function clearCompositionCheck() {
  if (compositionCheckTimer !== null) {
    clearTimeout(compositionCheckTimer);
    compositionCheckTimer = null;
  }
}

function scheduleCompositionEndCheck() {
  clearCompositionCheck();
  if (destroyed || !domComposing) {
    return;
  }
  compositionCheckTimer = setTimeout(() => {
    compositionCheckTimer = null;
    if (destroyed || !domComposing) {
      return;
    }
    if (props.view.compositionStarted || props.view.composing) {
      // A real composition is still active. Its DOM compositionend remains
      // the only owner of the resume path.
      return;
    }
    domComposing = false;
    // The check runs one interval after the last document change; refresh on
    // the remaining part of the normal 300ms debounce.
    scheduleUpdate(OUTLINE_UPDATE_DELAY_MS - COMPOSITION_END_CHECK_MS);
  }, COMPOSITION_END_CHECK_MS);
}

function composing(): boolean {
  return domComposing;
}

function syncActiveHeading() {
  if (destroyed) {
    return;
  }
  const view = props.view;
  const top = visibleTopHeight(
    view.scrollDOM.scrollTop,
    view.documentPadding.top,
  );
  const line = view.state.doc.lineAt(view.lineBlockAtHeight(top).from).number;
  activeIndex.value = activeOutlineHeadingIndex(headings.value, line);
}

function scheduleFollowUp() {
  clearFollowUpTimer();
  if (destroyed || composing()) {
    return;
  }
  followUpTimer = setTimeout(() => {
    followUpTimer = null;
    refresh(FOLLOW_UP_PARSE_BUDGET_MS);
  }, FOLLOW_UP_DELAY_MS);
}

function refresh(parseBudget = INITIAL_PARSE_BUDGET_MS) {
  if (destroyed) {
    return;
  }
  clearFollowUpTimer();
  const state = props.view.state;
  const extraction = extractHeadingsWithStatus(state, parseBudget);
  headings.value = outlineHeadings(state.doc.toString(), extraction.headings);
  headingsDoc = state.doc;
  complete.value = extraction.complete;
  hasLoaded.value = true;
  syncActiveHeading();
  if (!extraction.complete) {
    scheduleFollowUp();
  }
}

function scheduleUpdate(delay = OUTLINE_UPDATE_DELAY_MS) {
  clearUpdateTimer();
  clearFollowUpTimer();
  clearCompositionCheck();
  // Safari can forget compositionend after a dead-key composition.
  // CodeMirror then ends the composition itself, so a document change with
  // both composition flags already false means the pause is stale. This only
  // releases our local pause; it never changes CodeMirror's state.
  if (
    domComposing &&
    !props.view.compositionStarted &&
    !props.view.composing
  ) {
    domComposing = false;
  }
  if (destroyed) {
    return;
  }
  if (composing()) {
    scheduleCompositionEndCheck();
    return;
  }
  updateTimer = setTimeout(() => {
    updateTimer = null;
    refresh();
  }, delay);
}

function handleCompositionStart() {
  domComposing = true;
  clearUpdateTimer();
  clearFollowUpTimer();
  clearCompositionCheck();
}

function handleCompositionEnd() {
  domComposing = false;
  clearCompositionCheck();
  scheduleUpdate();
}

function handleScroll() {
  syncActiveHeading();
}

function jumpToHeading(index: number) {
  const heading = headings.value[index];
  if (heading === undefined) {
    return;
  }
  const view = props.view;
  // Positions from an older document can still be inside the new document,
  // so bounds alone are not enough. The list is usable again only after the
  // debounced refresh records the current document identity.
  if (
    headingsDoc !== view.state.doc ||
    heading.position > view.state.doc.length
  ) {
    return;
  }
  view.dispatch({
    selection: { anchor: heading.position },
    effects: EditorView.scrollIntoView(heading.position, {
      y: "start",
      yMargin: OUTLINE_JUMP_MARGIN,
    }),
  });
  activeIndex.value = index;
  view.focus();
  emit("navigate");
}

function focusActiveHeading() {
  const buttons = panel.value?.querySelectorAll<HTMLButtonElement>(
    "[data-outline-heading]",
  );
  if (buttons === undefined || buttons.length === 0) {
    panel.value?.focus();
    return;
  }
  const index = Math.min(
    Math.max(activeIndex.value ?? 0, 0),
    buttons.length - 1,
  );
  buttons[index]!.focus();
}

defineExpose({ focusActiveHeading });

watch(
  () => props.text,
  () => {
    scheduleUpdate();
  },
);

onMounted(() => {
  // The outline can open while a composition is already in progress, before
  // its own compositionstart listener existed.
  domComposing = props.view.compositionStarted || props.view.composing;
  props.view.scrollDOM.addEventListener("scroll", handleScroll, {
    passive: true,
  });
  props.view.contentDOM.addEventListener(
    "compositionstart",
    handleCompositionStart,
  );
  props.view.contentDOM.addEventListener(
    "compositionend",
    handleCompositionEnd,
  );
  if (typeof ResizeObserver !== "undefined") {
    viewportObserver = new ResizeObserver(() => syncActiveHeading());
    viewportObserver.observe(props.view.scrollDOM);
  }
  if (!domComposing) {
    refresh();
  }
});

onBeforeUnmount(() => {
  destroyed = true;
  clearUpdateTimer();
  clearFollowUpTimer();
  clearCompositionCheck();
  viewportObserver?.disconnect();
  viewportObserver = null;
  props.view.scrollDOM.removeEventListener("scroll", handleScroll);
  props.view.contentDOM.removeEventListener(
    "compositionstart",
    handleCompositionStart,
  );
  props.view.contentDOM.removeEventListener(
    "compositionend",
    handleCompositionEnd,
  );
});
</script>

<template>
  <aside
    id="outline-panel"
    ref="panel"
    data-outline-panel
    :data-placement="fixed ? 'fixed' : 'floating'"
    :style="{ width: `${OUTLINE_PANEL_WIDTH}px` }"
    tabindex="-1"
    role="navigation"
    aria-label="大纲"
    class="focus-ring flex min-h-0 flex-col overflow-hidden"
    :class="
      fixed
        ? 'h-full shrink-0 bg-[var(--reading-bg)]'
        : 'absolute right-2 top-2 z-[var(--z-popover)] max-h-[calc(100%-1rem)] rounded-[var(--radius-card)] border border-[var(--border-default)] bg-[var(--surface-elevated)] text-[13px] shadow-[var(--shadow-lg)]'
    "
  >
    <h2
      class="shrink-0 px-3 pb-2 pt-3 text-[12px] font-semibold text-[var(--text-primary)]"
    >
      大纲
    </h2>
    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      <p
        v-if="hasLoaded && headings.length === 0"
        class="m-0 px-1.5 text-[12px] text-[var(--text-muted)]"
      >
        {{
          complete ? "没有标题" : "文档较大，部分标题尚未解析"
        }}
      </p>
      <ul v-else class="m-0 flex list-none flex-col gap-0.5 p-0">
        <li v-for="(heading, index) in headings" :key="`${heading.position}`">
          <button
            type="button"
            data-outline-heading
            :data-active="activeIndex === index ? 'true' : undefined"
            :aria-current="activeIndex === index ? 'location' : undefined"
            :title="heading.text || '空标题'"
            class="focus-ring flex w-full items-start rounded-[var(--radius-control)] border-l-2 py-1 pr-2 text-left text-[13px] leading-snug hover:bg-[var(--surface-subtle)]"
            :class="
              activeIndex === index
                ? 'border-[var(--text-accent)] bg-[var(--surface-subtle)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)]'
            "
            :style="{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }"
            @click="jumpToHeading(index)"
          >
            <span
              class="min-w-0 flex-1 truncate"
              :class="{ 'text-[var(--text-muted)]': heading.text === '' }"
            >
              {{ heading.text || "空标题" }}
            </span>
          </button>
        </li>
      </ul>
      <p
        v-if="!complete && headings.length > 0"
        class="mb-0 mt-2 px-1.5 text-[12px] text-[var(--text-muted)]"
      >
        文档较大，部分标题尚未解析
      </p>
    </div>
  </aside>
</template>
