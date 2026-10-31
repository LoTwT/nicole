# 开发

概要：

- 环境要求、依赖安装和常用命令。
- 开发时由 `mygo dev` 同时运行 Vite 和桌面应用，前端改动走 Vite 热更新。
- 构建产物在 `build/<os>-<arch>/`，CI 只做检查，不打包或发布。

## 环境要求

| 工具 | 要求 | 说明 |
|---|---|---|
| Go | 1.27.3 以上 | `go.mod` 要求 1.27.3；本机 1.27.2 时用 `GOTOOLCHAIN=auto` 自动下载。 |
| Bun | 1.4.4 | 管理前端依赖并运行 Vite、Vitest。 |
| MyGo | 0.7.3 | 由 `go.mod` 的 `github.com/egoist/mygo` 和 `package.json` 的 `mygo-cli` / `mygo-runtime` 精确锁定为 `0.7.3`。 |
| WebView | 系统自带 | macOS 12+ 使用 WKWebView；Windows 10/11 需要 WebView2 Runtime；Linux 需要 GTK 3 和 WebKitGTK 4.1。 |

`bunx mygo doctor` 可以检查开发机是否满足要求。

## 安装依赖

```sh
bun install
```

TypeScript 固定为 5.9.x。MyGo 模板默认安装 TypeScript 7，但 `vue-tsc` 3.3.14 仍需要 `typescript/lib/tsc` 入口，TypeScript 7 不再提供；升级前先确认 `vue-tsc` 已支持。

MyGo 生成的 TypeScript 客户端放在 `src/services/mygo.ts`，由 `mygo.config.ts` 的 `bindings` 指定。修改 Go 服务后重新生成：

```sh
GOTOOLCHAIN=auto bun run generate
```

`mygo dev` 和 `mygo build` 也会自动生成客户端。

## 开发

```sh
GOTOOLCHAIN=auto bun run dev
```

这个命令等价于 `mygo dev`：

1. 生成 TypeScript 客户端。
2. 启动 `devCommand`，也就是 Vite 开发服务器（默认 `http://localhost:5173`）。
3. 构建并启动 `Nicole Dev`。macOS 上是 `.mygo/dev/Nicole Dev.app`，identifier 为 `me.eruoo.nicole.dev`，与安装版的数据隔离。
4. 修改 `src/` 下的前端文件时由 Vite 热更新页面；修改 Go 代码、`mygo.config.ts`、图标或资源时重新构建并重启应用。编译失败会保留上一个可运行的版本。

在终端里按 `r` 重新构建并重启，按 `q` 退出。只调试前端、且已经单独运行 Vite 时，可以给 `mygo dev` 加 `-skip-dev-command`。

只运行 `bun run dev:web` 也能打开 Vite 页面，但没有 Go 后端，界面底部会显示“Go 服务未连接”。

## 构建

```sh
GOTOOLCHAIN=auto bun run build
```

`mygo build` 会先执行 `buildCommand`（类型检查加 Vite 构建），再把前端嵌入 Go 程序，输出到：

```text
build/darwin-arm64/Nicole.app
```

默认还会生成 dmg；只验证 `.app` 时可以跳过：

```sh
GOTOOLCHAIN=auto bun run build -- -skip-dmg
```

应用名、identifier 和版本在 `mygo.config.ts` 中维护。打包、签名、发布和自动更新不在当前 CI 范围内。

## 测试与检查

```sh
bun run typecheck   # vue-tsc --noEmit
bun run test        # Vitest（jsdom）
gofmt -l .          # 应无输出
GOTOOLCHAIN=auto go vet ./...
GOTOOLCHAIN=auto go test ./...
```

Vitest 覆盖三种模式的切换；挂载 `App.vue` 后切换亮暗主题，编辑器 DOM、选区和撤销历史保持不变；沉浸模式的 `Mod-b` 加粗；应用命令（如 `Mod-i`）优先于 `basicSetup` 默认键位。Go 测试覆盖绑定服务。

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 PR 和 push 到 `main` 时运行，使用 `macos-latest`、`windows-latest`、`ubuntu-latest` 三个平台，依次执行：

- 安装 Bun 依赖（`bun install --frozen-lockfile`）
- `bun run typecheck`
- `bun run test`
- `gofmt` 检查
- `go vet ./...`
- `go test ./...`

工作流只有 `contents: read` 权限，所有 action 都用提交 SHA 固定版本。打包、发布和自动更新属于后续工作流。

## 目录与依赖边界

目录结构、依赖边界和主题切换约束见[架构](architecture.md#进程和模块结构)与[依赖边界](architecture.md#依赖边界)。字体见[主题与字体](specs/theming.md#字体)。
