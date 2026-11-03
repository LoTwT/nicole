<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

import {
  editSelectionRange,
  expandedPaths as collectExpanded,
  findNode,
  mergeChildren,
  parentPath,
  toTreeNodes,
  type TreeEditState,
  type TreeNode,
} from "../app/file-tree";
import { buildContextMenu } from "../app/context-menu";
import type { AppPlatform } from "../app/platform";
import { matchCommand } from "../commands/keybinding";
import { commandRegistry } from "../commands/registry";
import { copyText } from "../services/clipboard";
import {
  createFile,
  createFolder,
  listDirectory,
  openWithDefaultApp,
  renameEntry,
  revealEntry,
} from "../services/files";
import { popupNativeMenu } from "../services/menu";
import type { WorkspaceFileEvent } from "../services/mygo";
import AppIcon from "./AppIcon.vue";
import FileTreeNode from "./FileTreeNode.vue";
import InlineNameInput from "./InlineNameInput.vue";

const props = defineProps<{
  rootName: string;
  rootPath: string;
  rootDisplayPath: string;
  generation: number;
  selectedPath: string | null;
  platform: AppPlatform;
  initialExpanded: readonly string[];
}>();

const emit = defineEmits<{
  "open-entry": [entry: TreeNode];
  "entry-created": [path: string, isDir: boolean];
  "entry-renaming": [oldPath: string, newPath: string, isDir: boolean];
  "entry-rename-failed": [oldPath: string];
  "entry-renamed": [oldPath: string, newPath: string, isDir: boolean];
  "trash-request": [entry: TreeNode];
  "expanded-change": [folders: string[]];
  status: [message: string];
}>();

const tree = ref<HTMLElement | null>(null);
const nodes = ref<TreeNode[]>([]);
const rootOpen = ref(true);
const rootLoading = ref(false);
const rootError = ref(false);
const expandedSet = ref(new Set<string>());
const focusedPath = ref("");
const editing = ref<TreeEditState | null>(null);
let loadSequence = 0;

const isRootCreate = computed(
  () =>
    editing.value !== null &&
    editing.value.kind !== "rename" &&
    editing.value.target === ".",
);

const showRootEmpty = computed(
  () => !rootLoading.value && !rootError.value && nodes.value.length === 0,
);

function applyExpanded() {
  expandedSet.value = new Set(
    props.initialExpanded.filter(
      (path) => !path.split("/").includes("node_modules"),
    ),
  );
}

async function loadRoot() {
  const sequence = ++loadSequence;
  rootLoading.value = true;
  rootError.value = false;
  nodes.value = [];
  try {
    const listing = await listDirectory(".");
    if (sequence !== loadSequence) {
      return;
    }
    nodes.value = toTreeNodes(listing.entries, expandedSet.value);
    focusedPath.value =
      props.selectedPath ?? nodes.value[0]?.path ?? "";
    await loadStoredFolders(nodes.value, sequence);
  } catch (error) {
    if (sequence === loadSequence) {
      rootError.value = true;
      emit("status", `读取文件夹失败：${errorText(error)}`);
    }
  } finally {
    if (sequence === loadSequence) {
      rootLoading.value = false;
    }
  }
}

async function loadStoredFolders(
  list: TreeNode[],
  sequence: number,
): Promise<void> {
  for (const node of list) {
    if (!node.isDir || !node.expanded) {
      continue;
    }
    const children = await fetchChildren(node);
    if (sequence !== loadSequence) {
      continue;
    }
    if (!children) {
      node.expanded = false;
      expandedSet.value.delete(node.path);
      continue;
    }
    node.children = children;
    node.loading = false;
    await loadStoredFolders(children, sequence);
  }
}

async function fetchChildren(node: TreeNode): Promise<TreeNode[] | null> {
  node.loading = true;
  try {
    const listing = await listDirectory(node.path);
    return toTreeNodes(listing.entries, expandedSet.value);
  } catch (error) {
    emit("status", `读取“${node.name}”失败：${errorText(error)}`);
    return null;
  } finally {
    node.loading = false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The inline name editor handles Enter/Escape itself; every other key must
 * stay inside the input instead of reaching tree navigation or commands.
 */
function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  );
}

