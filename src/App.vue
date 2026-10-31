<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import {
  createEditor,
  type EditorHandle,
  type EditorMode,
} from "./editor";
import { SAMPLE_DOCUMENT } from "./sample";
import { getAppInfo, type AppInfo } from "./services/app";

const editorHost = ref<HTMLElement | null>(null);
const mode = ref<EditorMode>("live");
const documentText = ref(SAMPLE_DOCUMENT);
const appInfo = ref<AppInfo | null>(null);
const appInfoError = ref(false);

const modes: readonly { id: EditorMode; label: string; hint: string }[] = [
  { id: "live", label: "实时预览", hint: "光标所在行显示原文" },
  { id: "immersive", label: "沉浸", hint: "符号隐藏，⌘B 切换加粗" },
  { id: "source", label: "源码", hint: "始终显示 Markdown 原文" },
];

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const storedTheme = localStorage.getItem("nicole-theme");
const theme = ref<"light" | "dark">(
  storedTheme === "light" || storedTheme === "dark"
    ? storedTheme
    : prefersDark
      ? "dark"
      : "light",
);
document.documentElement.classList.toggle("dark", theme.value === "dark");

const activeMode = computed(
  () => modes.find((item) => item.id === mode.value) ?? modes[0]!,
);
const themeAction = computed(() =>
  theme.value === "light" ? "切换到暗色主题" : "切换到亮色主题",
);

let editor: EditorHandle | null = null;

function setMode(next: EditorMode) {
  mode.value = next;
  editor?.setMode(next);
  editor?.focus();
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", theme.value === "dark");
  localStorage.setItem("nicole-theme", theme.value);
}

onMounted(async () => {
  if (editorHost.value) {
    editor = createEditor({
      parent: editorHost.value,
      doc: SAMPLE_DOCUMENT,
      mode: mode.value,
      resolveImage: (src) => src,
      onChange: (next) => {
        documentText.value = next;
      },
    });
    editor.focus();
  }

  try {
    appInfo.value = await getAppInfo();
  } catch {
    appInfoError.value = true;
  }
});

onBeforeUnmount(() => {
  editor?.destroy();
  editor = null;
});
</script>

<template>
  <div
    class="flex h-full flex-col bg-[var(--surface-canvas)] text-[var(--text-primary)]"
  >
    <header
      class="flex shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] px-6 py-3"
    >
      <div class="flex min-w-0 items-baseline gap-2">
        <span class="font-display text-lg font-semibold tracking-tight">
          Nicole
        </span>
        <span class="text-xs text-[var(--text-muted)]">
          {{ appInfo ? `v${appInfo.version}` : "" }}
        </span>
      </div>

      <div
        class="mx-auto flex rounded-full border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-1"
        role="group"
        aria-label="编辑模式"
      >
        <button
          v-for="item in modes"
          :key="item.id"
          type="button"
          class="rounded-full px-4 py-1.5 text-sm transition-colors"
          :class="
            mode === item.id
              ? 'bg-[var(--accent-primary)] font-medium text-[var(--accent-contrast)] shadow-sm'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          "
          :aria-pressed="mode === item.id"
          :title="item.hint"
          @click="setMode(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <button
        type="button"
        class="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)] hover:text-[var(--text-primary)]"
        :aria-label="themeAction"
        :title="themeAction"
        @click="toggleTheme"
      >
        {{ theme === "light" ? "暗色" : "亮色" }}
      </button>
    </header>

    <main class="min-h-0 flex-1 overflow-hidden">
      <div ref="editorHost" class="h-full" aria-label="Markdown 编辑器"></div>
    </main>

    <footer
      class="flex shrink-0 items-center justify-between gap-4 border-t border-[var(--border-subtle)] px-6 py-2 text-xs text-[var(--text-muted)]"
    >
      <span>{{ activeMode.label }} · {{ activeMode.hint }}</span>
      <span class="flex items-center gap-3">
        <span>{{ documentText.length }} 字符</span>
        <span v-if="appInfo">
          {{ appInfo.os }}/{{ appInfo.arch }} · {{ appInfo.goVersion }}
        </span>
        <span v-else-if="appInfoError">Go 服务未连接</span>
        <span v-else>连接 Go…</span>
      </span>
    </footer>
  </div>
</template>
