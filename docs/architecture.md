# 架构

概要：

- 桌面外壳使用 MyGo Web 模式，前端是 Vue 3 + Vite + Tailwind CSS v4，编辑器是 CodeMirror 6。
- `editor/` 是纯 TypeScript 模块，不依赖 Vue 和 MyGo；MyGo 调用只出现在 `services/` 和 `main.go`。
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

MyGo 的接口与版本情况见 [MyGo 参考](references/mygo.md)。

## 进程和模块结构

```text
WebView
  Vue 外壳：文件树 / 标签页 / 大纲 / 命令面板 / 设置
  editor/（纯 TypeScript）
    core
    modes/（live | immersive | source）
    widgets/
    commands/
  services/（对生成的 mygo.ts 的薄封装）
        │
        │ MyGo 类型化 IPC（绑定方法 / Channel / Event）
        ▼
Go
  Workspace：文件树、原子写入、重命名并更新引用
  Assets：图片存到 assets/
  Search：通过 Channel 流式返回结果
  Settings：全局配置 + 工作区配置
  Export
  Recovery
  Protocol：只映射当前工作区
```

## 依赖边界

- `editor/` 是纯 TypeScript，不依赖 Vue，也不依赖 MyGo。它对外只暴露 `createEditor`。
- MyGo 调用只放在 `services/` 和 `main.go`，其他模块通过这两处间接使用后端能力。
- `services/` 是生成的 `mygo.ts` 客户端上的薄封装，不承载业务逻辑。
- `createEditor` 的接口为：

  ```ts
  createEditor({ mode, commands, resolveImage, onChange })
  ```

  | 参数 | 含义 |
  |---|---|
  | `mode` | 初始编辑模式 |
  | `commands` | 命令注册表（见 [Slash 命令](specs/slash-commands.md#命令注册表)） |
  | `resolveImage` | 图片地址解析 |
  | `onChange` | 内容变更回调 |

- 命令注册表只有一份，各入口共用，见 [Slash 命令](specs/slash-commands.md#命令注册表)。
- 编辑模式的设计和限制见[编辑模式](specs/editor-modes.md)。

## IPC 用法

- MyGo 提供类型化 IPC：绑定方法、`Channel` 和 `Event`。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定。
- 前端只通过生成的客户端和 `services/` 调用 Go；Go 用 `mygo.Bind` 暴露服务，用 `*mygo.Channel[T]` 推送流，用 `mygo.NewEvent[T]` 发送事件。
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
| 中文输入法在 macOS WKWebView 里的表现 | 技术验证第一周就测；拼音输入过程中不能重建当前位置的渲染，见[中文输入法](specs/editor-modes.md#中文输入法)。 |
| MyGo 的 API 可能变化 | MyGo 还没有正式版本（见[参考](references/mygo.md)）；锁定版本，并把所有调用集中在 `services/` 和 `main.go`。 |
| 沉浸模式的边界情况多 | 先把实时预览做好，再逐步补齐沉浸模式，见[编辑模式](specs/editor-modes.md)。 |
| Linux 的 WebKitGTK 能力较弱 | 平台优先级排在最后，见[平台优先级](specs/product.md#平台优先级)。 |
