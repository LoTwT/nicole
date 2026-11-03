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

## 数据隔离

应用的用户数据目录由 `userDataDir()` 决定：默认是 MyGo 的 `PathUserData`，即 macOS 的 `~/Library/Application Support/Nicole/`；设置 `NICOLE_USER_DATA_DIR`（必须是绝对路径）后完全使用该目录，不再读取或创建默认目录。窗口状态、`settings.json`、`tabs.json` 和 `recovery/` 都走这里，`configureUserDataPath()` 同时把 MyGo 的 `PathUserData` 指向同一目录，更新器状态等插件数据也一起隔离。

本地开发和测试按下面的方式使用临时目录，不要读写用户正在使用的 `~/Library/Application Support/Nicole/`：

| 场景 | 用法 |
|---|---|
| `go test` | 无需设置。`TestMain` 为整次测试创建 `nicole-test-user-data-*` 临时目录并通过 `NICOLE_USER_DATA_DIR` 指过去，结束后删除。 |
| `mygo dev` | 开发版的应用名是 `Nicole Dev`，已与安装版分开；仍建议使用独立目录：`NICOLE_USER_DATA_DIR=$(mktemp -d) GOTOOLCHAIN=auto bun run dev`。 |
| 直接运行构建出的 `.app` | `NICOLE_USER_DATA_DIR=$(mktemp -d) ./build/darwin-arm64/Nicole.app/Contents/MacOS/Nicole`；不要从 `/Applications` 启动正在使用的 Nicole。 |
| 用 Launch Services 测试“打开方式” | `open --env NICOLE_USER_DATA_DIR="$(mktemp -d)" -a "$PWD/build/darwin-arm64/Nicole.app" --args`，或 `open --env ... -a ... /tmp/note.md`。 |
| 内存测量 | `scripts/measure-memory.sh` 默认使用临时目录并自动清理；需要保留数据时传 `--user-data-dir /absolute/path`。 |

单实例锁按应用名和 `NICOLE_USER_DATA_DIR` 的短哈希区分：同一个数据目录只允许一个实例，第二个实例把命令行文件和激活请求交给第一个实例，再退出；不同数据目录可以同时运行，适合并存安装版和隔离测试版。锁只影响进程，不会改变用户看到的窗口或设置。

`mygo.App.Path(PathUserData)` 的副作用是创建目录。`mygo generate`、`mygo dev` 和 `mygo build` 会把应用编译成临时二进制 `Nicole-<pid>` 并以 `MYGO_GENERATE` 运行来生成 TypeScript 客户端；这段启动流程曾在检查生成模式之前初始化设置和窗口状态，于是 `PathUserData` 按临时二进制名创建了真实的 `~/Library/Application Support/Nicole-<pid>/`。这些目录都是空的，时间与本地生成/构建/测试运行一致。`startupSettingsStore` 和 `startupWindowStateStore` 现在在 `MYGO_GENERATE` 下使用不会被读写的临时路径，因此 `mygo generate` 和 `mygo build` 不再创建这些目录。测试另外由 `TestMain` 指向临时目录；测试只读地对比 `~/Library/Application Support/` 下的条目即可确认没有新增或修改。

## 测试与检查

```sh
bun run typecheck   # vue-tsc --noEmit
bun run test        # Vitest（jsdom）
gofmt -l .          # 应无输出
GOTOOLCHAIN=auto go vet ./...
GOTOOLCHAIN=auto go test ./...
```

