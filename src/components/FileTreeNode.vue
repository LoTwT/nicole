<script setup lang="ts">
import { computed } from "vue";

import {
  editSelectionRange,
  type TreeEditState,
  type TreeNode,
} from "../app/file-tree";
import type { AppPlatform } from "../app/platform";
import { fileDisplayName } from "../app/settings-display";
import AppIcon from "./AppIcon.vue";
import InlineNameInput from "./InlineNameInput.vue";

const props = defineProps<{
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  tabStopPath: string;
  editing: TreeEditState | null;
  platform: AppPlatform;
  hideMarkdownExtension: boolean;
}>();

const emit = defineEmits<{
  toggle: [node: TreeNode];
  open: [node: TreeNode];
  menu: [node: TreeNode, event: MouseEvent];
  focus: [node: TreeNode];
  "start-rename": [node: TreeNode];
  "update-edit": [value: string];
  "commit-edit": [source: "enter" | "blur"];
  "cancel-edit": [];
}>();

const isMuted = computed(
  () =>
    !props.node.isMarkdown ||
    props.node.name.startsWith(".") ||
    props.node.name === "node_modules",
);

const isSelected = computed(() => props.selectedPath === props.node.path);
const isRenaming = computed(
  () =>
    props.editing?.kind === "rename" && props.editing.target === props.node.path,
);

const renameRange = computed<[number, number]>(() =>
  props.editing ? editSelectionRange(props.editing) : [0, 0],
);

const paddingLeft = computed(() => `${8 + props.depth * 14}px`);

function activate() {
  if (props.node.isDir) {
    emit("toggle", props.node);
    return;
  }
  emit("open", props.node);
}
</script>

<template>
  <div>
    <div
      v-if="isRenaming"
      class="flex h-[26px] items-center gap-1.5 pr-1"
      :style="{ paddingLeft }"
      role="treeitem"
      :aria-level="depth + 1"
      :data-tree-path="node.path"
    >
      <span class="w-3 shrink-0"></span>
      <AppIcon
        :name="node.isDir ? 'folder' : node.isMarkdown ? 'file-text' : 'file'"
        :size="14"
        class="shrink-0 text-[var(--text-muted)]"
      />
      <InlineNameInput
        :value="editing?.value ?? node.name"
        :select-start="renameRange[0]"
        :select-end="renameRange[1]"
        label="重命名"
        @update:value="emit('update-edit', $event)"
        @commit="emit('commit-edit', $event)"
        @cancel="emit('cancel-edit')"
      />
    </div>
    <div
      v-else
      :data-tree-path="node.path"
      role="treeitem"
      :aria-level="depth + 1"
      :aria-expanded="node.isDir ? node.expanded : undefined"
      :aria-selected="isSelected"
      :tabindex="tabStopPath === node.path ? 0 : -1"
      class="focus-ring group flex h-[26px] cursor-default select-none items-center gap-1.5 rounded-[var(--radius-control)] pr-1 text-[13px] outline-offset-[-2px]"
      :class="[
        isSelected
          ? 'bg-[var(--nicole-selected-row)] text-[var(--text-primary)]'
          : 'hover:bg-[var(--nicole-file-tree-hover)]',
        isMuted && !isSelected ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]',
      ]"
      :style="{ paddingLeft }"
      @click="activate"
      @focus="emit('focus', node)"
      @contextmenu.prevent.stop="emit('menu', node, $event)"
    >
      <AppIcon
        v-if="node.isDir"
        :name="node.expanded ? 'chevron-down' : 'chevron-right'"
        :size="12"
        class="shrink-0 text-[var(--text-muted)]"
      />
      <span v-else class="w-3 shrink-0"></span>
      <AppIcon
        :name="node.isDir ? 'folder' : node.isMarkdown ? 'file-text' : 'file'"
        :size="14"
        class="shrink-0 text-[var(--text-muted)]"
      />
      <span class="min-w-0 flex-1 truncate">{{
        fileDisplayName(node, hideMarkdownExtension)
      }}</span>
      <span v-if="node.loading" class="text-[11px] text-[var(--text-muted)]">读取中</span>
    </div>

    <div v-if="node.isDir && node.expanded" role="group">
      <div
        v-if="editing?.kind !== undefined && editing.kind !== 'rename' && editing.target === node.path"
        class="flex h-[26px] items-center gap-1.5 pr-1"
        :style="{ paddingLeft: `${8 + (depth + 1) * 14}px` }"
      >
        <span class="w-3 shrink-0"></span>
        <AppIcon
          :name="editing.kind === 'create-folder' ? 'folder' : 'file-text'"
          :size="14"
          class="shrink-0 text-[var(--text-muted)]"
        />
        <InlineNameInput
          :value="editing.value"
          :select-start="editSelectionRange(editing)[0]"
          :select-end="editSelectionRange(editing)[1]"
          :label="editing.kind === 'create-folder' ? '新建文件夹' : '新建文件'"
          @update:value="emit('update-edit', $event)"
          @commit="emit('commit-edit', $event)"
          @cancel="emit('cancel-edit')"
        />
      </div>
      <template v-if="node.children && node.children.length > 0">
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :selected-path="selectedPath"
          :tab-stop-path="tabStopPath"
          :editing="editing"
          :platform="platform"
          :hide-markdown-extension="hideMarkdownExtension"
          @toggle="emit('toggle', $event)"
          @open="emit('open', $event)"
          @menu="(childNode, event) => emit('menu', childNode, event)"
          @focus="emit('focus', $event)"
          @start-rename="emit('start-rename', $event)"
          @update-edit="emit('update-edit', $event)"
          @commit-edit="emit('commit-edit', $event)"
          @cancel-edit="emit('cancel-edit')"
        />
      </template>
    </div>
  </div>
</template>