function persistExpanded() {
  emit("expanded-change", collectExpanded(nodes.value));
}

async function expandNode(node: TreeNode): Promise<boolean> {
  if (!node.isDir) {
    return false;
  }
  if (!node.expanded) {
    node.expanded = true;
    node.children = null;
    expandedSet.value.add(node.path);
    persistExpanded();
  }
  if (node.children === null) {
    const children = await fetchChildren(node);
    if (children === null) {
      node.expanded = false;
      node.children = null;
      expandedSet.value.delete(node.path);
      persistExpanded();
      return false;
    }
    node.children = children;
  }
  await nextTick();
  return true;
}

async function collapseNode(node: TreeNode) {
  if (!node.isDir) {
    return;
  }
  node.expanded = false;
  expandedSet.value.delete(node.path);
  removeExpandedBelow(node.path);
  persistExpanded();
  focusedPath.value = node.path;
  await focusPath(node.path);
}

function removeExpandedBelow(path: string) {
  for (const item of [...expandedSet.value]) {
    if (item.startsWith(`${path}/`)) {
      expandedSet.value.delete(item);
    }
  }
}

async function toggleNode(node: TreeNode) {
  if (node.expanded) {
    await collapseNode(node);
  } else {
    await expandNode(node);
    focusedPath.value = node.path;
    await focusPath(node.path);
  }
}

async function focusPath(path: string) {
  await nextTick();
  const element = tree.value?.querySelector<HTMLElement>(
    `[data-tree-path="${cssEscape(path)}"]`,
  );
  element?.focus();
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

async function openNode(node: TreeNode) {
  if (node.isDir) {
    await toggleNode(node);
    return;
  }
  emit("open-entry", node);
}

function visibleNodes(): TreeNode[] {
  const result: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      result.push(node);
      if (node.isDir && node.expanded && node.children) {
        walk(node.children);
      }
    }
  };
  walk(nodes.value);
  return result;
}

async function moveFocus(delta: number) {
  const visible = visibleNodes();
  if (visible.length === 0) {
    return;
  }
  const index = visible.findIndex((node) => node.path === focusedPath.value);
  const next = Math.min(
    Math.max(index === -1 ? 0 : index + delta, 0),
    visible.length - 1,
  );
  const node = visible[next]!;
  focusedPath.value = node.path;
  await focusPath(node.path);
}

function focusedNode(): TreeNode | null {
  return findNode(nodes.value, focusedPath.value);
}

async function startCreate(kind: "create-file" | "create-folder", dir: string) {
  let target = dir === "" ? "." : dir;
  if (target !== ".") {
    const node = findNode(nodes.value, target);
    if (!node?.isDir) {
      target = ".";
    } else if (!(await expandNode(node))) {
      return;
    }
  }
  rootOpen.value = true;
  editing.value = {
    kind,
    target,
    value: kind === "create-file" ? "未命名.md" : "未命名文件夹",
  };
  await nextTick();
}

async function startRename(node: TreeNode) {
  editing.value = { kind: "rename", target: node.path, value: node.name };
  focusedPath.value = node.path;
  await nextTick();
}

function cancelEdit() {
  editing.value = null;
}

function updateEdit(value: string) {
  if (editing.value) {
    editing.value.value = value;
  }
}

