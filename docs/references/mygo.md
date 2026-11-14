# MyGo 参考

概要：记录 MyGo 0.9.0 的已知行为、工具链和版本状态，供[架构](../architecture.md)和[工作区](../specs/workspace.md)引用。

- 官网：<https://mygo.egoist.dev>
- 仓库：<https://github.com/egoist/mygo>
- 来源：MyGo 官方文档与 `mygo init` 实际生成的脚手架
- 核对日期：2026-11-14（MyGo 0.9.0）
- 状态：仍是 0.x 版本，尚未发布 1.0。

## 版本与工具链

- 2026-11-14 从 Go proxy 的 `@latest`、npm registry 的 `latest` 和 GitHub 最新 Release 核对：`github.com/egoist/mygo` 的稳定版是 `v0.9.0`（2026-11-11 的 tag），`mygo-cli` 与 `mygo-runtime` 都是 `0.9.0`。
- `v0.9.0` 的 `go.mod` 要求 Go 1.27.3 以上。官网只写 Go 1.27+；用旧版 Go 运行 CLI 时，`GOTOOLCHAIN=auto` 会自动切换到 1.27.3。
- 项目要把版本固定在 `go.mod`、`package.json` 和 `bun.lock` 里，不要依赖 `@latest`。

## 从 0.7.3 升级到 0.9.0 的实际影响

- 0.8.0 的破坏性变化集中在 native UI 的输入事件与指针行为；Nicole 只用 Web 模式，不涉及这些 API。
- 0.8.0 起 `mygo build` 不再把 `resources/` 里的 Go 源码打进产物，并调整了资源目录中点文件的规则。Nicole 的 `resources` 只列出两个 Markdown 声明文件，`resources/` 里只有图标，因此产物不变。
- 0.8.3 起，生成的 TypeScript 类型如果名为 `Record` 或 `Promise`，会加上包名前缀；0.8.1 修复了名为 `call` 的参数。重新生成后 `src/services/mygo.ts` 没有变化，Nicole 不使用这些名字。
- 0.9.0 移除了 `sqlite.LibraryPath` 和 `MYGO_SQLITE_LIBRARY`，SQLite 改由 native module 加载（`MYGO_NATIVE_SQLITECORE`）；Nicole 不使用 `plugins/sqlite`，迁移不需要改代码。
- 0.9.0 的 Linux 构建默认同时生成 Debian、RPM 和 PKGBUILD。Nicole 在 `mygo.config.ts` 用 `linux.formats: ["deb"]` 保持原有的 Debian 包与归档发布集，发布 workflow 的资产和 `SHA256SUMS` 检查不变。
- native modules、`mygo dev` 的 Apple Development 签名和 `-background` 等新能力本项目未使用；`mygo build`、更新清单格式和现有 URL 协议用法没有破坏性变更。

## 运行模式

Web 模式下，界面运行在系统 WebView 里（macOS WKWebView、Windows WebView2、Linux WebKitGTK），后端逻辑用 Go 编写。

开发时，`devUrl` 指向 Vite 开发服务器，可以热更新；打包后页面从 `mygo://localhost/` 加载。

## 语言与菜单

