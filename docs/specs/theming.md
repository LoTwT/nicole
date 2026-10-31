# 主题与字体

概要：

- 主题分三层：主题包基础变量、`reading-*` 阅读层、用户自定义 CSS。
- 应用自己管理字体，不引入主题包的 `fonts.css`。
- CodeMirror 主题使用 CSS 变量，亮色/暗色切换不重建编辑器。
- 主题不能局部嵌套，导出预览因此做成独立页面。
- 建议主题包补充的阅读变量目前是 `LoTwT/design-system` 的待办。

## 主题分层

1. `@ayingott/theme` 提供的基础变量。
2. `reading-*` 阅读层：编辑区、阅读模式、导出 HTML 共用。
3. 用户自定义 CSS：只能覆盖 `reading-*` 和字体变量，不影响应用界面。

主题包 0.3.0 提供的内容和限制见 [`@ayingott/theme` 参考](../references/ayingott-theme.md)。

## 字体

字体由应用自己管理，**不引入** `@ayingott/theme/fonts.css`：字体文件的体积和 `--font-sans` 的优先级都会拖累中文界面（事实见[参考](../references/ayingott-theme.md#字体文件)）。

在自己的 CSS 里覆盖字体变量。下面的写法**已经用 Tailwind v4 实际编译验证过**：覆盖后 `--font-sans`、`--font-mono`、`--font-reading` 都换成了这里写的值；`--font-display` 也要一并覆盖。

```css
@import "tailwindcss";
@import "@ayingott/theme";

@theme {
  --font-sans:    system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-display: var(--font-sans);
  --font-mono:    ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-reading: var(--app-font-reading, Georgia, "Songti SC", serif);
}
```

- 默认全部使用系统字体，不打包任何字体文件。
- 设置里可以分别选择“界面 / 阅读 / 代码”字体，通过更新 `--app-font-*` 变量即时生效。
- 以后如果要内置字体，在用户启用时通过自定义协议和 `FontFace` 动态加载。
- 源码模式使用阅读字体，不用 Space Mono：它太宽，风格也太强。

## 编辑器主题

CodeMirror 6 的主题直接使用 `var(--text-primary)` 这类 CSS 变量。切换亮色和暗色时只改 class，不需要重建编辑器配置。

当前实现：

- `src/App.vue` 切换 `<html>` 上的 `.dark`，并把选择保存到 `localStorage`。
- `src/style.css` 在 `@theme` 中覆盖字体变量，并定义 `--nicole-syntax-mark`、`--nicole-caret`、`--nicole-selection`、`--nicole-quote-border`，缺失的阅读层变量回退到主题包现有变量。
- `src/editor/index.ts` 的 `EditorView.theme` 和 `HighlightStyle` 只引用这些变量，不读主题状态，因此切换主题不会触发 `EditorView` 重建。
- 没有引入 `@ayingott/theme/fonts.css`，构建产物里没有字体文件。

## 限制

主题包不支持在一个主题里局部套用另一个主题（见[参考](../references/ayingott-theme.md#限制)）。因此如果要“应用暗色但预览亮色导出效果”，导出预览必须做成独立页面。

界面组件自己写，或者搭配 Reka UI 这类不带样式的组件库（见[参考](../references/ayingott-theme.md#限制)）。

## 待办：补充主题包变量

以下变量建议补充到 `LoTwT/design-system`，属于该仓库的待办，当前 0.3.0 尚未提供：

| 变量 | 用途 |
|---|---|
| `--reading-syntax-mark` | 露出的 `**`、`#` 等 Markdown 符号的颜色。 |
| `--reading-syntax-*` | 代码高亮。 |
| `--reading-caret` | 光标。 |
| `--reading-selection` | 选区。 |
| `--reading-quote-border` | 引用块边框。 |
| `--reading-callout-*` | Callout。 |
| `--reading-table-*` | 表格。 |
