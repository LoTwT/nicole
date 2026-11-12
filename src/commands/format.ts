import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type {
  ChangeSpec,
  EditorState,
  Line,
  TransactionSpec,
} from "@codemirror/state";

import { openLinkEditorEffect } from "../editor/link-editor";
import type { CommandDefinition, CommandTarget } from "./types";

interface InlineFormat {
  node: string;
  mark: string;
  marker: string;
}

const INLINE_FORMATS = {
  bold: { node: "StrongEmphasis", mark: "EmphasisMark", marker: "**" },
  italic: { node: "Emphasis", mark: "EmphasisMark", marker: "*" },
  strikethrough: {
    node: "Strikethrough",
    mark: "StrikethroughMark",
    marker: "~~",
  },
  code: { node: "InlineCode", mark: "CodeMark", marker: "`" },
} satisfies Record<string, InlineFormat>;

/**
 * Formatting is one isolated undo step, even when it follows typing closely.
 * The slash menu captures this transaction and merges it with the trigger
 * deletion into a single step of its own.
 */
function dispatchFormat(target: CommandTarget, spec: TransactionSpec) {
  let annotations: TransactionSpec["annotations"] = isolateHistory.of("full");
  if (spec.annotations) {
    annotations = Array.isArray(spec.annotations)
      ? [isolateHistory.of("full"), ...spec.annotations]
      : [isolateHistory.of("full"), spec.annotations];
  }
  target.dispatch({
    ...spec,
    userEvent: "input.format",
    annotations,
  });
}

function findAncestor(state: EditorState, pos: number, name: string) {
  let node = syntaxTree(state).resolveInner(pos, 1);
  while (node.parent && node.name !== name) {
    node = node.parent;
  }
  return node.name === name ? node : null;
}

function inlineMarkPositions(
  state: EditorState,
  format: InlineFormat,
): { from: number; to: number }[] | null {
  const range = state.selection.main;
  const node = findAncestor(state, range.from, format.node);
  if (!node) return null;
  const marks = node.getChildren(format.mark);
  const first = marks[0];
  const last = marks[marks.length - 1];
  if (!first || !last || first === last) return null;
  return [
    { from: first.from, to: first.to },
    { from: last.from, to: last.to },
  ];
}

function toggleInline(view: CommandTarget, format: InlineFormat) {
  const { state } = view;
  const existing = inlineMarkPositions(state, format);
  if (existing) {
    dispatchFormat(view, { changes: existing });
    return true;
  }

  const range = state.selection.main;
  if (range.empty) {
    const at = range.from;
    dispatchFormat(view, {
      changes: { from: at, insert: format.marker + format.marker },
      selection: { anchor: at + format.marker.length },
    });
    return true;
  }

  dispatchFormat(view, {
    changes: [
      { from: range.from, insert: format.marker },
      { from: range.to, insert: format.marker },
    ],
    selection: {
      anchor: range.from + format.marker.length,
      head: range.to + format.marker.length,
    },
  });
  return true;
}

interface LinePrefix {
  indent: string;
  quote: string;
  marker: string;
  kind: "none" | "heading" | "bullet" | "ordered" | "task";
  headingLevel: number;
  rest: string;
}

function parseLinePrefix(text: string): LinePrefix {
  const indent = /^[ \t]*/.exec(text)?.[0] ?? "";
  let rest = text.slice(indent.length);

  let quote = "";
  for (;;) {
    const match = /^>[ \t]?/.exec(rest);
    if (!match) break;
    quote += match[0];
    rest = rest.slice(match[0].length);
  }

  const heading = /^(#{1,6})(?:[ \t]+|$)/.exec(rest);
  if (heading) {
    return {
      indent,
      quote,
      marker: heading[0],
      kind: "heading",
      headingLevel: heading[1]!.length,
      rest: rest.slice(heading[0].length),
    };
  }

  const bullet = /^([-*+])([ \t]+)(?:(\[[ xX]\])([ \t]+))?/.exec(rest);
  if (bullet) {
    return {
      indent,
      quote,
      marker: bullet[0],
      kind: bullet[3] ? "task" : "bullet",
      headingLevel: 0,
      rest: rest.slice(bullet[0].length),
    };
  }

  const ordered = /^(\d{1,9}[.)])([ \t]+)/.exec(rest);
  if (ordered) {
    return {
      indent,
      quote,
      marker: ordered[0],
      kind: "ordered",
      headingLevel: 0,
      rest: rest.slice(ordered[0].length),
    };
  }

  return {
    indent,
    quote,
    marker: "",
    kind: "none",
    headingLevel: 0,
    rest,
  };
}