async function commitEdit() {
  const current = editing.value;
  if (current === null) {
    return;
  }
  editing.value = null;
  const value = current.value.trim();
  if (value === "") {
    return;
  }

  try {
    if (current.kind === "rename") {
      const node = findNode(nodes.value, current.target);
      if (!node || value === node.name) {
        return;
      }
      const oldPath = node.path;
      const oldDir = node.isDir;
      const parent = parentPath(oldPath);
      const expectedPath = parent === "." ? value : `${parent}/${value}`;
      emit("entry-renaming", oldPath, expectedPath, oldDir);
      let newPath: string;
      try {
        newPath = await renameEntry(oldPath, value, props.generation);
      } catch (error) {
        emit("entry-rename-failed", oldPath);
        throw error;
      }
      if (oldDir) {
        for (const item of [...expandedSet.value]) {
          if (item === oldPath) {
            expandedSet.value.delete(item);
            expandedSet.value.add(newPath);
          } else if (item.startsWith(`${oldPath}/`)) {
            expandedSet.value.delete(item);
            expandedSet.value.add(`${newPath}${item.slice(oldPath.length)}`);
          }
        }
      }
      await reloadFolder(parentPath(oldPath));
      focusedPath.value = newPath;
      emit("entry-renamed", oldPath, newPath, oldDir);
      await focusPath(newPath);
      return;
    }

    if (current.kind === "create-file") {
      const created = await createFile(
        current.target,
        value,
        props.generation,
      );
      await reloadFolder(current.target);
      emit("entry-created", created, false);
      focusedPath.value = created;
      await focusPath(created);
      return;
    }

    const created = await createFolder(
      current.target,
      value,
      props.generation,
    );
    const targetNode = findNode(nodes.value, current.target);
    if (targetNode) {
      targetNode.children = null;
      await expandNode(targetNode);
    }
    await reloadFolder(current.target);
    emit("entry-created", created, true);
    focusedPath.value = created;
    await focusPath(created);
  } catch (error) {
    emit("status", `操作失败：${errorText(error)}`);
    editing.value = current;
  }
}

async function reloadFolder(path: string): Promise<void> {
  if (path === ".") {
    const listing = await listDirectory(".");
    nodes.value = mergeChildren(
      nodes.value,
      listing.entries,
      expandedSet.value,
    );
    return;
  }
  const node = findNode(nodes.value, path);
  if (!node?.isDir || node.children === null) {
    return;
  }
  const listing = await listDirectory(path);
  node.children = mergeChildren(
    node.children,
    listing.entries,
    expandedSet.value,
  );
}

async function reveal(path: string): Promise<void> {
  rootOpen.value = true;
  const parts = path.split("/");
  let prefix = "";
  for (let index = 0; index < parts.length - 1; index++) {
    prefix = prefix === "" ? parts[index]! : `${prefix}/${parts[index]}`;
    const node = findNode(nodes.value, prefix);
    if (!node?.isDir) {
      return;
    }
    if (!(await expandNode(node))) {
      return;
    }
  }
  focusedPath.value = path;
  await nextTick();
  const element = tree.value?.querySelector<HTMLElement>(
    `[data-tree-path="${cssEscape(path)}"]`,
  );
  element?.scrollIntoView?.({ block: "nearest" });
}

function remapTreePath(oldPath: string, newPath: string) {
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.path === oldPath) {
        node.path = newPath;
        node.name = newPath.slice(newPath.lastIndexOf("/") + 1);
        if (node.children) {
          walk(node.children);
        }
      } else if (node.path.startsWith(`${oldPath}/`)) {
        node.path = `${newPath}${node.path.slice(oldPath.length)}`;
        if (node.children) {
          walk(node.children);
        }
      }
    }
  };
  walk(nodes.value);
  for (const item of [...expandedSet.value]) {
    if (item === oldPath) {
      expandedSet.value.delete(item);
      expandedSet.value.add(newPath);
    } else if (item.startsWith(`${oldPath}/`)) {
      expandedSet.value.delete(item);
      expandedSet.value.add(`${newPath}${item.slice(oldPath.length)}`);
    }
  }
  if (focusedPath.value === oldPath || focusedPath.value.startsWith(`${oldPath}/`)) {
    focusedPath.value = `${newPath}${focusedPath.value.slice(oldPath.length)}`;
  }
}

async function refreshFromEvents(events: readonly WorkspaceFileEvent[]) {
  const changed = new Set<string>();
  for (const event of events) {
    if (event.op === "rename" && event.oldPath && event.oldPath !== event.path) {
      remapTreePath(event.oldPath, event.path);
    }
    if (event.path) {
      changed.add(parentPath(event.path));
    }
    if (event.oldPath) {
      changed.add(parentPath(event.oldPath));
    }
  }
  for (const path of changed) {
    try {
      await reloadFolder(path);
    } catch (error) {
      emit("status", `刷新文件夹失败：${errorText(error)}`);
    }
  }
  persistExpanded();
  if (focusedPath.value === "" && nodes.value[0]) {
    focusedPath.value = nodes.value[0].path;
  }
}