- 应用只显示一种语言。`mygo.App.SetLanguages(tags...)` 声明应用写成的语言，第一个是回退语言；`mygo.App.Locale()` 从中选出用户最常用的语言，没有匹配时用第一个。MyGo 的角色菜单标签、更新插件的 `updater.MenuItem()`、原生控件和页面都读取这个语言（`locale.go`、`menu.go` 的 `roleDefaults`）。
- 日文、简体中文和繁体中文的 MyGo 译文是三个独立包，应用必须空白导入才会链接：`import _ "github.com/egoist/mygo/locales/zh-Hans"`（`locales/zh-Hans/locale_gen.go`）。应用自己没有 `i18n` 目录时，默认只有英文。
- 菜单项在创建时取角色标签。`SetLanguages` 只把语言更新排到主线程；`App.Run` 之前创建菜单时，要先调用 `App.Locale()` 让语言在那之前确定，否则角色菜单会保留创建时的英文标签。`startLocale` 只在应用 ready 之后重命名角色项（`menu_text.go` 的 `relabelMenus`），所以应用自己设置过的标签和已经去掉角色的菜单项不会被改写。
- macOS 上 `SetLanguages` 不改变 AppKit/WKWebView 的界面语言（`internal/darwin/locale.go`）：系统的菜单项（例如“编辑”菜单里由系统追加的听写、表情与符号）和网页右键菜单的系统项，跟随应用包在启动时选定的本地化。bundle 要在 `Info.plist` 声明 `CFBundleDevelopmentRegion` 和 `CFBundleLocalizations`；MyGo 从应用的 `i18n` 目录生成这些键和 `.lproj`，也可以用 `macos.infoPlist` 补充。`App.SetLocale` 会写入应用级 `AppleLanguages`，AppKit/WebKit 从下次启动起跟随。
- Windows 的 `SetLanguages` 设置进程首选 UI 语言（`internal/windows/locale.go`），菜单和系统对话框在该语言有资源时显示它；WebView2 环境在第一个网页视图创建时取语言，之后不能改变。Linux 把语言交给 WebKitGTK（`internal/linux/locale.go`），GTK 菜单的布局方向随之确定。MyGo 自己的菜单文字在三个平台都由运行时译文决定。

## 绑定与 IPC

- 用 `mygo.Bind(svc)` 暴露服务后，所有导出方法都能被调用。
- 方法第一个参数可以是 `context.Context`，页面关闭时会被取消。
- 返回 error 时，前端的 Promise 会以 `CallError` 拒绝。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；默认是 `src/mygo.ts`，本项目改为 `src/services/mygo.ts`。
- `*mygo.Channel[T]` 用于流式推送；页面未读数据超过 1MiB 时，Go 端的 `Send` 会等待。
- `mygo.NewEvent[T]` 用来从 Go 向页面发事件（`Emit` / `Broadcast`）。
- 生成客户端时，同一服务的两个方法或两个事件映射到同名属性会直接报错，并指出两处声明；0.8.3 起名为 `Record` 或 `Promise` 的生成类型会带包名前缀。本项目重新生成后客户端没有变化。

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

## 协议、剪贴板与文件拖放

- `mygo.Protocol.Handle(scheme, handler)` 在创建窗口之前注册自定义协议。`<img>` 可以直接加载 `scheme://localhost/<path>`；处理器是在独立 goroutine 上运行的普通 `http.Handler`，支持流式响应。
- 自定义协议与页面不同源。MyGo 给本应用自己的页面加 CORS 头；在 Windows 上，WebView2 用 `http://<scheme>.localhost/` 提供自定义协议，MyGo 再映射回 `scheme://localhost/`。
- `mygo.Clipboard.ReadFormat(transfer.PNG)` 读取剪贴板里的图片。macOS 会把 TIFF、Windows 会把 DIB 等系统格式转换成 PNG；单个表示的上限是 64 MiB。0.9.0 起读取文本优先使用 UTF-8 表示，图片格式读取不变；`ClipboardOptions.Concealed` 可把写入标记为敏感内容，本项目未使用。
- 页面里的 DOM 拖放事件拿不到本地路径。MyGo 在页面收到带文件的 `drop` 后把路径通过 `mygo:file-drop` 事件发给页面（`mygo-runtime` 的 `onFileDrop`），Go 的 `Window.OnFileDrop` 也能收到同一组路径和坐标。页面阻止默认拖放不会阻止该事件。
- 自定义协议的页面被当作应用自己的受信任页面。`Page.OnWillNavigate` 在页面导航前触发，可以取消导航；`<img>` 等子资源加载不经过它。

## Documents API

Documents API 采用“一个文件一个窗口”的模式。

## 插件

可用插件包括：watch、sqlite、updater、automation 等。sqlite 在 0.9.0 通过 native module 加载，仍然不依赖 cgo；`sqlite.LibraryPath` 与 `MYGO_SQLITE_LIBRARY` 已移除，需要换库时用 `MYGO_NATIVE_SQLITECORE`。Nicole 不使用 sqlite。native modules 本身仍是实验性能力。

