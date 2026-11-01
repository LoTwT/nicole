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
  App.vue                 单窗口外壳：打开文件夹、文件选择、自动保存、模式与主题切换
  main.ts                 挂载 Vue
  sample.ts               示例文本
  style.css               Tailwind、主题和字体变量
  image-url.ts            把 Markdown 图片 URL 解析成自定义协议地址
  editor/                 纯 TypeScript，不依赖 Vue 和 MyGo
    index.ts              createEditor、三种模式、widgets、核心命令、图片插入
    types.ts              对外类型
  services/               MyGo 边界
    mygo.ts               生成的类型化客户端
    app.ts                薄封装（getAppInfo）
    assets.ts             薄封装（粘贴、拖入图片、窗口文件拖放事件）
    workspace.ts          薄封装（选择文件夹、列文件、读写、关窗保存）
        │
        │ MyGo 类型化 IPC（绑定方法 / Channel / Event）
        ▼
Go（main.go）
  Application             版本、平台和 Go 版本（当前）
  updater.Plugin          Sparkle 风格更新窗口与“检查更新…”菜单（当前）
  watch 插件（watch.New） 按当前工作区动态授权监听根目录（当前）
  Workspace               选择文件夹、列 Markdown、代际绑定写入、关窗保存（当前）
  Assets                  图片存到 assets/，读剪贴板和拖入文件（当前）
  Image protocol          只映射当前工作区的图片（当前；启动时注册，运行时读工作区根）
  Window state            启动时在光标屏幕居中，沿用上次尺寸（当前）
  Search                  通过 Channel 流式返回结果（后续）
  Settings                全局配置 + 工作区配置（后续）
  Export / Recovery       导出与崩溃恢复（后续）
```

`main.go` 负责注册插件、绑定服务、注册图片协议、设置菜单和创建窗口；`workspace.go` 实现工作区与路径守卫，`assets.go` 实现图片保存，`protocol.go` 实现图片协议，`window_state.go` 实现窗口状态的居中策略。`index.html` 是 Vite 入口，`mygo.config.ts` 描述应用并指定前端构建、生成客户端的位置和输出目录。

## 依赖边界

- `src/editor/` 是纯 TypeScript，不依赖 Vue，也不依赖 MyGo。运行时只导出 `createEditor`；其余导出是调用方需要的类型。
- MyGo 调用只放在 `src/services/` 和 `main.go`，其他模块通过这两处间接使用后端能力。生成的客户端直接输出到 `src/services/mygo.ts`。
- `main.go` 还注册 MyGo 的 `updater.Plugin` 和 `watch` 插件并设置应用菜单；更新源、版本注入和发布流程见[发布与自动更新](release.md)。
- `src/services/` 是生成的 `mygo.ts` 客户端上的薄封装，不承载业务逻辑。`app.ts` 只把 `Application.Info` 包装成 `getAppInfo`；`workspace.ts` 包装 `Workspace` 的方法和关窗保存事件，不拼接路径，也不缓存内容。
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
    onPasteImage,  // 剪贴板里有图片、即将粘贴时回调，参数是插入位置
    onDropFiles,   // 编辑区内拖入文件时回调，参数是插入位置
    onChange,      // 文档变化时回调全文
  }): EditorHandle
  ```

  `EditorHandle` 提供 `view`、`mode`、`setMode`、`insertImages`、`focus` 和 `destroy`。`insertImages(at, markdown)` 在一个事务里插入文本，因此是一个撤销步；中文输入法组合期间先排队，组合结束后再插入。`onPasteImage` 和 `onDropFiles` 只报告位置，保存图片和生成 Markdown 由应用层经 `src/services/assets.ts` 完成；编辑区不接触 MyGo。三种模式通过同一个 `Compartment` 重配置，`EditorView` 实例不变。

