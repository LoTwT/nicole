# MyGo 参考

概要：记录 MyGo 在 2026-10 的已知行为、工具链和版本状态，供[架构](../architecture.md)和[工作区](../specs/workspace.md)引用。

- 官网：<https://mygo.egoist.dev>
- 仓库：<https://github.com/egoist/mygo>
- 核对日期：2026-10
- 状态：**还没有正式版本**。

## 运行模式

Web 模式下，界面运行在系统 WebView 里（macOS WKWebView、Windows WebView2、Linux WebKitGTK），后端逻辑用 Go 编写。

开发时，`devUrl` 指向 Vite 开发服务器，可以热更新；打包后页面从 `mygo://localhost/` 加载。

## 绑定与 IPC

- 用 `mygo.Bind(svc)` 暴露服务后，所有导出方法都能被调用。
- 方法第一个参数可以是 `context.Context`，页面关闭时会被取消。
- 返回 error 时，前端的 Promise 会以 `CallError` 拒绝。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定。
- `*mygo.Channel[T]` 用于流式推送；页面未读数据超过 1MiB 时，Go 端的 `Send` 会等待。
- `mygo.NewEvent[T]` 用来从 Go 向页面发事件（`Emit` / `Broadcast`）。

## 页面信任模型

从自定义协议加载的页面被视为受信任的，可以直接调用 Go 方法。

## Documents API

Documents API 采用“一个文件一个窗口”的模式。

## 插件

可用插件包括：watch、sqlite（不依赖 cgo）、updater、automation 等。

其中 `watch` 插件默认防抖 50ms，支持递归。

## 脚手架

```sh
go run github.com/egoist/mygo/cmd/mygo@latest init <name>
```

- 用 bun 管理依赖。
- 默认模板是 Vite 8 + TypeScript。
- `mygo-cli` / `mygo-runtime` 版本为 0.7.3。

## 版本状态

截至核对日期，MyGo 还没有正式版本。
