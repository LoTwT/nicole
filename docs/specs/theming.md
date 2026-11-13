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

主题包 0.4.0 提供的内容、与 0.3.0 的差异和限制见 [`@ayingott/theme` 参考](../references/ayingott-theme.md)。

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
- 设置里可以分别选择“界面 / 阅读 / 代码”字体，通过更新 `--app-font-sans`、`--app-font-reading` 和 `--app-font-mono` 变量即时生效；空字符串移除覆盖并回到既有字体栈。输入的是本机已装字体名称，应用不枚举、下载或验证字体，找不到时由浏览器继续使用同一字体栈中的回退字体。
- 界面字体影响 `--font-sans`；阅读字体影响 `--font-reading` 和正文的 `--reading-font-body`；代码字体只覆盖 `--reading-font-mono`，用于行内代码和围栏/缩进代码，不改变命令面板、slash 菜单等界面里的等宽标识。
- 字体变量只由页面根元素上的内联变量更新，CodeMirror 主题继续读取同一批 CSS 变量，因此修改字体不会重建 `EditorView`，也不会清空选区或撤销历史。
- 以后如果要内置字体，在用户启用时通过自定义协议和 `FontFace` 动态加载。
- 源码模式使用阅读字体，不用 Space Mono：它太宽，风格也太强。

## 编辑器主题

CodeMirror 6 的主题直接使用 `var(--text-primary)` 这类 CSS 变量。切换亮色和暗色时只改 class，不需要重建编辑器配置。

当前实现：

- 主题保存在用户数据目录的 `settings.json` 中，取值为 `system`、`light` 或 `dark`，默认 `system`。旧版存在 `localStorage` 的 `nicole-theme` 在启动时迁移到设置，成功后删除旧值，见[设置存储](workspace.md#设置存储)。
- `src/App.vue` 切换 `<html>` 上的 `.dark`。`system` 时监听 `prefers-color-scheme` 的变化并实时切换；明确的 `light`/`dark` 不随系统变化。切换时同时调用 `Settings.SetTheme`，由 Go 调用 `mygo.Theme.SetSource`，让原生菜单、右键菜单和对话框跟随；`system` 用 `ThemeSystem`。
- `src/style.css` 在 `@theme` 中覆盖字体变量，并定义 `--nicole-syntax-mark`、`--nicole-caret`、`--nicole-selection`、`--nicole-quote-border`、`--nicole-selected-row`、`--nicole-file-tree-hover` 和 `--nicole-primary-*`，缺失的阅读层变量回退到主题包现有变量。后两组是界面级覆盖，取值和原因见[界面与交互](ui.md#视觉与动效)，这里只保留变量名。`--nicole-selection` 在 Paper 回退到 `--color-lavender-200`（`#ded4ff`），在 `.dark` 下回退到 `--color-lavender-900`（`#3d345d`）；两者都保留 `--reading-selection` 覆盖钩子。Ink 的 `--accent-soft`（`#2c2644`）对代码块背景只有 1.01:1，因此不再作为选区回退。0.4.0 把 `--accent-primary` 定义为只承载 `--accent-contrast` 的填充面，因此编辑器光标和任务框这类独立指示色回退到 `--text-accent`，不随填充色变浅。亮色选区上的 `--text-muted` 为 4.28:1、`--reading-link` 为 4.42:1，低于 4.5:1；用户已确认接受，因为它们分别用于符号和带下划线的链接，且选区是临时状态。
- 字体偏好在 `App.vue` 中应用到 `document.documentElement` 的 `--app-font-sans`、`--app-font-reading` 和 `--app-font-mono` 内联变量；`src/app/settings-display.ts` 生成带既有回退栈的字体族。`--font-mono` 和命令面板等界面的等宽标识不随代码字体变化，`--reading-font-mono` 单独读取 `--app-font-mono`。字体输入在停顿约 350ms 后通过设置写队列合并保存。初始 `Get` 尚未返回时，页面只保留字段级修改意图并即时预览；此时不能把未读取的三个字段按空字符串组成 `SetFonts`。读取成功后，未修改字段使用真实已存值，与用户修改项一起写入；读取失败时不提交含未知字段的整组写入。初始化读取暂时失败后，重新打开设置或再次修改字体会触发一次有界重取，同一时刻最多一个 `Get`；重取期间的新输入最终胜出，重取不重跑工作区/标签页恢复。仍失败时显示明确提示，继续不写未知字段。迟到读取不会覆盖用户当前预览，也不会倒退较新的成功写入基线。
- 任务框变量同样在 `src/style.css` 定义：`--nicole-checkbox-border`、`--nicole-checkbox-bg`、`--nicole-checkbox-checked-border`、`--nicole-checkbox-checked-bg`、`--nicole-checkbox-mark` 和 `--nicole-checkbox-focus`。每个变量写成 `var(--reading-checkbox-*, …)`，主题包 0.4.0 仍未提供 `reading-checkbox-*` 时分别回退到 `--text-muted`、`transparent`、`--text-accent`、`--text-accent`、`--surface-canvas` 和 `--reading-focus`，满足[任务框](ui.md#任务框)的对比度要求。
- `src/editor/index.ts` 的 `EditorView.theme` 和 `HighlightStyle` 只引用这些变量，不读主题状态，因此切换主题不会触发 `EditorView` 重建。
- 选区背景由 CodeMirror 的选择层绘制。基础主题的聚焦规则写成 `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground`，编译后是生成的亮色作用域类加 `.cm-focused` 和三层后代，共五类；`editorTheme` 写出的 `&.cm-editor > .cm-scroller > .cm-selectionLayer .cm-selectionBackground` 本身是四类，编译时再前置生成的作用域类，同为五类。应用主题晚于基础主题挂载，同优先级时后者胜，因此覆盖聚焦和失焦两种状态都不需要 `!important`。`selection.test.ts` 解析实际样式表的层叠，验证亮暗模式下胜出的规则、`--reading-selection` 钩子、`!important` 的缺席，以及 `:root`/`.dark` 的源码顺序和 `@media print` 不会改变结果。
- `window_options.go` 的 `BackgroundColor` 直接写 Paper 和 Ink 的 `--surface-canvas` 值，避免窗口创建到页面绘制之间闪出旧底色；主题包调整画布颜色时需要同步。
- 没有引入 `@ayingott/theme/fonts.css`，构建产物里没有字体文件。

## 限制

主题包不支持在一个主题里局部套用另一个主题（见[参考](../references/ayingott-theme.md#限制)）。因此如果要“应用暗色但预览亮色导出效果”，导出预览必须做成独立页面。

界面组件自己写，或者搭配 Reka UI 这类不带样式的组件库（见[参考](../references/ayingott-theme.md#限制)）。

## 待办：补充主题包变量

以下变量建议补充到 `LoTwT/design-system`，属于该仓库的待办，当前 0.4.0 尚未提供：

| 变量 | 用途 |
|---|---|
| `--reading-syntax-mark` | 露出的 `**`、`#` 等 Markdown 符号的颜色。0.4.0 已有 `--color-syntax-*`，但阅读层还没有对应变量。 |
| `--reading-syntax-*` | 代码高亮。 |
| `--reading-caret` | 光标。 |
| `--reading-selection` | 选区。 |
| `--reading-quote-border` | 引用块边框。 |
| `--reading-callout-*` | Callout。 |
| `--reading-table-*` | 表格。 |