async function handleTreeKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) {
    return;
  }
  if (isTextEntryTarget(event.target)) {
    return;
  }
  const node = focusedNode();
  const modifier = props.platform === "macos" ? event.metaKey : event.ctrlKey;

  if (event.key === "ArrowDown" && !modifier) {
    event.preventDefault();
    await moveFocus(1);
    return;
  }
  if (event.key === "ArrowUp" && !modifier) {
    event.preventDefault();
    await moveFocus(-1);
    return;
  }
  if (event.key === "ArrowRight" && node) {
    event.preventDefault();
    if (node.isDir && !node.expanded) {
      await expandNode(node);
      await focusPath(node.path);
    } else if (node.isDir && node.children?.[0]) {
      focusedPath.value = node.children[0].path;
      await focusPath(focusedPath.value);
    }
    return;
  }
  if (event.key === "ArrowLeft" && node) {
    event.preventDefault();
    if (node.isDir && node.expanded) {
      await collapseNode(node);
    } else {
      focusedPath.value = parentPath(node.path);
      await focusPath(focusedPath.value);
    }
    return;
  }

  const command = matchCommand(
    event,
    props.platform,
    commandRegistry,
    "file-tree",
  );
  if (command === null) {
    return;
  }
  const handled = command.run({
    view: null,
    platform: props.platform,
    fileTree: {
      focusedNode: node,
      open: (target) => openNode(target),
      rename: (target) => startRename(target),
      trash: (target) => {
        emit("trash-request", target);
      },
      createFolder: (target) =>
        startCreate(
          "create-folder",
          target?.isDir ? target.path : target ? parentPath(target.path) : ".",
        ),
    },
  });
  if (handled) {
    event.preventDefault();
  }
}

async function showMenu(
  target: "blank" | "root" | "file" | "folder",
  node: TreeNode | null,
  event: MouseEvent,
) {
  const items = buildContextMenu({
    target,
    platform: props.platform,
    isMarkdown: node?.isMarkdown ?? false,
    inWorkspace: true,
  });
  let choice = "";
  try {
    choice = await popupNativeMenu({
      x: Math.round(event.clientX),
      y: Math.round(event.clientY),
      items,
    });
  } catch (error) {
    emit("status", `菜单打开失败：${errorText(error)}`);
    return;
  }
  if (choice === "") {
    return;
  }
  const entryPath = node?.path ?? ".";
  const dir = node?.isDir ? node.path : node ? parentPath(node.path) : ".";
  switch (choice) {
    case "new-file":
      await startCreate("create-file", dir);
      break;
    case "new-folder":
      await startCreate("create-folder", dir);
      break;
    case "rename":
      if (node) {
        await startRename(node);
      }
      break;
    case "trash":
      if (node) {
        emit("trash-request", node);
      }
      break;
    case "open-default-app":
      if (node && !node.isDir) {
        try {
          await openWithDefaultApp(node.path, props.generation);
        } catch (error) {
          emit("status", `打开失败：${errorText(error)}`);
        }
      }
      break;
    case "reveal":
      try {
        await revealEntry(entryPath, props.generation);
      } catch (error) {
        emit("status", `无法显示：${errorText(error)}`);
      }
      break;
    case "copy-path": {
      const absolute =
        entryPath === "." ? props.rootPath : `${props.rootPath}/${entryPath}`;
      if (!(await copyText(absolute))) {
        emit("status", "复制失败");
      }
      break;
    }
    case "copy-relative-path":
      if (!(await copyText(entryPath))) {
        emit("status", "复制失败");
      }
      break;
  }
}

function handleTreeMenu(event: MouseEvent) {
  const element = (event.target as HTMLElement | null)?.closest(
    "[data-tree-path]",
  );
  if (element) {
    return;
  }
  void showMenu("blank", null, event);
}

function removePath(path: string) {
  const node = findNode(nodes.value, path);
  if (!node) {
    return;
  }
  const parent = parentPath(path);
  if (parent === ".") {
    nodes.value = nodes.value.filter((item) => item.path !== path);
    return;
  }
  const parentNode = findNode(nodes.value, parent);
  if (parentNode?.children) {
    parentNode.children = parentNode.children.filter(
      (item) => item.path !== path,
    );
  }
  removeExpandedBelow(path);
  persistExpanded();
}

