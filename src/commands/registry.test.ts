import { describe, expect, it } from "vitest";

import uiMarkdown from "../../docs/specs/ui.md?raw";
import {
  commandRegistry,
  commandShortcut,
  formatCommandShortcut,
  formatKeyBinding,
  getCommand,
  isCommandAvailable,
  resolveKeyBinding,
  slashCommands,
} from "./registry";
import type { CommandDefinition } from "./types";

interface ShortcutRow {
  category: string;
  command: string;
  macos: string;
  windows: string;
}

/** Parses the one shortcut table under `## 快捷键` in ui.md. */
function shortcutRows(markdown: string): ShortcutRow[] {
  const heading = markdown.indexOf("## 快捷键");
  if (heading < 0) throw new Error("ui.md has no shortcut section");
  const nextHeading = markdown.indexOf("\n## ", heading + 1);
  const section = markdown.slice(
    heading,
    nextHeading < 0 ? undefined : nextHeading,
  );
  const rows: ShortcutRow[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== 4) continue;
    if (cells[0] === "分类") continue;
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) continue;
    rows.push({
      category: cells[0]!,
      command: cells[1]!,
      macos: cells[2]!,
      windows: cells[3]!,
    });
  }
  return rows;
}

/**
 * Maps ui.md rows to registry commands. The shortcut text itself is never
 * copied here; it is read from the document and from the registry.
 */
const COMMAND_BY_ROW: Readonly<Record<string, string | readonly string[]>> = {
  "打开文件夹": "app.open-folder",
  "新建文件（当前文件所在的文件夹，否则根目录）": "app.new-file",
  "立即保存": "app.save",
  "设置": "app.settings",
  "快速打开文件": "nav.quick-open",
  "命令面板": "nav.command-palette",
  "转到标题": "nav.goto-heading",
  "全文搜索": "nav.search",
  "显示或隐藏侧栏": "nav.toggle-sidebar",
  "显示或隐藏大纲": "nav.toggle-outline",
  "打开（焦点在文件树）": "file-tree.open",
  "重命名（焦点在文件树）": "file-tree.rename",
  "移到废纸篓（焦点在文件树）": "file-tree.trash",
  "新建文件夹（焦点在文件树）": "file-tree.new-folder",
  "关闭标签页": "tab.close",
  "重新打开关闭的标签页": "tab.reopen",
  "下一个标签页": "tab.next",
  "上一个标签页": "tab.previous",
  "实时预览": "mode.live",
  "沉浸": "mode.immersive",
  "源码": "mode.source",
  "标题 1–3（再按一次同级恢复为正文）": [
    "format.heading-1",
    "format.heading-2",
    "format.heading-3",
  ],
  "加粗": "format.bold",
  "斜体": "format.italic",
  "删除线": "format.strikethrough",
  "行内代码": "format.inline-code",
  "无序列表": "format.bullet-list",
  "有序列表": "format.ordered-list",
  "任务项": "format.task-list",
  "引用": "format.quote",
  "代码块": "format.code-block",
};

/** Rows whose commands are deliberately outside this registry PR. */
const EXCLUDED_ROWS: Readonly<Record<string, string>> = {
  "查找": "PR9 实现 Nicole 查找栏",
  "查找并替换": "PR9 实现 Nicole 查找栏",
  "下一个匹配": "PR9 实现 Nicole 查找栏",
  "上一个匹配": "PR9 实现 Nicole 查找栏",
  "链接": "PR12 登记链接命令",
  "撤销、重做": "CodeMirror 历史命令，不注册为应用命令",
  "打开 slash 菜单": "编辑器输入触发，不是注册表命令",
  "关闭最上层浮层": "Esc 由各浮层自行处理",
};

function bindingTexts(
  command: CommandDefinition,
  platform: "macos" | "windows" | "linux",
): string[] {
  return (command.keys ?? [])
    .map((binding) => formatKeyBinding(binding, platform))
    .filter((text): text is string => text !== null);
}

/** Expands the document's `⌘1–⌘3` / `Ctrl+1–Ctrl+3` shorthand. */
function expandRange(text: string): string[] {
  const match = /^(.*?)(\d)\s*[–-]\s*(.*?)(\d)$/.exec(text);
  if (!match) return [text];
  const [, prefix, startText, suffix, endText] = match;
  const start = Number(startText);
  const end = Number(endText);
  if (prefix !== suffix || start > end || end - start > 10) return [text];
  return Array.from(
    { length: end - start + 1 },
    (_value, index) => `${prefix}${start + index}`,
  );
}

/** Shortcut alternatives in one table cell (`、` and `或` separate them). */
function cellShortcuts(cell: string): string[] {
  return cell
    .split(/\s*(?:、|或)\s*/)
    .map((text) => text.trim())
    .filter(Boolean)
    .flatMap(expandRange);
}

function expectSameShortcuts(
  actual: readonly string[],
  cell: string,
  label: string,
) {
  expect([...new Set(actual)].sort(), label).toEqual(
    [...new Set(cellShortcuts(cell))].sort(),
  );
}