其中 `watch` 插件默认防抖 50ms，支持递归。

## 脚手架

```sh
GOTOOLCHAIN=auto go run github.com/egoist/mygo/cmd/mygo@v0.9.0 init <name>
# 或
bunx mygo-cli@0.9.0 init <name>
```

`mygo init` 实际生成（0.9.0，Web 模板）：

- `main.go`、`go.mod`、`go.sum`。
- `mygo.config.ts`：应用名、slug、identifier、version、`devUrl`、`devCommand`、`buildCommand`、`frontendDist`、`bindings`、`out` 等字段。
- `package.json`：`dev`（`mygo dev`）、`build`（`mygo build`）、`generate`、`dev:web`、`build:web`；依赖 `mygo-runtime`、`mygo-cli`、Vite 8 和 TypeScript。
- `index.html`、`src/main.ts`、`src/style.css`、生成的客户端、`vite.config.ts`、`tsconfig.json`。
- `resources/icon.png`。
- `.agents/skills/mygo-maintenance/`：随 CLI 版本提供的维护说明；本项目不提交该目录，需要时用 `bunx mygo-cli install-skills` 重新生成。
- `.gitignore`：包含 `node_modules/`、`/dist/`、`/build/`、`/.mygo/` 和 `mygo_windows_*.syso`。