applyExpanded();
watch(
  () => [props.rootPath, props.generation] as const,
  () => {
    applyExpanded();
    void loadRoot();
  },
  { immediate: true },
);

watch(
  () => props.selectedPath,
  (path) => {
    if (path) {
      focusedPath.value = path;
    }
  },
);

defineExpose({
  refresh: loadRoot,
  refreshFromEvents,
  reveal,
  removePath,
  startCreate,
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      class="group flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] pr-1 text-[12px] font-semibold text-[var(--text-secondary)]"
      role="group"
      :aria-label="`根目录 ${rootName}`"
      @contextmenu.prevent="showMenu('root', null, $event)"
    >
      <button
        type="button"
        class="focus-ring flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-1 text-left hover:bg-[var(--surface-subtle)]"
        :aria-expanded="rootOpen"
        @click="rootOpen = !rootOpen"
      >
        <AppIcon
          :name="rootOpen ? 'chevron-down' : 'chevron-right'"
          :size="12"
          class="shrink-0 text-[var(--text-muted)]"
        />
        <span class="shrink-0">{{ rootName }}</span>
        <span
          v-if="!rootOpen"
          class="min-w-0 truncate text-[11px] font-normal text-[var(--text-muted)]"
        >
          {{ rootDisplayPath }}
        </span>
      </button>
      <button
        type="button"
        class="focus-ring grid size-5 shrink-0 place-items-center rounded-[var(--radius-control)] text-[var(--text-muted)] opacity-0 hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
        aria-label="新建文件"
        title="新建文件"
        @click="startCreate('create-file', '.')"
      >
        <AppIcon name="plus" :size="13" />
      </button>
    </div>

    <div
      ref="tree"
      class="min-h-0 flex-1 overflow-auto"
      role="tree"
      aria-label="文件"
      @keydown="handleTreeKeydown"
      @contextmenu.prevent="handleTreeMenu"
    >
      <div v-if="rootLoading" class="px-2 py-2 text-[12px] text-[var(--text-muted)]">
        读取中
      </div>
      <div
        v-else-if="rootError"
        class="flex items-center gap-2 px-2 py-2 text-[12px] text-[var(--text-muted)]"
      >
        无法读取文件夹
        <button
          type="button"
          class="focus-ring rounded-[var(--radius-control)] underline"
          @click="loadRoot"
        >
          重试
        </button>
      </div>
      <template v-else-if="rootOpen">
        <div
          v-if="isRootCreate && editing"
          class="flex h-[26px] items-center pr-1"
          :style="{ paddingLeft: '8px' }"
        >
          <AppIcon
            :name="editing.kind === 'create-folder' ? 'folder' : 'file-text'"
            :size="14"
            class="mr-1.5 shrink-0 text-[var(--text-muted)]"
          />
          <InlineNameInput
            :value="editing.value"
            :select-start="editSelectionRange(editing)[0]"
            :select-end="editSelectionRange(editing)[1]"
            :label="editing.kind === 'create-folder' ? '新建文件夹' : '新建文件'"
            @update:value="updateEdit"
            @commit="commitEdit"
            @cancel="cancelEdit"
          />
        </div>
        <FileTreeNode
          v-for="node in nodes"
          :key="node.path"
          :node="node"
          :depth="0"
          :selected-path="selectedPath"
          :focused-path="focusedPath"
          :editing="editing"
          :platform="platform"
          @toggle="toggleNode"
          @open="openNode"
          @menu="
            (entry, event) =>
              showMenu(entry.isDir ? 'folder' : 'file', entry, event)
          "
          @focus="focusedPath = $event.path"
          @start-rename="startRename"
          @update-edit="updateEdit"
          @commit-edit="commitEdit"
          @cancel-edit="cancelEdit"
        />
        <div v-if="showRootEmpty" class="px-2 py-2 text-[12px] text-[var(--text-muted)]">
          <p class="m-0">这个文件夹是空的</p>
          <button
            type="button"
            class="focus-ring mt-2 rounded-[var(--radius-control)] border border-[var(--border-default)] px-2 py-1 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)]"
            @click="startCreate('create-file', '.')"
          >
            新建文件
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