function withPrefix(prefix: LinePrefix, marker: string) {
  return `${prefix.indent}${prefix.quote}${marker}${prefix.rest}`;
}

function selectedLines(state: EditorState): Line[] {
  const lines = new Map<number, Line>();
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from);
    const lastPosition =
      range.empty || range.to === range.from
        ? range.head
        : Math.max(range.from, range.to - 1);
    const end = state.doc.lineAt(lastPosition);
    for (let number = start.number; number <= end.number; number++) {
      const line = state.doc.line(number);
      lines.set(line.from, line);
    }
  }
  return [...lines.values()].sort((left, right) => left.from - right.from);
}

function replaceLines(
  view: CommandTarget,
  build: (line: Line, prefix: LinePrefix, index: number) => string,
): boolean {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  selectedLines(state).forEach((line, index) => {
    const replacement = build(line, parseLinePrefix(line.text), index);
    if (replacement !== line.text) {
      changes.push({ from: line.from, to: line.to, insert: replacement });
    }
  });
  if (changes.length === 0) return false;
  const changeSet = state.changes(changes);
  dispatchFormat(view, {
    changes: changeSet,
    selection: state.selection.map(changeSet, 1),
  });
  return true;
}

function toggleHeading(view: CommandTarget, level: number) {
  return replaceLines(view, (_line, prefix) => {
    if (prefix.kind === "heading" && prefix.headingLevel === level) {
      return withPrefix(prefix, "");
    }
    return withPrefix(prefix, `${"#".repeat(level)} `);
  });
}

function toggleList(
  view: CommandTarget,
  kind: "bullet" | "ordered" | "task",
) {
  return replaceLines(view, (_line, prefix, index) => {
    if (prefix.kind === kind) {
      return withPrefix(prefix, "");
    }
    if (kind === "ordered") {
      return withPrefix(prefix, `${index + 1}. `);
    }
    return withPrefix(prefix, kind === "task" ? "- [ ] " : "- ");
  });
}

function toggleQuote(view: CommandTarget) {
  return replaceLines(view, (_line, prefix) => {
    if (prefix.quote) {
      return `${prefix.indent}${prefix.marker}${prefix.rest}`;
    }
    return withPrefix(prefix, `> ${prefix.marker}`);
  });
}

function fenceLineChange(
  state: EditorState,
  line: { from: number; to: number },
): ChangeSpec {
  if (line.to < state.doc.length) {
    return { from: line.from, to: line.to + 1, insert: "" };
  }
  // The last line has no trailing newline, so remove the line break before it
  // instead. This keeps surrounding lines from being joined.
  return { from: Math.max(0, line.from - 1), to: line.to, insert: "" };
}

function removeFenceLines(state: EditorState, position: number) {
  const fenced = syntaxTree(state).resolveInner(position, 1);
  let current = fenced;
  while (current.parent && current.name !== "FencedCode") {
    current = current.parent;
  }
  if (current.name !== "FencedCode") return null;

  const marks = current.getChildren("CodeMark");
  const opening = marks[0];
  const closing = marks[marks.length - 1];
  if (!opening || !closing || opening === closing) return null;

  return [
    fenceLineChange(state, state.doc.lineAt(opening.from)),
    fenceLineChange(state, state.doc.lineAt(closing.from)),
  ];
}