Vitest 覆盖三种模式的切换；挂载 `App.vue` 后切换亮暗主题，编辑器 DOM、选区和撤销历史保持不变；沉浸模式的 `Mod-b` 加粗；应用命令（如 `Mod-i`）优先于 `basicSetup` 默认键位；命令注册表的键位分平台显示、格式/段落命令和 `Prec.highest` 覆盖、应用与文件树命令由注册表分发、CodeMirror 键名匹配（字符优先、ASCII 字符不按物理字母回退，⇧⌘[/⇧⌘] 与非 US 布局可回退，Windows/Linux 键位，`available: false` 跳过）、文件树重命名框内按键与组合输入不分发、对话框打开时应用快捷键不分发、窄窗口浮出侧栏在对话框打开期间保持打开且取消后焦点回到发起按钮、编辑器宿主把 CodeMirror 的层叠上下文限制在编辑区内、悬停提示和右键菜单快捷键与注册表一致、注册表覆盖 ui.md 快捷键表的已实现行、slash 菜单的 `/` 与 `、` 触发、选区替换、拼音与最近使用排序、无匹配关闭并保留文字、执行后删除查询、翻转定位、组合输入期间的按键归属、切换标签时销毁旧控制器、外部载入磁盘内容时关闭菜单；命令面板的三种模式与独立模式标识、文件和标题拼音筛选、最近文件排序与上限、组合输入按键归属、`combobox`/`listbox`/活动项、Tab 焦点陷阱、Esc 焦点恢复、打开面板前选区保留、pinyin 命令执行与最近命令、⌘P/⇧⌘P/⇧⌘O 快捷键、文件列表复用已打开标签、标题跳转、slash/模式菜单关闭；面板内 ⌘P/⇧⌘P/⇧⌘O 切换模式并保留查询、空查询输入或粘贴 `>`/`@` 切换模式且不留下字符、空查询 Backspace 返回文件模式、模式切换写入 `aria-live` 状态区域（打开不写入、同一模式重复写入、播报延迟内连续切换只写入最后一次）、点击面板空白保持焦点、输入框不带共享焦点环、首次进入标题模式才提取并缓存标题、标题语法树超时提示、多行 Setext 合并、最近文件删除与改名清理、模态对话框与恢复对话框打开时不打开面板、外部文档变化关闭面板与执行前文档版本校验；`localStorage` 主题迁移和 `app:open-file` 事件接收；多标签模型与视图分离（后台标签页没有 `EditorView`、DOM 只有一个 `.cm-editor`）、切回恢复选区/滚动/撤销、保存写到模型自己的路径、关闭与批量关闭确认、按根目录记住和恢复标签与最近文件、单文件标签页、重命名同步、后台标签页的外部修改和删除、15 个标签的标签栏、同名区分、标签命令键位和标签栏键盘操作；装订册布局、文件树按需读取与键盘导航、右键菜单调用、状态栏和横幅优先级、外部修改与图片 `create` 事件的区分、文件夹切换的防重入和取消保护、对话框焦点陷阱；崩溃恢复的列表、全部恢复/逐个查看/全部丢弃、Esc 等同逐个查看、恢复到磁盘未变/已更改/缺失三种状态、单文件恢复、副本计时不随按键重置、字数口径和时间格式、对话框打开期间磁盘变化后的重新判定、未确认基线、改名后的副本迁移、关窗等待副本操作、打开文件转交延后、其他标签在对话框期间继续自动保存、重新列表失败不按旧快照写回、审阅编辑后按实际磁盘文本决定保留、等待重新列表期间的 watcher 更新和不可恢复副本不写盘、副本去重包含未确认基线；图片 URL 的解析，粘贴、拖入 token 链路，插入凭据的位置映射、组合输入排队和撤销步；`src/services/` 的薄封装。Go 测试覆盖绑定服务、文件树和排除规则、文件操作的路径守卫与 generation、监听自写过滤、单文件授权与显示、设置存储、标签页布局存储的根目录校验、最近文件校验与清理、恢复副本的路径授权与 generation、`diskState` 判定、未确认基线不记录哈希、单文件恢复的安全复核和一次性授权、父目录符号链接、单文件读盘失败不可恢复、JSON 字节上限与 HTML 字面写入、8MB/64MB 上限与替换豁免、损坏文件备份与配额排除、损坏备份按时间保留最新 20 个且不影响有效副本、文件名和内容 id 一致、磁盘哈希在切换根目录时保留仍打开的单文件、测试数据隔离、图片协议的路径守卫与 Content-Type、drop token 的一次性和过期、图片保存的文件名、并发写入与原子失败。

