<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { EditorView } from "@codemirror/view";
import { synchronizeReadingScroll } from "../app/scroll-synchronization";
import { renderMarkdownPreview } from "../editor/rendering/preview";

export interface ComparisonDocument {
  id: number;
  name: string;
  text: string;
  /** Changes when a document's image/navigation context changes. */
  sourceKey: string;
}

const props = defineProps<{
  documents: readonly ComparisonDocument[];
  selectedId: number;
  resolveImage: (source: string, documentId: number) => string | null;
  editorView?: EditorView | null;
  activeDocumentId?: number | null;
}>();
const emit = defineEmits<{
  select: [id: number];
  close: [];
  "open-link": [href: string, documentId: number];
}>();
const selected = computed(() => props.documents.find((doc) => doc.id === props.selectedId));
const html = ref("");
const pending = ref(false);
const failed = ref(false);
const synchronized = ref(false);
const readingHost = ref<HTMLElement | null>(null);
let stopSynchronization: (() => void) | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingRender: AbortController | null = null;

function cancelRender() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pendingRender?.abort();
  pendingRender = null;
}

watch(
  () => [selected.value?.id, selected.value?.sourceKey, selected.value?.text] as const,
  (next, previous) => {
    cancelRender();
    const doc = selected.value;
    // Keep a stable reading surface while typing in the same document.
    // A different document or image authority must clear the previous preview.
    if (next[0] !== previous?.[0] || next[1] !== previous?.[1]) html.value = "";
    failed.value = false;
    pending.value = doc !== undefined;
    if (!doc) return;
    const controller = new AbortController();
    pendingRender = controller;
    // Coalesce continuous typing; stale documents never replace this preview.
    timer = setTimeout(async () => {
      timer = null;
      try {
        const next = await renderMarkdownPreview(doc.text, {
          resolveImage: (source) => props.resolveImage(source, doc.id),
          signal: controller.signal,
          sourceLines: true,
        });
        if (controller.signal.aborted) return;
        html.value = next;
      } catch {
        if (!controller.signal.aborted) failed.value = true;
      } finally {
        if (!controller.signal.aborted) pending.value = false;
      }
    }, 160);
  },
  { immediate: true },
);

function handleLink(event: MouseEvent) {
  if (event.type === "auxclick" && event.button !== 1) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a");
  if (!anchor) return;
  event.preventDefault();
  event.stopPropagation();
  if (pending.value) return;
  const href = anchor.getAttribute("href");
  const doc = selected.value;
  if (href && doc) emit("open-link", href, doc.id);
}

watch(() => [synchronized.value, props.editorView, props.activeDocumentId, selected.value?.id, html.value, pending.value] as const, async (_next, _previous, onCleanup) => {
  stopSynchronization?.();
  stopSynchronization = null;
  let canceled = false;
  onCleanup(() => { canceled = true; });
  await nextTick();
  if (canceled || !synchronized.value || pending.value || !props.editorView || !readingHost.value) return;
  stopSynchronization = synchronizeReadingScroll(props.editorView, readingHost.value, props.activeDocumentId === selected.value?.id);
});
onBeforeUnmount(() => { cancelRender(); stopSynchronization?.(); });
</script>

<template>
  <aside id="comparison-pane" aria-label="只读文档对照" class="comparison-pane flex min-h-0 min-w-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--reading-bg)]">
    <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-2">
      <label for="comparison-document" class="shrink-0 text-[12px] text-[var(--text-muted)]">只读对照</label>
      <select
        id="comparison-document"
        class="focus-ring min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--border-subtle)] bg-[var(--surface-canvas)] px-2 py-1 text-[12px]"
        :value="selectedId"
        @change="emit('select', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="doc in documents" :key="doc.id" :value="doc.id">{{ doc.name }}</option>
      </select>
      <button type="button" class="focus-ring shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[12px] hover:bg-[var(--surface-subtle)] disabled:opacity-50" :aria-pressed="synchronized" :disabled="!editorView" title="同一文档按源码位置同步，不同文档按滚动比例同步" @click="synchronized = !synchronized">同步滚动</button>
      <button type="button" class="focus-ring shrink-0 rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)]" aria-label="关闭文档对照" @click="emit('close')">关闭</button>
    </div>
    <div ref="readingHost" data-nicole-reading class="min-h-0 flex-1 overflow-auto px-5 py-5" tabindex="0" aria-label="对照文档正文" :aria-busy="pending">
      <p v-if="pending && !html" role="status" class="text-[13px] text-[var(--text-muted)]">正在生成预览…</p>
      <template v-else-if="failed">
        <p role="status" class="text-[13px] text-[var(--text-muted)]">暂时无法预览，以下显示 Markdown 原文。</p>
        <pre class="whitespace-pre-wrap break-words text-[13px]">{{ selected?.text }}</pre>
      </template>
      <!-- Both renderers and all generated SVG/HTML are sanitized at the shared boundary. -->
      <div v-else class="nicole-reading-preview" @click="handleLink" @auxclick="handleLink" v-html="html"></div>
    </div>
  </aside>
</template>

<style scoped>
.comparison-pane { flex: 0 0 44%; max-width: 50%; }
.nicole-reading-preview { overflow-wrap: anywhere; color: var(--reading-fg); font-family: var(--reading-font-body); font-size: var(--reading-font-size); line-height: var(--reading-line-height); }
@media (max-width: 759px) {
  .comparison-pane { flex: 0 0 44%; max-width: none; border-left: 0; border-top: 1px solid var(--border-subtle); }
}
</style>
