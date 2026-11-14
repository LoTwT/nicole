<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AppPlatform } from "../app/platform";
import {
  compileReadingCSS,
  defaultWritingPreferences,
  type WritingPreferences,
} from "../app/writing-preferences";
import { commandRegistry, formatCommandShortcut } from "../commands/registry";
import {
  canCustomizeCommand,
  validateKeybinding,
} from "../commands/keybinding-settings";

const props = defineProps<{
  value: WritingPreferences;
  platform: AppPlatform;
}>();
const emit = defineEmits<{ update: [patch: Partial<WritingPreferences>] }>();
const cssDraft = ref(props.value.customCss),
  cssError = ref<string | null>(compileReadingCSS(props.value.customCss).error);
const keyError = ref<string | null>(null);
const commands = computed(() =>
  commandRegistry.filter((command) => canCustomizeCommand(command.id)),
);
watch(
  () => props.value.customCss,
  (value) => {
    cssDraft.value = value;
    cssError.value = compileReadingCSS(value).error;
  },
);
function setKey(id: string, value: string) {
  const values = { ...props.value.keybindings, [id]: value.trim() };
  keyError.value = validateKeybinding(
    id,
    value,
    values,
    commandRegistry,
    props.platform,
  );
  if (keyError.value === null) emit("update", { keybindings: values });
}
function resetKey(id: string) {
  const values = { ...props.value.keybindings };
  delete values[id];
  keyError.value = null;
  emit("update", { keybindings: values });
}
function applyCSS() {
  const compiled = compileReadingCSS(cssDraft.value);
  cssError.value = compiled.error;
  if (!compiled.error) emit("update", { customCss: cssDraft.value });
}
const numericFields = [
  {
    key: "fontSize" as const,
    label: "正文字号（px）",
    min: 12,
    max: 36,
    step: 1,
  },
  {
    key: "lineHeight" as const,
    label: "正文行距",
    min: 1.2,
    max: 2.4,
    step: 0.1,
  },
  {
    key: "contentWidth" as const,
    label: "正文宽度（ch）",
    min: 40,
    max: 100,
    step: 1,
  },
];
</script>

<template>
  <div
    class="mt-5 space-y-4 text-[13px] text-[var(--text-primary)]"
    data-writing-settings
  >
    <h3 class="m-0 font-semibold">长文写作</h3>
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        :checked="value.focusMode"
        @change="
          emit('update', {
            focusMode: ($event.target as HTMLInputElement).checked,
          })
        "
      />专注模式：突出当前段落</label
    >
    <label class="flex items-center gap-2"
      ><input
        type="checkbox"
        :checked="value.typewriterMode"
        @change="
          emit('update', {
            typewriterMode: ($event.target as HTMLInputElement).checked,
          })
        "
      />打字机模式：输入位置保持居中</label
    >
    <label
      v-for="field in numericFields"
      :key="field.key"
      class="flex items-center justify-between gap-3"
    >
      {{ field.label }}
      <input
        type="number"
        class="focus-ring w-24 rounded border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1"
        :min="field.min"
        :max="field.max"
        :step="field.step"
        :value="value[field.key]"
        @change="
          emit('update', {
            [field.key]: Number(($event.target as HTMLInputElement).value),
          })
        "
      />
    </label>
    <button
      type="button"
      class="focus-ring rounded border border-[var(--border-default)] px-2 py-1"
      @click="emit('update', defaultWritingPreferences())"
    >
      恢复写作偏好默认值
    </button>
    <details class="rounded border border-[var(--border-default)] p-3">
      <summary class="cursor-pointer font-semibold">自定义快捷键</summary>
      <p class="text-[var(--text-secondary)]">
        使用 Mod 表示 ⌘ / Ctrl，如
        Mod-Alt-b。留空可停用该命令的快捷键。设置入口和标签导航保留默认键位。
      </p>
      <p v-if="keyError" role="alert" class="text-[var(--status-danger-fg)]">
        {{ keyError }}
      </p>
      <div class="space-y-2">
        <label
          v-for="command in commands"
          :key="command.id"
          class="flex items-center gap-2"
        >
          <span class="min-w-0 flex-1">{{ command.label }}</span>
          <input
            type="text"
            :aria-label="`${command.label}快捷键`"
            class="focus-ring w-36 rounded border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1 font-mono"
            :value="value.keybindings[command.id] ?? ''"
            :placeholder="formatCommandShortcut(command, platform) ?? '未设置'"
            @change="
              setKey(command.id, ($event.target as HTMLInputElement).value)
            "
          />
          <button
            type="button"
            class="focus-ring text-[var(--text-secondary)]"
            :aria-label="`恢复${command.label}默认快捷键`"
            @click="resetKey(command.id)"
          >
            重置
          </button>
        </label>
      </div>
      <button
        type="button"
        class="focus-ring mt-3 rounded border border-[var(--border-default)] px-2 py-1"
        @click="emit('update', { keybindings: {} })"
      >
        恢复全部默认快捷键
      </button>
    </details>
    <details class="rounded border border-[var(--border-default)] p-3">
      <summary class="cursor-pointer font-semibold">自定义阅读 CSS</summary>
      <p class="text-[var(--text-secondary)]">
        只作用于正文与对照阅读区，支持文字、颜色、边框和间距。不支持外部资源、at-rule、嵌套与布局属性。
      </p>
      <textarea
        v-model="cssDraft"
        aria-label="自定义阅读 CSS"
        spellcheck="false"
        rows="7"
        class="focus-ring w-full rounded border border-[var(--border-default)] bg-[var(--surface-subtle)] p-2 font-mono"
        placeholder=".cm-content { color: #544b48; }"
      />
      <p v-if="cssError" role="alert" class="text-[var(--status-danger-fg)]">
        {{ cssError }}
      </p>
      <div class="mt-2 flex gap-3">
        <button
          type="button"
          class="focus-ring rounded border border-[var(--border-default)] px-2 py-1"
          @click="applyCSS"
        >
          应用 CSS
        </button>
        <button
          type="button"
          class="focus-ring rounded border border-[var(--border-default)] px-2 py-1"
          @click="
            cssDraft = '';
            cssError = null;
            emit('update', { customCss: '' });
          "
        >
          清除 CSS
        </button>
      </div>
    </details>
  </div>
</template>