### 内存测量

```sh
GOTOOLCHAIN=auto bun run build -- -skip-dmg
scripts/measure-memory.sh --budget 120
```

脚本通过 `open -n --env NICOLE_USER_DATA_DIR=...` 启动被测 `.app`，默认临时目录并清理；`--user-data-dir` 可以指定保留的绝对路径。窗口状态因此从默认尺寸开始，不读取安装版的设置或窗口状态。

测量约定见[性能预算与测量](specs/performance.md#测量方法)。

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

## 第三方声明

界面图标内联自 Lucide 1.66.0，运行时没有新增图标依赖。Lucide 的 ISC 许可、Feather 来源图标的 MIT 许可以及本项目使用的图标清单见根目录的 [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)。修改图标或升级 Lucide 时同步更新该声明和 `src/components/AppIcon.vue` 的版本注释。

手写的 Lucide/Feather 声明和生成的运行时许可文本都登记在 `mygo.config.ts` 的 `resources` 中，由 MyGo 0.7.3 复制进每个平台的产物：

| 平台 | 产物中的位置 |
|---|---|
| macOS | `Nicole.app/Contents/Resources/THIRD-PARTY-NOTICES.md`、`THIRD-PARTY-LICENSES.md`，DMG 内相同 |
| Windows | `Nicole.exe` 同级的两个声明文件，NSIS 安装包携带整个安装目录 |
| Linux | `/opt/nicole/` 下的两个声明文件（`.deb`），`.tar.gz` 解压目录顶层 |

运行时依赖的许可文本由 `bun run licenses` 生成到根目录的 `THIRD-PARTY-LICENSES.md`，不要手改。脚本先运行 `bun run build:web`，用 Vite 的 `build.license` 读取实际进入 bundle 的模块及其许可；再遍历 `darwin/arm64`、`darwin/amd64`、`windows/amd64`、`linux/amd64` 的 `go list -deps` 结果，从模块缓存拼接每个模块根目录的 `LICENSE`、`NOTICE` 或 `PATENTS`，并加入 `$(go env GOROOT)` 下的 Go 标准库许可。`@ayingott/theme` 与 `tailwindcss` 只贡献 CSS，Vite 注入的 modulepreload helper 也不在模块扫描结果里，脚本会额外读取 `@ayingott/theme`、`tailwindcss` 和 `vite` 的许可文件。

新增、删除或升级前端生产依赖、Go 模块或 Go 工具链后，运行 `GOTOOLCHAIN=auto bun run licenses` 并提交生成的 `THIRD-PARTY-LICENSES.md`。CI 在 `ubuntu-latest` 上重新生成后执行 `git diff --exit-code`，生成结果过期会使检查失败；生成脚本覆盖三个发布平台的 Go 模块并集，结果不依赖运行平台。当前生成文件覆盖前端 bundle 中的 Vue、CodeMirror/Lezer、`mygo-runtime`、`pinyin-pro`、`style-mod`、`w3c-keyname`、`crelt`、`@marijn/find-cluster-break`、`@ayingott/theme`、Tailwind CSS 与 Vite（含其自带依赖声明），以及 Go 二进制中的 MyGo、`purego`、`golang.org/x/text`、Windows 上的 `golang.org/x/net` 和 Go 标准库；具体版本以生成文件为准。

`package.yml` 和 `release.yml` 在各自平台校验两个声明文件存在且与仓库内容一致；`release.yml` 还核对三个平台的更新归档，Linux 的 `.deb` 和 Windows 的 NSIS 安装包也会检查文件是否装入。不要把声明移出仓库根目录，或只在打包时临时生成而不提交；CI 校验的是仓库内的文件，缺失或过期都会失败。引入 `@ayingott/theme/fonts.css` 时，字体文件带有 OFL-1.1；当前 `dist/` 不含字体，若改为引入，需要把 OFL-1.1 文本加入声明或扩展生成脚本。
