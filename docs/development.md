# 开发

概要：

- 环境要求、依赖安装和常用命令。
- 开发时由 `mygo dev` 同时运行 Vite 和桌面应用，前端改动走 Vite 热更新。
- 构建产物在 `build/<os>-<arch>/`；发布与自动更新见[发布与自动更新](release.md)。

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

应用名、identifier 和版本在 `mygo.config.ts` 中维护。`mygo build` 默认只构建本机平台；三个目标可以一次交叉构建：

```sh
GOTOOLCHAIN=auto bun run build -- -platform darwin/universal,windows/amd64,linux/amd64
```

macOS 的签名、通用二进制合成和 DMG 需要 macOS；Windows 安装包需要 `makensis`（本机没有时只跳过安装包并告警，产物仍有 EXE），Linux 的 `.deb` 和 `.tar.gz` 不需要额外工具。发布构建由标签触发，见[发布与自动更新](release.md)。

## 打包与自动更新

`mygo.config.ts` 的 `updates` 决定构建是否嵌入更新源。本地命令与结果：

| 命令 | 本地结果 |
|---|---|
| `bun run dev` | 构建开发版，不嵌入更新配置 |
| `bun run build`（无 `MYGO_UPDATER_PRIVATE_KEY`） | 告警 “Not signing an update”；macOS/Windows 不生成更新归档与清单 |
| `MYGO_UPDATER_PRIVATE_KEY=<私钥> bun run build` | 生成签名归档与 `update-*.json` |
| `MYGO_UPDATER_PRIVATE_KEY=… bun run build -- -upload` | 同上，并上传到对应 Release |
| `NICOLE_DISABLE_UPDATES=1 bun run build` | 不嵌入更新配置，不生成更新文件 |

- 私钥只从环境变量读取，不写进仓库；本地演练用一次性测试密钥对，见[下文](#自动更新的本地演练)。
- 不带私钥的构建不要当作可发布版本；发布流程见[发布与自动更新](release.md)。
- 完全关闭更新用 `NICOLE_DISABLE_UPDATES=1`，Package workflow 即如此。
- 版本与渠道只在发布时注入：`NICOLE_RELEASE_VERSION` 与 `NICOLE_RELEASE_TAG_PREFIX` 由 Release workflow 从标签写入，本地不需要设置（默认 `0.0.1` / `v`）。两个变量必须同时设置。配置通过环境变量取值，不在检出目录写过程文件，Go 的 VCS 戳记因此保持干净。
- 无/有私钥时更新文件的差异、差量、清单上传顺序和 `Enabled()` 的条件见 [MyGo 参考](references/mygo.md#自动更新)。

### 打包 workflow

`.github/workflows/package.yml`（Package）只能用 `workflow_dispatch` 手动触发，合并到 `main` 后在 Actions 页运行；PR 不打包，轻量检查见[上节](#ci)。它有三个 job：

- `macos-latest` 构建 `darwin/universal`，校验 `.app`、DMG、ad-hoc 签名和 Info.plist 版本，上传 DMG。
- `ubuntu-latest` 先 `apt install nsis p7zip-full`，再构建 `windows/amd64`，校验 EXE 与安装包确实生成，上传 NSIS 安装包。
- `ubuntu-latest` 构建 `linux/amd64`，校验 `.deb` 的版本字段与 `.tar.gz`、`install.sh`，上传 Debian 包、归档和安装脚本。

三个 job 都在构建前设置 `NICOLE_DISABLE_UPDATES=1`，并检查 `mygo.config.ts` 求值后没有 `updates`；校验步骤还会确认构建出的可执行文件不含更新源地址（`<仓库>/releases`；Go 模块路径本身含仓库名，不能只查仓库名）。测试构建以提交 SHA 命名 artifact，不创建或发布 Release；正式发布见[发布与自动更新](release.md)。

### 自动更新的本地演练

用一次性测试密钥对演练构建端的签名链路，材料全部放在 `/tmp`，不进仓库；不要用正式私钥。

1. 生成一次性密钥并临时换上测试公钥：

   ```sh
   drill=$(mktemp -d)
   bunx mygo-cli keygen -o "$drill"
   cp mygo.config.ts "$drill/mygo.config.ts.orig"
   pub=$(cat "$drill/mygo-update.pub")
   python3 - "$pub" <<'PY'
   import pathlib, sys
   path = pathlib.Path("mygo.config.ts")
   path.write_text(path.read_text().replace(
       "JUV50KDgCfG2HqXbO0rr+Qrx6xzWTvX59BCg5gGHo+0=", sys.argv[1]))
   PY
   ```

2. 带测试私钥构建，确认产出签名归档与清单：

   ```sh
   MYGO_UPDATER_PRIVATE_KEY=$(cat "$drill/mygo-update.key") \
     NICOLE_RELEASE_VERSION=0.0.1 NICOLE_RELEASE_TAG_PREFIX=test-v \
     bun run build -- -platform darwin/universal -skip-dmg -o "$drill/with-key"
   ```

   检查输出目录 `$drill/with-key/darwin-universal/` 里的 `nicole-0.0.1-darwin-universal.tar.gz`、`update-darwin-universal.json`：清单的 `version` 为 `0.0.1`，`notes` 来自 `CHANGELOG.md` 的 `## 0.0.1` 小节，`url` 指向 `test-v0.0.1` 标签。

3. 恢复正式公钥，再验证无私钥时的行为：

   ```sh
   cp "$drill/mygo.config.ts.orig" mygo.config.ts
   git diff --exit-code mygo.config.ts
   bun run build -- -platform darwin/universal -skip-dmg -o "$drill/without-key"
   ```

   应只看到 “Not signing an update” 告警，输出目录没有更新归档和 `update-*.json`。

4. 清理：`rm -rf "$drill"`，并确认 `git status` 干净。开发版本地不嵌入更新配置；更新开关的判定见 [MyGo 参考](references/mygo.md#自动更新)。

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

工作流只有 `contents: read` 权限，所有 action 都用提交 SHA 固定版本。打包与发布由两个独立工作流承担：[`package.yml`](../.github/workflows/package.yml) 手动打测试安装包，[`release.yml`](../.github/workflows/release.yml) 由 `test-v*` / `v*` 标签触发发布，见[打包 workflow](#打包-workflow)与[发布与自动更新](release.md)。

## 目录与依赖边界

目录结构、依赖边界和主题切换约束见[架构](architecture.md#进程和模块结构)与[依赖边界](architecture.md#依赖边界)。字体见[主题与字体](specs/theming.md#字体)。
