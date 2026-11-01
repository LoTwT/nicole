# 架构

概要：

- 桌面外壳使用 MyGo Web 模式，前端是 Vue 3 + Vite + Tailwind CSS v4，编辑器是 CodeMirror 6。
- `src/editor/` 是纯 TypeScript 模块，不依赖 Vue 和 MyGo；MyGo 调用只出现在 `src/services/` 和 `main.go`。
- 前后端通过 MyGo 的类型化 IPC 通信。
- 渲染的 HTML 必须经过 DOMPurify，文件与协议访问限制在当前工作区。
- 各功能的具体行为由对应规格定义，本文只记录结构和共享约束。

## 技术选型

| 层 | 选择 |
|---|---|
| 桌面外壳 | MyGo Web 模式，Go 后端。要求 Go 1.27.3 以上；开发机当前为 1.27.2，可以用 `GOTOOLCHAIN=auto` 自动下载。 |
| 界面框架 | Vue 3 + Vite + **Tailwind CSS v4**（通过 `@tailwindcss/vite` 接入）。用户明确要求**不用 UnoCSS**。 |
| 编辑器 | CodeMirror 6 + `@codemirror/lang-markdown`（GFM），自己实现 decorations 和 widgets。 |
| 代码块高亮 | `@codemirror/language-data`，按需加载。 |
| Slash 菜单 | `@codemirror/autocomplete` 加自定义触发规则。 |
| 公式和图表 | KaTeX、Mermaid，都懒加载。 |
| 导出 | markdown-it 加插件；PDF 用 WebView 自带的打印。用一组测试用例保证和编辑时（Lezer 解析）的渲染一致。 |
| 安全 | DOMPurify，见[安全](#安全)。 |
| 文件监听 | MyGo `watch` 插件，见[工作区与文件](specs/workspace.md#文件监听)。 |
| 搜索 | MVP 阶段 Go 直接扫描文件；以后用 SQLite FTS5 trigram，见[工作区与文件](specs/workspace.md#搜索)。 |
| 测试 | Vitest 测编辑器，`go test` 测后端，MyGo `automation` 插件做端到端测试。 |
| 分发与更新 | GitHub Releases（`LoTwT/nicole`）+ MyGo 签名更新；应用侧用 `updater.Plugin`，见[发布与自动更新](release.md)。 |

MyGo 的接口与版本情况见 [MyGo 参考](references/mygo.md)。

## 进程和模块结构

```text
src/
  App.vue                 单窗口外壳：编辑区、模式切换、亮暗切换
  main.ts                 挂载 Vue
  sample.ts               示例文本
  style.css               Tailwind、主题和字体变量
  editor/                 纯 TypeScript，不依赖 Vue 和 MyGo
    index.ts              createEditor、三种模式、widgets、核心命令
    types.ts              对外类型
  services/               MyGo 边界
    mygo.ts               生成的类型化客户端
    app.ts                薄封装（getAppInfo）
        │
        │ MyGo 类型化 IPC（绑定方法 / Channel / Event）
        ▼
Go（main.go）
  Application             版本、平台和 Go 版本（当前）
  updater.Plugin          Sparkle 风格更新窗口与“检查更新…”菜单（当前）
  Workspace               文件树、原子写入、重命名并更新引用（后续）
  Assets                  图片存到 assets/（后续）
  Search                  通过 Channel 流式返回结果（后续）
  Settings                全局配置 + 工作区配置（后续）
  Export / Recovery       导出与崩溃恢复（后续）
  Protocol                只映射当前工作区（后续）
```

`index.html` 是 Vite 入口，`mygo.config.ts` 描述应用并指定前端构建、生成客户端的位置和输出目录。

## 依赖边界

- `src/editor/` 是纯 TypeScript，不依赖 Vue，也不依赖 MyGo。运行时只导出 `createEditor`；其余导出是调用方需要的类型。
- MyGo 调用只放在 `src/services/` 和 `main.go`，其他模块通过这两处间接使用后端能力。生成的客户端直接输出到 `src/services/mygo.ts`。
- `main.go` 还注册 MyGo 的 `updater.Plugin` 并设置应用菜单；更新源、版本注入和发布流程见[发布与自动更新](release.md)。
- `src/services/` 是生成的 `mygo.ts` 客户端上的薄封装，不承载业务逻辑。当前 `app.ts` 只把 `Application.Info` 包装成 `getAppInfo`。
- `createEditor` 的接口为：

  ```ts
  type EditorMode = "live" | "immersive" | "source";

  interface EditorCommand {
    id: string;
    label: string;
    key?: string; // CodeMirror 键位，例如 "Mod-b"
    run: (view: EditorView) => boolean;
  }

  createEditor({
    parent,        // 挂载的 DOM 元素
    doc,           // 初始 Markdown 文本
    mode,          // 默认 "live"
    commands,      // 应用层命令；目前注册其中带 key 的绑定，核心 Mod-b 加粗始终可用
    resolveImage,  // 把图片 URL 解析成可显示地址；返回 null 时保留原文
    onChange,      // 文档变化时回调全文
  }): EditorHandle
  ```

  `EditorHandle` 提供 `view`、`mode`、`setMode`、`focus` 和 `destroy`。三种模式通过同一个 `Compartment` 重配置，`EditorView` 实例不变。

- 编辑器主题直接读取 CSS 变量；界面切换亮暗时只改 `<html>` 上的 `.dark`，不重建编辑器（见[主题与字体](specs/theming.md#编辑器主题)）。
- 命令注册表只有一份，各入口共用，见 [Slash 命令](specs/slash-commands.md#命令注册表)。
- 编辑模式的设计和限制见[编辑模式](specs/editor-modes.md)。

## IPC 用法

- MyGo 提供类型化 IPC：绑定方法、`Channel` 和 `Event`。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；本项目是 `src/services/mygo.ts`。
- 前端只通过生成的客户端和 `services/` 调用 Go；Go 用 `mygo.Bind` 暴露服务，用 `*mygo.Channel[T]` 推送流，用 `mygo.NewEvent[T]` 发送事件。
- 当前的最小服务是 `Application.Info()`，返回应用版本、操作系统、架构和 Go 版本，用来验证前端与 Go 的调用链。
- 搜索通过 Channel 流式返回结果（见[工作区与文件](specs/workspace.md#搜索)）。
- 图片数据不经过 IPC，避免 base64 转换和额外拷贝（见[工作区与文件](specs/workspace.md#图片)）。

各接口的具体语义、错误传播和背压行为见 [MyGo 参考](references/mygo.md#绑定与-ipc)。

## 安全

根据 MyGo 的[页面信任模型](references/mygo.md#页面信任模型)，从自定义协议加载的页面是受信任的，可以直接调用 Go 方法。Markdown 里的原始 HTML 如果直接渲染，就能调用这些方法去读写文件。

因此：

- 渲染出来的 HTML 一律先经过 DOMPurify 清洗。
- 沙箱 iframe 可能会额外起进程，尽量不用。
- Go 的文件服务只允许访问工作区目录，拒绝 `../` 这种跳出目录的路径。
- 自定义协议只映射当前工作区。

## 主要风险

| 风险 | 应对 |
|---|---|
| 中文输入法在 macOS WKWebView 里的表现 | 技术验证第一周就测；拼音输入过程中不能重建当前行的渲染，见[中文输入法](specs/editor-modes.md#中文输入法)。 |
| MyGo 的 API 可能变化 | MyGo 仍处于 0.x（当前锁定 0.7.3，见[参考](references/mygo.md)）；锁定版本，并把所有调用集中在 `src/services/` 和 `main.go`。 |
| 沉浸模式的边界情况多 | 先把实时预览做好，再逐步补齐沉浸模式，见[编辑模式](specs/editor-modes.md)。 |
| Linux 的 WebKitGTK 能力较弱 | 平台优先级排在最后，见[平台优先级](specs/product.md#平台优先级)。 |
