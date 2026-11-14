<script setup lang="ts">
import { ref } from "vue";
import AppDialog from "./AppDialog.vue";
import { applyFrontmatter, type FrontmatterDraft, type FrontmatterField } from "../app/frontmatter";

const props = defineProps<{ draft: FrontmatterDraft }>();
const emit = defineEmits<{ cancel: []; apply: [change: { from: number; to: number; insert: string } | null] }>();
const fields = ref<FrontmatterField[]>(props.draft.fields.map((field) => ({ ...field })));
const error = ref("");
let nextId = props.draft.fields.length;
const composing = ref(false);
function addField() { fields.value.push({ id: nextId++, key: "", kind: "text", value: "" }); }
function apply() {
  if (composing.value) return;
  try { emit("apply", applyFrontmatter(props.draft, fields.value)); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
</script>

<template>
  <AppDialog :open="true" title="编辑 Frontmatter" :width="700" :composition-active="composing" @cancel="!composing && emit('cancel')">
    <div data-frontmatter-dialog @compositionstart="composing = true" @compositionend="composing = false" @keydown.stop="!$event.isComposing && ($event.metaKey || $event.ctrlKey) && $event.key === 'Enter' && ($event.preventDefault(), apply())">
      <p class="mt-0 text-[12px]">编辑文档开头的 YAML 字段。应用后只更新元数据块，可一次撤销；复杂值可选择 YAML。</p>
      <div class="max-h-[55vh] space-y-3 overflow-auto pr-1">
        <div v-for="(field, index) in fields" :key="field.id" class="flex flex-wrap items-start gap-2 rounded border border-[var(--border-subtle)] p-2">
          <label class="min-w-0 flex-1 text-[12px]">字段名
            <input v-model="field.key" :aria-label="`字段 ${index + 1} 名称`" class="focus-ring mt-1 w-full rounded border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 py-1" />
          </label>
          <label class="text-[12px]">类型
            <select v-model="field.kind" :aria-label="`字段 ${index + 1} 类型`" class="focus-ring mt-1 block rounded border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 py-1">
              <option value="text">文字</option><option value="number">数字</option><option value="boolean">布尔值</option><option value="yaml">YAML</option>
            </select>
          </label>
          <button type="button" class="focus-ring mt-5 rounded px-2 py-1 text-[12px]" :aria-label="`删除字段 ${index + 1}`" @click="fields.splice(index, 1)">删除</button>
          <label class="w-full text-[12px]">值
            <select v-if="field.kind === 'boolean'" v-model="field.value" :aria-label="`字段 ${index + 1} 值`" class="focus-ring mt-1 block rounded border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 py-1"><option value="true">true</option><option value="false">false</option></select>
            <textarea v-else v-model="field.value" :aria-label="`字段 ${index + 1} 值`" :rows="field.kind === 'yaml' || field.value.includes('\n') ? 3 : 1" class="focus-ring mt-1 block w-full rounded border border-[var(--border-default)] bg-[var(--surface-canvas)] px-2 py-1" :class="field.kind === 'yaml' && 'font-mono'" spellcheck="false"></textarea>
          </label>
        </div>
      </div>
      <button type="button" class="focus-ring mt-3 rounded border border-[var(--border-default)] px-3 py-1" :disabled="fields.length >= 200" @click="addField">添加字段</button>
      <p v-if="error" role="alert" class="mb-0 text-[var(--status-danger-fg)]">{{ error }}</p>
    </div>
    <template #actions>
      <button type="button" class="focus-ring button-secondary rounded border px-3 py-1.5" @click="emit('cancel')">取消</button>
      <button type="button" class="focus-ring button-primary rounded border px-3 py-1.5" @click="apply">应用修改</button>
    </template>
  </AppDialog>
</template>
