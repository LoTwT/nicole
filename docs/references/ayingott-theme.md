# `@ayingott/theme` 参考

概要：记录 `@ayingott/theme` 0.3.0 提供的内容、限制和字体文件体积问题，供[主题与字体](../specs/theming.md)引用。

- 包名：`@ayingott/theme`
- 版本：0.3.0
- 仓库：`LoTwT/design-system`
- 核对日期：2026-10-31

## 提供的内容

0.3.0 是一个纯 CSS 的 Tailwind v4 主题包，没有 JS 运行时。它提供：

- 语义颜色变量：`--surface-*`、`--text-*`、`--accent-*` 等。
- Paper（亮色）和 Ink（`.dark`，暗色）主题。
- 可选的 Brutal 风格：`brutal.css` 加 `.brutal`。
- 长文阅读层 `--reading-*`：65ch 行宽、1.7 行高、标题字号、链接色、代码背景色。
- 焦点和无障碍工具类。

## 限制

- 不支持在一个主题里局部套用另一个主题。
- V0 版本没有组件。

## 字体文件

`fonts.css` 里的霞鹜文楷有两个字重，各约 8MB，而且没做子集化。主题包的 `--font-sans` 又把文楷放在第一位，一旦引入，所有中文界面都会去加载这个字体。