- 编辑器主题直接读取 CSS 变量；界面切换亮暗时只改 `<html>` 上的 `.dark`，不重建编辑器（见[主题与字体](specs/theming.md#编辑器主题)）。
- 命令注册表只有一份，各入口共用，见 [Slash 命令](specs/slash-commands.md#命令注册表)。
- 编辑模式的设计和限制见[编辑模式](specs/editor-modes.md)。

## IPC 用法

- MyGo 提供类型化 IPC：绑定方法、`Channel` 和 `Event`。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；本项目是 `src/services/mygo.ts`。
- 前端只通过生成的客户端和 `services/` 调用 Go；Go 用 `mygo.Bind` 暴露服务，用 `*mygo.Channel[T]` 推送流，用 `mygo.NewEvent[T]` 发送事件。
- 当前的最小服务是 `Application.Info()`，返回应用版本、操作系统、架构和 Go 版本，用来验证前端与 Go 的调用链。
- `Workspace` 提供 `ChooseFolder`、`ListFiles`、`ReadFile`、`WriteFile`、`ConfirmDiscard` 和 `FinishClose`；写入携带打开时返回的 `generation`，路径和文件类型的规则见[工作区与文件](specs/workspace.md#路径守卫)和[写入保证](specs/workspace.md#写入保证)。
- 关窗时 Go 发出携带 `token` 的 `workspace:save-before-close` 事件并阻止关闭；前端保存后调用 `FinishClose(token, saved)`。保存失败时由 Go 弹出确认框，只有用户明确选择放弃才关窗；页面无响应时最多等待 5 秒。
- `watch` 插件在启动时注册，`Options.Resolve` 在每次 watch 时读取当前工作区根，根名带 `generation`；旧代的根名不再授权。变更通过插件的 Channel 交给页面。工作区状态本身是可替换的单例，图片协议 handler 在启动时注册、运行时读取同一个状态（见[工作区与文件](specs/workspace.md#工作区接口)）。
- 搜索通过 Channel 流式返回结果（见[工作区与文件](specs/workspace.md#搜索)）。
- `Assets` 提供 `PasteImage(docPath, generation)` 和 `ImportImages(docPath, generation, sources)`，返回保存后的工作区相对路径和 Markdown。参数只有文档路径、`generation` 和拖入文件的绝对路径；图片字节由 Go 读取，不经过 IPC（见[工作区与文件](specs/workspace.md#图片)）。
- 文件拖放的绝对路径由 MyGo 的 `mygo:file-drop` 页面事件提供，DOM 拖放事件本身没有路径。`src/services/assets.ts` 只封装该事件，把路径交给 `Assets.ImportImages`。

各接口的具体语义、错误传播和背压行为见 [MyGo 参考](references/mygo.md#绑定与-ipc)。

## 安全

根据 MyGo 的[页面信任模型](references/mygo.md#页面信任模型)，从自定义协议加载的页面是受信任的，可以直接调用 Go 方法。Markdown 里的原始 HTML 如果直接渲染，就能调用这些方法去读写文件。

因此：

- 渲染出来的 HTML 一律先经过 DOMPurify 清洗。
- 沙箱 iframe 可能会额外起进程，尽量不用。
- Go 的文件服务限制见[工作区与文件](specs/workspace.md#路径守卫)。
- 图片协议只映射当前工作区，handler 在启动时注册，运行时读取可替换的工作区状态。
- 图片协议的 URL 带 `generation`，切换文件夹后旧请求返回 404，不会读到新工作区里的同名文件。
- 协议只接受 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg`，只接受 GET 和 HEAD；路径经过与文件读写相同的检查并用 `os.Root` 打开，越界、隐藏目录、`node_modules`、符号链接逃逸和目录都返回 404。
- 响应显式设置 `Content-Type` 和 `X-Content-Type-Options: nosniff`，不会把伪装成图片的 HTML 当页面执行。
- **SVG**：SVG 可能内嵌脚本。页面只用 `<img>` 加载图片，从不导航到协议 URL；协议响应同时设置 `Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; sandbox`，即使直接打开 SVG，脚本也不会执行，外部资源和内嵌对象也不会加载。因此允许显示工作区里的 SVG，但禁止它成为可执行页面。

## 主要风险

| 风险 | 应对 |
|---|---|
| 中文输入法在 macOS WKWebView 里的表现 | 技术验证第一周就测；拼音输入过程中不能重建当前行的渲染，见[中文输入法](specs/editor-modes.md#中文输入法)。 |
| MyGo 的 API 可能变化 | MyGo 仍处于 0.x（当前锁定 0.7.3，见[参考](references/mygo.md)）；锁定版本，并把所有调用集中在 `src/services/` 和 `main.go`。 |
| 沉浸模式的边界情况多 | 先把实时预览做好，再逐步补齐沉浸模式，见[编辑模式](specs/editor-modes.md)。 |
| Linux 的 WebKitGTK 能力较弱 | 平台优先级排在最后，见[平台优先级](specs/product.md#平台优先级)。 |
