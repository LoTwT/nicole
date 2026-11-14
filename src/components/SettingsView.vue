<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import type { AppPlatform } from "../app/platform";
import type { FontField, SlashMode } from "../app/settings-display";
import { ESCAPE_HELP } from "../app/shortcut-help";
import { commandRegistry } from "../commands/registry";
import {
  historyShortcutRows,
  shortcutSections,
} from "../commands/shortcuts";
import type { ThemeSetting } from "../services/settings";
import KeyHint from "./KeyHint.vue";

const props = defineProps<{
  platform: AppPlatform;
  theme: ThemeSetting;
  uiFont: string;
  readingFont: string;
  codeFont: string;
  showAllFiles: boolean;
  hideMarkdownExtension: boolean;
  formatToolbarVisible: boolean;
  slashEnabled: Readonly<Record<SlashMode, boolean>>;
}>();

const emit = defineEmits<{
  "update:theme": [theme: ThemeSetting];
  "update:font": [field: FontField, value: string];
  "update:show-all-files": [value: boolean];
  "update:hide-markdown-extension": [value: boolean];
  "update:format-toolbar-visible": [value: boolean];
  "update:slash-enabled": [mode: SlashMode, value: boolean];
}>();

const themeSelect = ref<HTMLSelectElement | null>(null);
const sections = computed(() => shortcutSections(commandRegistry, props.platform));
const historyRows = computed(() => historyShortcutRows(props.platform));

const slashModes: readonly { id: SlashMode; label: string }[] = [
  { id: "live", label: "实时预览" },
  { id: "immersive", label: "沉浸" },
  { id: "source", label: "源码" },
];

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function checkedValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function updateTheme(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "system" || value === "light" || value === "dark") {
    emit("update:theme", value);
  }
}

onMounted(() => {
  // The first control is the page's predictable entry point when the tab
  // opens from the sidebar, a shortcut, the palette or the native menu.
  themeSelect.value?.focus();
});
</script>

