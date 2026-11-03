# `@ayingott/theme` 参考

概要：记录 `@ayingott/theme` 0.4.0 提供的内容、与 0.3.0 的差异和字体文件体积问题，供[主题与字体](../specs/theming.md)引用。

- 包名：`@ayingott/theme`
- 版本：0.4.0
- 仓库：`LoTwT/design-system`
- 核对日期：2026-11-03

## 提供的内容

0.4.0 是一个纯 CSS 的 Tailwind v4 主题包，没有 JS 运行时。它提供：

- 语义颜色变量：`--surface-*`、`--text-*`、`--accent-*` 等。
- Paper（亮色）和 Ink（`.dark`，暗色）主题。
- 可选的 Brutal 风格：`brutal.css` 加 `.brutal`。
- 长文阅读层 `--reading-*`：65ch 行宽、1.7 行高、标题字号、链接色、代码背景色。
- 焦点和无障碍工具类。

## 0.3.0 → 0.4.0 的变化

- **强调色分工**：`--accent-primary` 改为填充面，只承载 `--accent-contrast` 内容；独立指示色（勾选框、进度、选中下划线等）使用 `--text-accent`。Paper 的 `--accent-primary` 从 `lavender-500` 改为 `lavender-300`，`--accent-contrast` 改为 `lavender-900`；Ink 的 `--accent-primary` 改为 `lavender-700`，`--accent-contrast` 改为 `#ffffff`。
- **z-index 顺序**：`--z-popover` 400→1000，`--z-tooltip` 500→1100，`--z-toast` 1000→1200；`--z-overlay` 800 和 `--z-modal` 900 不变。现在 popover 在 modal 之上。
- **颜色**：Ink 从偏紫的暖色 surface 改为中性冷灰；Paper 的 neutral 和 surface 色阶也调了；`--border-strong` 改为不透明色并保证至少 3:1；`--text-muted` 亮暗都变了。Ink 的 `--accent-soft` 从半透明 `rgb(156 143 217 / 0.18)` 改为不透明 `#2c2644`；Nicole 的选区和活动行读取这个变量。
- **交互与阅读状态**：`--accent-primary-hover` / `--accent-primary-active` 在 Paper 改为 `lavender-400` / `lavender-500`，在 Ink 改为 `lavender-800` / `lavender-900`；`--accent-contrast-hover` / `--accent-contrast-active` 在 Paper 改为 `lavender-950`，在 Ink 随 `--accent-contrast` 改为 `#ffffff`。`--reading-link-hover` 在 Paper 改为直接读取 `--color-lavender-800`，不再跟随 `--accent-primary-active`；Ink 仍为 `--color-lavender-200`。Ink 的 `--focus-ring-on-accent-shadow` 从深紫改为 `rgb(199 182 245 / 0.22)`；Paper 不变。
- **代码高亮**：新增 Ink 的 `--color-syntax-*`，Paper 的 syntax 色加深。
- **其他 token**：`--opacity-*` 改为百分比；移除 `--container-xs` 到 `--container-2xl`（Tailwind 默认 container scale 继续可用）；`--ease-emphasized` 曲线改变；新增 `--shadow-2xs` / `--shadow-2xl`，`--shadow-card` / `--shadow-panel` 改为读取运行时变量。
- **字体家族**：内置字体家族名改为 `"Ayingott WenKai"`。Nicole 不引入 `fonts.css`，并在 `src/style.css` 覆盖四个 `--font-*` 变量，因此不受影响。

## 与 Nicole 相关的处理

| 变化 | Nicole 的处理 |
|---|---|
| `--accent-primary` 变成填充面 | 主按钮继续用 `--accent-primary` 背景和 `--accent-contrast` 文字；编辑器光标从 `--accent-primary` 改为回退到 `--text-accent`。 |
| 任务框的独立指示色 | `--nicole-checkbox-checked-*` 和勾选标记继续回退到 `--text-accent` / `--surface-canvas`，不随 `--accent-primary` 变浅。 |
| popover 高于 overlay 和 modal | 打开命令面板前关闭 popover 层和浮出侧栏；对话框只关闭 slash 菜单和模式菜单，浮出侧栏保持打开并使用 `--z-header` 位于对话框之下。 |
| `--opacity-*` 改为百分比 | Nicole 只用 Tailwind 的 `opacity-0`、`opacity-40`、`opacity-50`、`opacity-100`，不引用主题包的 `--opacity-*` token。 |
| 移除 `--container-xs` 到 `--container-2xl` | Nicole 使用 `max-w-[420px]` 和 Tailwind 默认的 `max-w-50`，不依赖这些 token。 |
| `--ease-emphasized`、`--shadow-2xs/2xl`、运行时 `--shadow-card/panel` | Nicole 只直接使用 `--shadow-lg`，没有使用这些 token，不受影响。 |
| 新增深色 `--color-syntax-*` | Nicole 的编辑器目前只高亮 Markdown 标记、链接和行内代码，没有使用代码高亮 token。 |

## 限制

- 不支持在一个主题里局部套用另一个主题。
- V0 版本没有组件。
- 阅读层仍没有 `--reading-caret`、`--reading-selection`、`--reading-checkbox-*`、`--reading-syntax-mark`、`--reading-quote-border` 等变量；Nicole 在 `src/style.css` 保留这些钩子并回退到语义变量，建议清单见[主题与字体](../specs/theming.md#待办补充主题包变量)。

## 字体文件

`fonts.css` 里的霞鹜文楷有两个字重，各约 8MB，而且没做子集化。主题包的 `--font-sans` 又把文楷放在第一位，一旦引入，所有中文界面都会去加载这个字体。0.4.0 把家族名改为 `"Ayingott WenKai"`，避免本地安装的霞鹜文楷替代拉丁正文或代码字体；这不改变文件体积和子集化问题。
