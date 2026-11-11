import type { CommandDefinition } from "./types";

/**
 * Commands handled by the application shell. Actions arrive through the
 * command context so the registry stays static and testable.
 */
export const appCommands: readonly CommandDefinition[] = [
  {
    id: "app.open-folder",
    label: "打开文件夹",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-o" }],
    run: ({ app }) => {
      void app?.chooseFolder();
      return app !== undefined;
    },
  },
  {
    id: "app.new-file",
    label: "新建文件",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-n" }],
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.newFile();
      return app !== undefined;
    },
  },
  {
    id: "app.save",
    label: "立即保存",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-s" }],
    requiresActiveMarkdown: true,
    run: ({ app }) => {
      void app?.saveCurrent();
      return app !== undefined;
    },
  },
  {
    id: "app.close-workspace",
    label: "关闭工作区",
    group: "app",
    scope: "app",
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.closeWorkspace();
      return app !== undefined;
    },
  },
  {
    id: "app.collapse-folders",
    label: "全部折叠",
    group: "app",
    scope: "app",
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.collapseAllFolders();
      return app !== undefined;
    },
  },
  {
    id: "app.reveal-workspace",
    label: "显示工作区文件夹",
    pinyin: "reveal workspace finder explorer",
    group: "app",
    scope: "app",
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.revealWorkspace();
      return app !== undefined;
    },
  },
  {
    id: "app.settings",
    label: "设置",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-," }],
    available: false,
    run: () => false,
  },
  {
    id: "app.toggle-theme",
    label: "切换主题",
    group: "app",
    scope: "app",
    run: ({ app }) => {
      void app?.toggleTheme();
      return app !== undefined;
    },
  },
  {
    id: "nav.quick-open",
    label: "快速打开文件",
    pinyin: "quick open file",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-p" }],
    run: ({ app }) => {
      void app?.openCommandPalette("file");
      return app !== undefined;
    },
  },
  {
    id: "nav.command-palette",
    label: "命令面板",
    pinyin: "command palette",
    group: "app",
    scope: "app",
    keys: [{ key: "Shift-Mod-p" }],
    run: ({ app }) => {
      void app?.openCommandPalette("command");
      return app !== undefined;
    },
  },
  {
    id: "nav.goto-heading",
    label: "转到标题",
    pinyin: "goto heading outline",
    group: "app",
    scope: "app",
    keys: [{ key: "Shift-Mod-o" }],
    run: ({ app }) => {
      void app?.openCommandPalette("heading");
      return app !== undefined;
    },
  },
  {
    id: "nav.search",
    label: "全文搜索",
    group: "app",
    scope: "app",
    keys: [{ key: "Shift-Mod-f" }],
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.openWorkspaceSearch();
      return app !== undefined;
    },
  },
  {
    id: "nav.toggle-sidebar",
    label: "显示或隐藏侧栏",
    group: "app",
    scope: "app",
    keys: [
      { mac: "Ctrl-Mod-s", win: "Ctrl-Shift-e", linux: "Ctrl-Shift-e" },
    ],
    requiresWorkspace: true,
    run: ({ app }) => {
      void app?.toggleSidebar();
      return app !== undefined;
    },
  },
  {
    id: "nav.toggle-outline",
    label: "显示或隐藏大纲",
    group: "app",
    scope: "app",
    keys: [
      { mac: "Ctrl-Mod-o", win: "Ctrl-Shift-l", linux: "Ctrl-Shift-l" },
    ],
    available: false,
    run: () => false,
  },
  {
    id: "file-tree.open",
    label: "打开",
    group: "app",
    scope: "file-tree",
    keys: [{ mac: "Mod-ArrowDown", win: "Enter", linux: "Enter" }],
    run: ({ fileTree }) => {
      const node = fileTree?.focusedNode;
      if (!fileTree || !node) return false;
      void fileTree.open(node);
      return true;
    },
  },
  {
    id: "file-tree.rename",
    label: "重命名",
    group: "app",
    scope: "file-tree",
    keys: [{ mac: "Enter", win: "F2", linux: "F2" }],
    run: ({ fileTree }) => {
      const node = fileTree?.focusedNode;
      if (!fileTree || !node) return false;
      void fileTree.rename(node);
      return true;
    },
  },
  {
    id: "file-tree.trash",
    label: "移到废纸篓",
    group: "app",
    scope: "file-tree",
    keys: [{ mac: "Mod-Backspace", win: "Delete", linux: "Delete" }],
    run: ({ fileTree }) => {
      const node = fileTree?.focusedNode;
      if (!fileTree || !node) return false;
      void fileTree.trash(node);
      return true;
    },
  },
  {
    id: "file-tree.new-folder",
    label: "新建文件夹",
    group: "app",
    scope: "file-tree",
    keys: [{ key: "Shift-Mod-n" }],
    run: ({ fileTree }) => {
      if (!fileTree) return false;
      void fileTree.createFolder(fileTree.focusedNode);
      return true;
    },
  },
  {
    id: "tab.close",
    label: "关闭标签页",
    group: "app",
    scope: "app",
    keys: [{ key: "Mod-w" }],
    requiresOpenTab: true,
    run: ({ app }) => {
      void app?.closeActiveTab();
      return app !== undefined;
    },
  },
  {
    id: "tab.reopen",
    label: "重新打开关闭的标签页",
    group: "app",
    scope: "app",
    keys: [{ key: "Shift-Mod-t" }],
    requiresWorkspace: true,
    requiresClosedTab: true,
    run: ({ app }) => {
      void app?.reopenClosedTab();
      return app !== undefined;
    },
  },
  {
    id: "tab.next",
    label: "下一个标签页",
    group: "app",
    scope: "app",
    keys: [
      { key: "Ctrl-Tab" },
      { mac: "Shift-Mod-]", win: "Ctrl-PageDown", linux: "Ctrl-PageDown" },
    ],
    requiresMultipleTabs: true,
    run: ({ app }) => {
      void app?.nextTab();
      return app !== undefined;
    },
  },
  {
    id: "tab.previous",
    label: "上一个标签页",
    group: "app",
    scope: "app",
    keys: [
      { key: "Ctrl-Shift-Tab" },
      { mac: "Shift-Mod-[", win: "Ctrl-PageUp", linux: "Ctrl-PageUp" },
    ],
    requiresMultipleTabs: true,
    run: ({ app }) => {
      void app?.previousTab();
      return app !== undefined;
    },
  },
  {
    id: "mode.live",
    label: "实时预览",
    group: "app",
    scope: "app",
    keys: [
      { mac: "Ctrl-Mod-1", win: "Ctrl-Shift-1", linux: "Ctrl-Shift-1" },
    ],
    run: ({ app }) => {
      void app?.setMode("live");
      return app !== undefined;
    },
  },
  {
    id: "mode.immersive",
    label: "沉浸",
    group: "app",
    scope: "app",
    keys: [
      { mac: "Ctrl-Mod-2", win: "Ctrl-Shift-2", linux: "Ctrl-Shift-2" },
    ],
    run: ({ app }) => {
      void app?.setMode("immersive");
      return app !== undefined;
    },
  },
  {
    id: "mode.source",
    label: "源码",
    group: "app",
    scope: "app",
    keys: [
      { mac: "Ctrl-Mod-3", win: "Ctrl-Shift-3", linux: "Ctrl-Shift-3" },
    ],
    run: ({ app }) => {
      void app?.setMode("source");
      return app !== undefined;
    },
  },
];