function toggleCodeBlock(view: CommandTarget) {
  const { state } = view;
  const range = state.selection.main;
  const probe = range.empty ? range.head : Math.max(range.from, range.to - 1);
  const fences = removeFenceLines(state, probe);
  if (fences) {
    const changeSet = state.changes(fences);
    dispatchFormat(view, {
      changes: changeSet,
      selection: state.selection.map(changeSet, 1),
    });
    return true;
  }

  if (range.empty) {
    const line = state.doc.lineAt(range.head);
    if (line.text.trim() === "") {
      const content = "```\n\n```";
      dispatchFormat(view, {
        changes: { from: line.from, to: line.to, insert: content },
        // After the opening fence: type a language name, then move into the body.
        selection: { anchor: line.from + 3 },
      });
      return true;
    }
    const content = `\`\`\`\n${line.text}\n\`\`\``;
    dispatchFormat(view, {
      changes: { from: line.from, to: line.to, insert: content },
      selection: {
        anchor: line.from + 4 + (range.head - line.from),
      },
    });
    return true;
  }

  const firstLine = state.doc.lineAt(range.from);
  const lastLine = state.doc.lineAt(Math.max(range.from, range.to - 1));
  const content = state.sliceDoc(firstLine.from, lastLine.to);
  const inserted = `\`\`\`\n${content}\n\`\`\``;
  dispatchFormat(view, {
    changes: { from: firstLine.from, to: lastLine.to, insert: inserted },
    selection: {
      anchor: firstLine.from + 4 + (range.from - firstLine.from),
      head: firstLine.from + 4 + (range.to - firstLine.from),
    },
  });
  return true;
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type TemplateMode = "inline" | "block";

interface TemplateOptions {
  mode?: TemplateMode;
  /** Offsets relative to the inserted template. */
  select?: { anchor: number; head?: number };
}

function insertTemplate(
  view: CommandTarget,
  template: string,
  options: TemplateOptions = {},
) {
  const { state } = view;
  const range = state.selection.main;
  const mode = options.mode ?? "inline";
  let from = range.empty ? range.head : range.from;
  let to = range.empty ? range.head : range.to;
  let base = from;
  let needNewline = false;

  if (range.empty && mode === "block") {
    const line = state.doc.lineAt(range.head);
    if (line.text.trim() === "") {
      dispatchFormat(view, {
        changes: { from: line.from, to: line.to, insert: template },
        selection: selectionFor(line.from, template, options.select),
      });
      return;
    }
    // A block command after text starts on a new line instead of splitting it.
    from = line.to;
    to = line.to;
    base = line.to;
    needNewline = true;
  }

  const inserted = needNewline ? `\n${template}` : template;
  dispatchFormat(view, {
    changes: { from, to, insert: inserted },
    selection: selectionFor(base, inserted, options.select, needNewline ? 1 : 0),
  });
}

function selectionFor(
  base: number,
  template: string,
  select?: { anchor: number; head?: number },
  offset = 0,
): { anchor: number; head?: number } {
  if (!select) {
    return { anchor: base + offset + template.length };
  }
  return {
    anchor: base + offset + select.anchor,
    head:
      select.head === undefined
        ? undefined
        : base + offset + select.head,
  };
}

function textRange(
  template: string,
  needle: string,
): { anchor: number; head: number } {
  const index = template.indexOf(needle);
  return { anchor: index, head: index + needle.length };
}

function insertInline(
  view: CommandTarget,
  template: string,
  needle?: string,
) {
  insertTemplate(view, template, {
    select: needle ? textRange(template, needle) : undefined,
  });
}

function insertBlock(
  view: CommandTarget,
  template: string,
  select?: { anchor: number; head?: number },
) {
  insertTemplate(view, template, { mode: "block", select });
}

const TABLE_TEMPLATE = "| 列 1 | 列 2 |\n| --- | --- |\n|  |  |";
const CALLOUT_TEMPLATE = "> [!note]\n> ";
const MATH_TEMPLATE = "$$\n\n$$";
const MERMAID_TEMPLATE = "```mermaid\n\n```";

export const formatCommands: readonly CommandDefinition[] = [
  {
    id: "format.bold",
    label: "加粗",
    pinyin: "jiacu bold",
    icon: "bold",
    group: "inline",
    scope: "editor",
    keys: [{ key: "Mod-b" }],
    run: ({ view }) => (view ? toggleInline(view, INLINE_FORMATS.bold) : false),
  },
  {
    id: "format.italic",
    label: "斜体",
    pinyin: "xieti italic",
    icon: "italic",
    group: "inline",
    scope: "editor",
    keys: [{ key: "Mod-i" }],
    run: ({ view }) => (view ? toggleInline(view, INLINE_FORMATS.italic) : false),
  },
  {
    id: "format.strikethrough",
    label: "删除线",
    pinyin: "shanchuxian strike strikethrough",
    icon: "strikethrough",
    group: "inline",
    scope: "editor",
    keys: [{ key: "Shift-Mod-x" }],
    run: ({ view }) =>
      view ? toggleInline(view, INLINE_FORMATS.strikethrough) : false,
  },
  {
    id: "format.inline-code",
    label: "行内代码",
    pinyin: "hangneidaima code",
    icon: "code",
    group: "inline",
    scope: "editor",
    keys: [{ key: "Mod-e" }],
    run: ({ view }) => (view ? toggleInline(view, INLINE_FORMATS.code) : false),
  },
  {
    id: "format.heading-1",
    label: "标题 1",
    pinyin: "biaoti heading h1",
    icon: "heading-1",
    glyph: "H1",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Mod-1" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleHeading(view, 1) : false),
  },
  {
    id: "format.heading-2",
    label: "标题 2",
    pinyin: "biaoti heading h2",
    icon: "heading-2",
    glyph: "H2",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Mod-2" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleHeading(view, 2) : false),
  },
  {
    id: "format.heading-3",
    label: "标题 3",
    pinyin: "biaoti heading h3",
    icon: "heading-3",
    glyph: "H3",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Mod-3" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleHeading(view, 3) : false),
  },
  {
    id: "format.bullet-list",
    label: "无序列表",
    pinyin: "wuxuliebiao bullet list",
    icon: "list",
    glyph: "•",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Shift-Mod-8" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleList(view, "bullet") : false),
  },
  {
    id: "format.ordered-list",
    label: "有序列表",
    pinyin: "youxuliebiao ordered list",
    icon: "list-ordered",
    glyph: "1.",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Shift-Mod-7" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleList(view, "ordered") : false),
  },
  {
    id: "format.task-list",
    label: "任务项",
    pinyin: "renwuxiang task todo checkbox",
    icon: "list-todo",
    glyph: "☐",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Shift-Mod-9" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleList(view, "task") : false),
  },
  {
    id: "format.quote",
    label: "引用",
    pinyin: "yinyong quote blockquote",
    icon: "quote",
    glyph: "❝",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Shift-Mod-." }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleQuote(view) : false),
  },
  {
    id: "format.code-block",
    label: "代码块",
    pinyin: "daimakuai code block",
    icon: "square-code",
    glyph: "```",
    group: "paragraph",
    scope: "editor",
    keys: [{ key: "Shift-Mod-c" }],
    inSlashMenu: true,
    run: ({ view }) => (view ? toggleCodeBlock(view) : false),
  },
  {
    id: "insert.horizontal-rule",
    label: "分割线",
    pinyin: "fengexian divider horizontal rule",
    icon: "minus",
    glyph: "—",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertBlock(view, "---");
      return true;
    },
  },
  {
    id: "insert.table",
    label: "表格",
    pinyin: "biaoge table",
    icon: "table",
    glyph: "▦",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertBlock(view, TABLE_TEMPLATE, textRange(TABLE_TEMPLATE, "列 1"));
      return true;
    },
  },
  {
    id: "insert.callout",
    label: "Callout",
    pinyin: "callout biaozhu",
    icon: "message-square",
    glyph: "!",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertBlock(view, CALLOUT_TEMPLATE);
      return true;
    },
  },
  {
    id: "insert.math",
    label: "公式",
    pinyin: "gongshi math latex formula",
    icon: "sigma",
    glyph: "∑",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertBlock(view, MATH_TEMPLATE, { anchor: 3 });
      return true;
    },
  },
  {
    id: "insert.mermaid",
    label: "Mermaid",
    pinyin: "mermaid tu diagram",
    icon: "workflow",
    glyph: "◇",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertBlock(view, MERMAID_TEMPLATE, { anchor: 11 });
      return true;
    },
  },
  {
    id: "insert.image",
    label: "图片",
    pinyin: "tupian image picture",
    icon: "image",
    glyph: "▧",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertInline(view, "![](图片路径)", "图片路径");
      return true;
    },
  },
  {
    id: "format.link",
    label: "链接",
    pinyin: "lianjie link",
    icon: "link",
    glyph: "↗",
    group: "inline",
    scope: "editor",
    keys: [{ key: "Mod-k" }],
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      view.dispatch({ effects: openLinkEditorEffect.of(null) });
      return true;
    },
  },
  {
    id: "insert.date",
    label: "日期",
    pinyin: "riqi date today",
    icon: "calendar",
    glyph: "日",
    group: "insert",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertInline(view, formatDate(new Date()));
      return true;
    },
  },
  {
    id: "insert.file-link",
    label: "链接到文件",
    pinyin: "lianjiedaowenjian link file",
    icon: "file-text",
    glyph: "文件",
    group: "block",
    scope: "editor",
    inSlashMenu: true,
    run: ({ view }) => {
      if (!view) return false;
      insertInline(view, "[文件名](相对路径)", "文件名");
      return true;
    },
  },
];