describe("command registry", () => {
  it("has one unique entry per command", () => {
    const ids = commandRegistry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getCommand("format.bold")?.label).toBe("加粗");
    expect(getCommand("format.bold")?.keys).toEqual([{ key: "Mod-b" }]);
    expect(isCommandAvailable(getCommand("nav.quick-open")!)).toBe(true);
    expect(isCommandAvailable(getCommand("nav.command-palette")!)).toBe(true);
    expect(isCommandAvailable(getCommand("nav.goto-heading")!)).toBe(true);
  });

  it("separates slash commands from toolbar-only commands", () => {
    const ids = slashCommands().map((command) => command.id);
    expect(ids).toContain("format.heading-2");
    expect(ids).toContain("insert.table");
    expect(ids).not.toContain("format.bold");
    expect(ids).not.toContain("format.italic");
  });

  it("matches every implemented ui.md shortcut row", () => {
    const rows = shortcutRows(uiMarkdown);
    expect(rows.length).toBeGreaterThan(30);
    const tableRows = new Set(rows.map((row) => row.command));

    for (const key of Object.keys(COMMAND_BY_ROW)) {
      expect(tableRows.has(key), `mapped row missing from ui.md: ${key}`).toBe(
        true,
      );
    }
    for (const key of Object.keys(EXCLUDED_ROWS)) {
      expect(tableRows.has(key), `excluded row missing from ui.md: ${key}`).toBe(
        true,
      );
    }

    for (const row of rows) {
      const mapped = COMMAND_BY_ROW[row.command];
      if (mapped === undefined) {
        expect(
          EXCLUDED_ROWS[row.command],
          `unmapped shortcut row: ${row.command}`,
        ).toBeDefined();
        continue;
      }

      const ids = Array.isArray(mapped) ? mapped : [mapped];
      const commands = ids.map((id) => {
        const command = getCommand(id);
        expect(command, id).toBeDefined();
        return command!;
      });

      expectSameShortcuts(
        commands.flatMap((command) => bindingTexts(command, "macos")),
        row.macos,
        `${row.command} macOS`,
      );
      expectSameShortcuts(
        commands.flatMap((command) => bindingTexts(command, "windows")),
        row.windows,
        `${row.command} Windows`,
      );
      expectSameShortcuts(
        commands.flatMap((command) => bindingTexts(command, "linux")),
        row.windows,
        `${row.command} Linux`,
      );
    }
  });

  it("registers unavailable placeholders without dispatching them", () => {
    for (const id of ["app.settings", "nav.search", "nav.toggle-outline"]) {
      const command = getCommand(id);
      expect(command, id).toBeDefined();
      expect(isCommandAvailable(command!), id).toBe(false);
      expect(formatCommandShortcut(command!, "macos"), id).not.toBeNull();
    }
    expect(getCommand("app.toggle-theme")?.keys).toBeUndefined();
    expect(commandShortcut("missing.command", "macos")).toBe("");
  });

  it("supports platform-specific and multiple key bindings", () => {
    const binding = {
      key: "Mod-Shift-x",
      mac: "Shift-Cmd-X",
      win: "Ctrl-Shift-X",
      linux: "Ctrl-Shift-X",
    };
    expect(resolveKeyBinding(binding, "macos")).toBe("Shift-Cmd-X");
    expect(resolveKeyBinding(binding, "windows")).toBe("Ctrl-Shift-X");
    expect(formatKeyBinding(binding, "macos")).toBe("⇧⌘X");
    expect(formatKeyBinding(binding, "windows")).toBe("Ctrl+Shift+X");
    expect(formatKeyBinding(binding, "linux")).toBe("Ctrl+Shift+X");
    expect(formatKeyBinding({ key: "Shift-Mod-8" }, "windows")).toBe(
      "Ctrl+Shift+8",
    );
    expect(formatKeyBinding({ key: "Shift-Mod-8" }, "linux")).toBe(
      "Ctrl+Shift+8",
    );

    const command = {
      ...getCommand("format.bold")!,
      keys: [{ key: "Mod-b" }, { mac: "Cmd-b", win: "Ctrl-b" }],
    };
    expect(formatCommandShortcut(command, "macos")).toBe("⌘B");
    expect(formatCommandShortcut(command, "windows")).toBe("Ctrl+B");
  });

  it("formats punctuation and navigation keys for both platforms", () => {
    expect(formatKeyBinding({ key: "Shift-Mod-." }, "macos")).toBe("⇧⌘.");
    expect(formatKeyBinding({ key: "Mod-," }, "windows")).toBe("Ctrl+,");
    expect(formatKeyBinding({ key: "Mod-ArrowDown" }, "macos")).toBe("⌘↓");
    expect(formatKeyBinding({ key: "Shift-Ctrl-Tab" }, "linux")).toBe(
      "Ctrl+Shift+Tab",
    );
  });
});
