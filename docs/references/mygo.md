# MyGo 参考

概要：记录 MyGo 0.7.3 的已知行为、工具链和版本状态，供[架构](../architecture.md)和[工作区](../specs/workspace.md)引用。

- 官网：<https://mygo.egoist.dev>
- 仓库：<https://github.com/egoist/mygo>
- 来源：MyGo 官方文档与 `mygo init` 实际生成的脚手架
- 核对日期：2026-11-01（MyGo 0.7.3）
- 状态：仍是 0.x 版本，尚未发布 1.0。

## 版本与工具链

- Go 模块 `github.com/egoist/mygo` 的版本是 `v0.7.3`（2026-10-29 的 tag）。
- npm 包 `mygo-cli` 和 `mygo-runtime` 都是 `0.7.3`。
- `v0.7.3` 的 `go.mod` 要求 Go 1.27.3 以上。官网只写 Go 1.27+；用旧版 Go 运行 CLI 时，`GOTOOLCHAIN=auto` 会自动切换到 1.27.3。
- 项目要把版本固定在 `go.mod`、`package.json` 和 `bun.lock` 里，不要依赖 `@latest`。

## 运行模式

Web 模式下，界面运行在系统 WebView 里（macOS WKWebView、Windows WebView2、Linux WebKitGTK），后端逻辑用 Go 编写。

开发时，`devUrl` 指向 Vite 开发服务器，可以热更新；打包后页面从 `mygo://localhost/` 加载。

## 绑定与 IPC

- 用 `mygo.Bind(svc)` 暴露服务后，所有导出方法都能被调用。
- 方法第一个参数可以是 `context.Context`，页面关闭时会被取消。
- 返回 error 时，前端的 Promise 会以 `CallError` 拒绝。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；默认是 `src/mygo.ts`，本项目改为 `src/services/mygo.ts`。
- `*mygo.Channel[T]` 用于流式推送；页面未读数据超过 1MiB 时，Go 端的 `Send` 会等待。
- `mygo.NewEvent[T]` 用来从 Go 向页面发事件（`Emit` / `Broadcast`）。

生成的服务示例：

```go
type Application struct{ version string }

func (app Application) Info() AppInfo { /* ... */ }

func main() {
	mygo.Bind(NewApplication(mygo.App.Version()))
	// ...
}
```

前端得到命名空间对象：

```ts
import { Application } from "./services/mygo";

const info = await Application.info();
```

## 页面信任模型

从自定义协议加载的页面被视为受信任的，可以直接调用 Go 方法。

## Documents API

Documents API 采用“一个文件一个窗口”的模式。

## 插件

可用插件包括：watch、sqlite（不依赖 cgo）、updater、automation 等。

其中 `watch` 插件默认防抖 50ms，支持递归。

## 脚手架

```sh
GOTOOLCHAIN=auto go run github.com/egoist/mygo/cmd/mygo@v0.7.3 init <name>
# 或
bunx mygo-cli@0.7.3 init <name>
```

`mygo init` 实际生成（0.7.3，Web 模板）：

- `main.go`、`go.mod`、`go.sum`。
- `mygo.config.ts`：应用名、slug、identifier、version、`devUrl`、`devCommand`、`buildCommand`、`frontendDist`、`bindings`、`out` 等字段。
- `package.json`：`dev`（`mygo dev`）、`build`（`mygo build`）、`generate`、`dev:web`、`build:web`；依赖 `mygo-runtime`、`mygo-cli`、Vite 8 和 TypeScript。
- `index.html`、`src/main.ts`、`src/style.css`、生成的客户端、`vite.config.ts`、`tsconfig.json`。
- `resources/icon.png`。
- `.agents/skills/mygo-maintenance/`：随 CLI 版本提供的维护说明；本项目不提交该目录，需要时用 `bunx mygo-cli install-skills` 重新生成。
- `.gitignore`：包含 `node_modules/`、`/dist/`、`/build/`、`/.mygo/` 和 `mygo_windows_*.syso`。

初始化时用 bun 安装依赖。0.7.3 模板安装的是 Vite 8.3.x、TypeScript 7.0.x、`mygo-cli` / `mygo-runtime` 0.7.3。

## 开发与构建

- `mygo dev` 生成 TypeScript 客户端，运行 `devCommand`，等待 `devUrl` 可访问，然后构建并启动开发版应用。项目里通过 `bun run dev` 调用；在项目外可以用 `bunx mygo-cli dev`。
- 前端改动由 Vite 热更新；Go 代码、配置、图标或资源改动会重新构建并重启应用，编译失败时保留上一个运行版本。
- 开发版应用名为 `<name> Dev`，identifier 为 `<identifier>.dev`。macOS 上是 `.mygo/dev/<name> Dev.app`。
- `mygo build` 先运行 `buildCommand`，再把 `frontendDist` 嵌入 Go 程序，输出到 `build/<os>-<arch>/`。macOS 生成 `.app` 和 dmg；`-skip-dmg` 可只保留 `.app`。
- `bunx mygo doctor` 检查开发机环境。