<template>
  <div class="h-full overflow-y-auto" data-settings-view>
    <div class="mx-auto w-full max-w-[720px] px-6 py-8">
      <h1 class="m-0 text-[20px] font-semibold text-[var(--text-primary)]">
        设置
      </h1>

      <section
        class="mt-7"
        aria-labelledby="settings-appearance"
        data-settings-group="appearance"
      >
        <h2
          id="settings-appearance"
          class="m-0 text-[13px] font-semibold text-[var(--text-primary)]"
        >
          外观
        </h2>
        <div class="mt-3 space-y-4">
          <div class="flex items-center justify-between gap-4">
            <label for="settings-theme" class="text-[13px] text-[var(--text-primary)]">
              主题
            </label>
            <select
              id="settings-theme"
              ref="themeSelect"
              class="focus-ring rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
              :value="theme"
              @change="updateTheme"
            >
              <option value="system">跟随系统</option>
              <option value="light">亮色</option>
              <option value="dark">暗色</option>
            </select>
          </div>

          <div>
            <div class="flex items-center justify-between gap-4">
              <label for="settings-ui-font" class="text-[13px] text-[var(--text-primary)]">
                界面字体
              </label>
              <button
                type="button"
                class="focus-ring rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                aria-label="界面字体使用系统默认"
                @click="emit('update:font', 'ui', '')"
              >
                系统默认
              </button>
            </div>
            <input
              id="settings-ui-font"
              type="text"
              class="focus-ring mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
              placeholder="系统默认"
              :value="uiFont"
              @input="emit('update:font', 'ui', inputValue($event))"
            />
            <p class="mb-0 mt-1 text-[12px] text-[var(--text-secondary)]">
              界面文字预览 123 ABC
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between gap-4">
              <label
                for="settings-reading-font"
                class="text-[13px] text-[var(--text-primary)]"
              >
                阅读字体
              </label>
              <button
                type="button"
                class="focus-ring rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                aria-label="阅读字体使用系统默认"
                @click="emit('update:font', 'reading', '')"
              >
                系统默认
              </button>
            </div>
            <input
              id="settings-reading-font"
              type="text"
              class="focus-ring mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
              placeholder="系统默认"
              :value="readingFont"
              @input="emit('update:font', 'reading', inputValue($event))"
            />
            <p
              class="mb-0 mt-1 text-[15px] text-[var(--text-primary)]"
              :style="{ fontFamily: 'var(--reading-font-body)' }"
            >
              阅读字体预览 The quick brown fox
            </p>
          </div>

          <div>
            <div class="flex items-center justify-between gap-4">
              <label
                for="settings-code-font"
                class="text-[13px] text-[var(--text-primary)]"
              >
                代码字体
              </label>
              <button
                type="button"
                class="focus-ring rounded-[var(--radius-control)] px-2 py-1 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
                aria-label="代码字体使用系统默认"
                @click="emit('update:font', 'code', '')"
              >
                系统默认
              </button>
            </div>
            <input
              id="settings-code-font"
              type="text"
              class="focus-ring mt-1 w-full rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--surface-subtle)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
              placeholder="系统默认"
              :value="codeFont"
              @input="emit('update:font', 'code', inputValue($event))"
            />
            <p
              class="mb-0 mt-1 rounded-[var(--radius-control)] bg-[var(--reading-code-bg)] px-2 py-1 text-[13px] text-[var(--text-primary)]"
              :style="{ fontFamily: 'var(--reading-font-mono)' }"
            >
              const note = "代码字体预览";
            </p>
          </div>
        </div>
      </section>

      <section
        class="mt-7"
        aria-labelledby="settings-file-tree"
        data-settings-group="file-tree"
      >
        <h2
          id="settings-file-tree"
          class="m-0 text-[13px] font-semibold text-[var(--text-primary)]"
        >
          文件树
        </h2>
        <div class="mt-3 space-y-3">
          <label class="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input
              type="checkbox"
              class="focus-ring size-4"
              :checked="showAllFiles"
              @change="emit('update:show-all-files', checkedValue($event))"
            />
            显示所有文件
          </label>
          <label
            class="flex items-center gap-2 text-[13px]"
            :class="
              showAllFiles
                ? 'text-[var(--text-muted)]'
                : 'text-[var(--text-primary)]'
            "
          >
            <input
              type="checkbox"
              class="focus-ring size-4"
              :checked="hideMarkdownExtension"
              :disabled="showAllFiles"
              @change="
                emit(
                  'update:hide-markdown-extension',
                  checkedValue($event),
                )
              "
            />
            隐藏 .md 后缀
          </label>
        </div>
      </section>

      <section
        class="mt-7"
        aria-labelledby="settings-editing"
        data-settings-group="editing"
      >
        <h2
          id="settings-editing"
          class="m-0 text-[13px] font-semibold text-[var(--text-primary)]"
        >
          编辑
        </h2>
        <div class="mt-3 space-y-3">
          <label class="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
            <input
              type="checkbox"
              class="focus-ring size-4"
              :checked="formatToolbarVisible"
              @change="
                emit(
                  'update:format-toolbar-visible',
                  checkedValue($event),
                )
              "
            />
            显示格式工具栏
          </label>
          <fieldset class="m-0 border-0 p-0">
            <legend class="p-0 text-[13px] text-[var(--text-primary)]">
              slash 命令
            </legend>
            <div class="mt-2 space-y-2 pl-1">
              <label
                v-for="slashMode in slashModes"
                :key="slashMode.id"
                class="flex items-center gap-2 text-[13px] text-[var(--text-primary)]"
              >
                <input
                  type="checkbox"
                  class="focus-ring size-4"
                  :checked="slashEnabled[slashMode.id]"
                  :data-slash-mode="slashMode.id"
                  @change="
                    emit(
                      'update:slash-enabled',
                      slashMode.id,
                      checkedValue($event),
                    )
                  "
                />
                {{ slashMode.label }}
              </label>
            </div>
          </fieldset>
        </div>
      </section>

      <section
        class="mt-7"
        aria-labelledby="settings-shortcuts"
        data-settings-group="shortcuts"
      >
        <h2
          id="settings-shortcuts"
          class="m-0 text-[13px] font-semibold text-[var(--text-primary)]"
        >
          快捷键
        </h2>
        <div class="mt-3 space-y-5">
          <div>
            <h3 class="m-0 text-[12px] font-semibold text-[var(--text-muted)]">
              编辑
            </h3>
            <dl class="m-0 mt-2 space-y-1">
              <div
                v-for="row in historyRows"
                :key="row.id"
                class="flex items-baseline justify-between gap-4 text-[13px]"
                :data-shortcut-id="row.id"
              >
                <dt class="text-[var(--text-primary)]">{{ row.label }}</dt>
                <dd class="m-0 flex flex-wrap justify-end gap-x-3">
                  <KeyHint
                    v-for="key in row.keys"
                    :key="key"
                    :shortcut="key"
                  />
                </dd>
              </div>
              <div
                class="flex items-baseline justify-between gap-4 text-[13px]"
                data-shortcut-id="general.escape"
              >
                <dt class="text-[var(--text-primary)]">{{ ESCAPE_HELP.label }}</dt>
                <dd class="m-0 flex flex-wrap justify-end gap-x-3">
                  <KeyHint :shortcut="ESCAPE_HELP.displayKey" />
                </dd>
              </div>
            </dl>
          </div>

          <div v-for="section in sections" :key="section.id">
            <h3 class="m-0 text-[12px] font-semibold text-[var(--text-muted)]">
              {{ section.label }}
            </h3>
            <dl class="m-0 mt-2 space-y-1">
              <div
                v-for="entry in section.entries"
                :key="entry.id"
                class="flex items-baseline justify-between gap-4 text-[13px]"
                :data-shortcut-id="entry.id"
              >
                <dt class="text-[var(--text-primary)]">{{ entry.label }}</dt>
                <dd class="m-0 flex flex-wrap justify-end gap-x-3">
                  <KeyHint
                    v-for="key in entry.keys"
                    :key="key"
                    :shortcut="key"
                  />
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