初始化时用 bun 安装依赖。0.9.0 模板安装的是 Vite 8、TypeScript 7，`mygo-cli` / `mygo-runtime` 为 `^0.9.0`；模板的 `build:web` 用 `tsc --noEmit`。Nicole 因为使用 `vue-tsc` 仍保留 TypeScript 6，见[开发](../development.md#安装依赖)。

## 开发与构建

- `mygo dev` 生成 TypeScript 客户端，运行 `devCommand`，等待 `devUrl` 可访问，然后构建并启动开发版应用。项目里通过 `bun run dev` 调用；在项目外可以用 `bunx mygo-cli dev`。
- 前端改动由 Vite 热更新；Go 代码、配置、图标或资源改动会重新构建并重启应用，编译失败时保留上一个运行版本。
- 开发版应用名为 `<name> Dev`，identifier 为 `<identifier>.dev`。macOS 上是 `.mygo/dev/darwin-<arch>/<name> Dev.app`。
- `mygo build` 先运行 `buildCommand`，再把 `frontendDist` 嵌入 Go 程序，输出到 `build/<os>-<arch>/`。macOS 生成 `.app` 和 dmg；`-skip-dmg` 可只保留 `.app`。
- `bunx mygo doctor` 检查开发机环境。

以下分发与更新行为核对于 2026-11-14，依据 MyGo 0.9.0 的 `docs/distribution.md`、`docs/updates.md`、`docs/github-actions.md`、`docs/plugins/updater.md` 以及 `cmd/mygo`、`internal/update` 源码。

## 分发

- `mygo build -platform` 接受逗号分隔的 `GOOS/GOARCH`，默认本机。`darwin/universal` 用 `lipo` 合成 arm64 + amd64 的通用应用；macOS 的签名、DMG 制作需要 macOS，其他平台会跳过并警告。
- MyGo 本身不需要 cgo，因此 Windows 和 Linux 目标可以在 Ubuntu 上交叉构建。Windows 安装包用 NSIS：Windows 上缺 `makensis` 时自动下载，macOS/Linux 上需要自行安装（如 `apt install nsis`），否则只警告并跳过安装包；`-skip-installer` 可以明确不生成安装包，也不查找或下载 NSIS。
- 0.9.0 的产物名与 0.7.3 相同（`<slug>` 默认是应用名的小写连字符形式）：
  - macOS：`<slug>-<version>-<arch>.dmg`，`darwin/universal` 为 `<slug>-<version>.dmg`，以及签名后的 `.app`。
  - Windows：`<slug>-setup-<version>-<arch>.exe`（每用户安装到 `%LOCALAPPDATA%\Programs\<name>`），以及 `<name>.exe`。
  - Linux：`<slug>`、桌面入口与图标、`<slug>_<version>_<arch>.deb`（安装到 `/opt/<slug>`）和 `<slug>-<version>-linux-<arch>.tar.gz`；任何 Linux 构建都带 `install.sh`。0.9.0 默认还生成 RPM 和 PKGBUILD，Nicole 用 `linux.formats: ["deb"]` 保持原有产物集。
- `resources` 配置列出的文件与目录按基名复制进每个平台的资源目录：macOS 是 `Contents/Resources`，其他平台是可执行文件旁；Linux 的 `.deb` 把可执行文件旁的整套文件装到 `/opt/<slug>/`。项目 `resources/` 目录的 `resources/<goos>` 与 `resources/<goos>-<goarch>` 只进入对应平台。0.9.0 起 `resources/` 里的 Go 源码不会进入产物，资源目录内的点文件会保留，但隐藏目录和 `.DS_Store`、`Thumbs.db`、`desktop.ini` 不进入。
- macOS 默认 ad-hoc 签名；没有 Developer ID 时，在其他 Mac 上首次打开可能被 Gatekeeper 阻止。Windows 不配置 `windows.certificate` 时 EXE 与安装包都不签名，可能出现 SmartScreen 提示。详见[发布](../release.md#不依赖付费证书的分发路线)。
- 配置了 updates 时，macOS 构建还输出 `install.sh`；Windows 在生成安装包时输出 `install.ps1`。Linux 的 `install.sh` 始终输出。

## 自动更新

- `updates` 配置（`mygo.config.ts` 与 `mygo.json` 字段相同）：
  - `publicKey`：`mygo keygen` 生成的 `mygo-update.pub` 内容；`github`（`owner/name`）或 `url`（HTTPS 目录）二选一。
  - `tagPrefix`：默认 `v`。为 `v` 时应用读仓库 latest Release 的清单；其他前缀（如 `test-v`）时通过 GitHub API 找该前缀下最新的非草稿、非预发布 Release。
  - `privateKey`：签名私钥路径；`MYGO_UPDATER_PRIVATE_KEY` 环境变量优先。
  - `changelog`：默认 `CHANGELOG.md`；每个版本必须有对应小节，接受 `## <version>`、`## v<version>`、`## [<version>] - 日期` 等写法；缺失或正文为空时构建失败，小节文字进入清单的 `notes`。
  - `deltas`：默认 3，对之前已发布的版本生成 `.delta`；首版没有已发布版本时跳过并提示。
- 带私钥构建时，每个平台额外产出 `<slug>-<version>-<target>.tar.gz`（签名归档）、`update-<target>.json`（版本、说明、日期、归档/差量的 URL、大小、签名）和可选的差量文件。无私钥时只告警并跳过这些文件，**Linux 例外**：仍输出未签名的 `.tar.gz`（供 `install.sh` 手工安装）。
- `mygo build -upload` 需要私钥与 `updates.github`/`updates.s3`，缺私钥会在构建前失败；它上传安装包、归档、脚本和 `SHA256SUMS`，清单最后上传。上传目标是 `tagPrefix + version` 的 Release，不存在时自动创建草稿。
- `SHA256SUMS` 的格式是 `sha256sum` 的 `<sha256>  <name>`，按文件名排序；覆盖安装包、归档、差量与安装脚本，不含 `update-*.json`。`install.ps1` 按 `<64 位十六进制>  <名字>` 读取，GitHub 存储名中的空格会变成 `.`。
- `SHA256SUMS` 的跨平台合并是读取现有文件、合并、整体覆盖上传，没有加锁；多个平台并行上传时可能互相覆盖而丢行。发布流程需要在全部上传后按实际资产重新生成并核对，见[发布](../release.md)。
- 更新清单必须指向实际存在的归档；应用按平台读取自己的清单（`darwin-universal`、`windows-amd64`、`linux-amd64`）。0.9.0 起，如果 latest Release 没有当前平台的清单，构建会按同一 `tagPrefix` 继续查找更早的非草稿、非预发布 Release，以便分平台发布时仍能计算差量；应用侧仍只检查配置的更新源。
- 应用侧 `mygo.Updater.Enabled()` 要求构建时嵌入更新源与公钥、非开发运行、且安装位置可写：macOS 的 `.app`、Windows 每用户安装目录、Linux 的 `~/.local/<slug>.app` 满足；`.deb` 安装的系统目录不满足。
- Linux 的 `.deb` 安装到 `/opt/<slug>`，由包管理器升级，自动更新关闭；`install.sh` 安装到 `~/.local/<slug>.app`，可自动更新，并用 `updates.publicKey` 校验归档的 Ed25519 签名（需要 OpenSSL 3.0 及以上；旧版 OpenSSL 下只能手工下载归档再交给脚本安装）。
- Windows 更新器只替换安装目录里的文件，不写卸载注册表；NSIS 安装器只在安装时写 `DisplayVersion`，所以原地更新后“应用和功能”里的版本可能仍是旧值。需要应用自己刷新该值（0.9.0 仍没有内置行为）。0.9.0 起，Linux 和 Windows 的原地更新会按安装目录里的 `.mygo-files` 删除新版本不再提供的文件；旧版本构建没有该清单时首次更新不会删除任何文件。
- `updater.Plugin` 提供 Sparkle 风格更新窗口，启动约 10 秒后后台检查一次、之后每天一次；`updater.MenuItem()` 返回“检查更新…”菜单项。`mygo dev` 与未嵌入更新配置的构建不后台检查，手动检查会说明原因。0.9.0 新增 `updater.AvailableVersion()`（最近一次检查发现的新版本）和 `OnInstalled`（安装完成、重启前回调），并会在更新窗口打开期间发布新版本时重新提供，也会对短暂的服务器失败重试。

## GitHub Actions

- 官方推荐每个平台一个 runner；macOS 用 macOS runner（签名、公证、DMG），Windows/Linux 可在 Ubuntu 上构建。官方示例用 `-upload` 直接上传到草稿 Release；0.9.0 的示例资产还包含 `build/*/*.rpm`，Nicole 固定只生成 Debian 包，因此 workflow 不需要这一项。
- 版本号须与标签一致：官方建议版本取自 `package.json`/`mygo.json`，并在草稿 job 里先检查 `GITHUB_REF_NAME`；`mygo build -upload` 按 `tagPrefix + version` 找 Release，不看触发 workflow 的标签。
- 草稿 Release 应在构建前创建，三个平台上传到同一草稿；再次运行会复用草稿并覆盖同名文件（`--clobber`），失败平台可用 “Re-run failed jobs”。全部平台成功后，`gh release edit <tag> --draft=false` 发布。
- 使用 `tagPrefix` 时，测试/并行渠道发布用 `--latest=false`；正式 latest 渠道用 `--latest=true`。`GITHUB_TOKEN` 同时供 `gh` 上传和差量计算读取已发布 Release。
- 更新签名私钥放在仓库 secret `MYGO_UPDATER_PRIVATE_KEY`；Windows 代码签名与 Apple 公证需要各自的 secret，本项目首版不配置。

与 youkai（MyGo 0.6.2）不同、本项目按 0.9.0 处理的地方：

- 配置是 `mygo.config.ts`，渠道前缀与标签版本通过环境变量注入配置，不写文件；youkai 用 `mygo.json` 加 `jq` 改写并设 `skip-worktree`。
- 0.9.0 的安装包/归档名与 0.7.3 相同，不含空格（`nicole-setup-<version>-amd64.exe`、`nicole-<version>-darwin-universal.tar.gz`），youkai 的 0.6.2 名字带空格；GitHub 的“空格存成 `.`”规则仍然适用于发布 job 的资产校验。
- `darwin/universal` 的 DMG 名不带架构：`nicole-<version>.dmg`。
