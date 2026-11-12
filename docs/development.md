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

快捷键测试按测试声明的应用平台发送修饰键：macOS 只按 ⌘，Windows/Linux 只按 Ctrl，不读取运行测试的宿主平台；涉及 CodeMirror `Mod` 的测试在模块加载前固定 `navigator.platform`。

Vitest 覆盖三种模式的切换；挂载 `App.vue` 后切换亮暗主题，编辑器 DOM、选区和撤销历史保持不变；沉浸模式的 `Mod-b` 加粗；沉浸模式行首边界（标题、引用、无序/有序列表中的可见序号、任务项，嵌套/缩进/tab，←/⌥←/⌃←/Ctrl/Alt+←/⌃B/Home/点击/多光标/Shift，Enter/⇧Enter/⌃O 在块上方插行、Backspace/⌃H/⌥⌫）、1.5MB/6MB 恢复和程序化跳转的异步解析、goalColumn、模式切换/恢复和组合期间跳过、解析定时器清理和图片标记中点、解析截断后预览装饰补全（实时预览和沉浸模式）；编辑器选区变量在 Paper/Ink 下的实际层叠胜出规则且不使用 `!important`，Ink 选区回退为 `--color-lavender-900`；三种模式的代码块整块背景、无块内缝隙、背景层位于选区层之下、16px 外边距和引用起点、选区层同样裁剪、只装饰可见范围、解析推进后补齐且未解析到块尾不画底部圆角、组合输入期间只映射、行内代码和代码块内搜索匹配保留背景；任务框聚焦时裸空格与修饰空格的区分、主修饰键 F/G/A 与 ⇧G 的转发和 Windows/Linux 的 ⌃ 分支、非主修饰键与编辑事件的拦截、非折叠原生选区的清除且返回正文不重置滚动、`replaceDocument`/撤销移除聚焦任务框后的焦点恢复、窗口失焦期间移除后切回恢复、任务框仍连接时普通更新不抢焦点、其他控件和窗口失焦时不抢焦点、原生 Select All 菜单动作与 `selectstart` 的目标范围及监听器清理；应用命令（如 `Mod-i`）优先于 `basicSetup` 默认键位；命令注册表的键位分平台显示、格式/段落命令和 `Prec.highest` 覆盖、应用与文件树命令由注册表分发、CodeMirror 键名匹配（字符优先、ASCII 字符不按物理字母回退，⇧⌘[/⇧⌘] 与非 US 布局可回退，Windows/Linux 键位，`available: false` 跳过）、文件树重命名框内按键与组合输入不分发、对话框打开时应用快捷键不分发、窄窗口浮出侧栏在对话框打开期间保持打开且取消后焦点回到发起按钮、侧栏显隐时焦点按消失的控件移动（主题按钮互换、其余回到顶栏开关、浮层关闭回到打开前位置或顶栏开关、窗口宽度变化和浮层内命令面板关闭同理）、浮层关闭标记不残留（窗口变宽后按 Esc、同一 tick 关闭再打开）、鼠标按下开关不夺取焦点且焦点与选区留在编辑器、浮层内打开命令面板时焦点不经过顶栏开关、焦点不在消失的控件中时不动、浮出侧栏的实际定位不被基础规则覆盖、编辑器宿主把 CodeMirror 的层叠上下文限制在编辑区内、开始写作页主按钮不显示快捷键且悬停提示保留快捷键、快捷键一律为浅色纯文字且界面中没有 `kbd`、命令面板/slash 菜单/模式菜单的快捷键右对齐并从注册表读取、悬停提示和右键菜单快捷键与注册表一致、注册表覆盖 ui.md 快捷键表的已实现行、关闭工作区先保存再确认且取消不改界面、关闭后回到开始写作页并隐藏侧栏且焦点在“打开文件夹”、恢复副本删除先于关闭和切换文件夹、关闭/切换在恢复副本超时后取消、切换打开失败重启脏标签副本、关闭失败保留单文件授权并重启脏标签副本、恢复对话框或页面对话框打开时不处理文件夹 drop、`workspaceClosed` 阻止启动恢复、最近项打开失败只按 Go 的固定缺失目录错误标为“已不存在”、启动恢复的其他错误不标记且按钮保持可用、最近打开只显示 5 条、侧栏不可见时状态栏显示唯一可见的主题按钮（开始写作页、单文件标签页、宽窗口手动隐藏侧栏、窄窗口侧栏收起和浮层打开），窄窗口下按钮不挤压状态文字、保存状态和提示在右侧容器并右对齐、长提示截断且保留 title、主题切换可用、最近打开名称胶囊与同名后缀、名称在长后缀下仍可见、缺失项可点击重试且成功后清除标记、仍缺失或其他错误时保持标记、右上角移除角标悬停/聚焦样式且点击只移除、缺失项淡化不影响角标、移除按钮名称含后缀和缺失状态、移除后的焦点回退、标记缺失后焦点留在同一打开按钮、其他项变化不抢焦点、最近打开分行纯函数和 ResizeObserver 重新分行/卸载清理、宽度差异很大的分行、开始写作页拖入单个文件夹与拒绝多个或文件、slash 菜单的 `/` 与 `、` 触发、选区替换、拼音与最近使用排序、无匹配关闭并保留文字、执行后删除查询、翻转定位、组合输入期间的按键归属、切换标签时销毁旧控制器、外部载入磁盘内容时关闭菜单；命令面板的三种模式与独立模式标识、命令模式按注册表状态要求过滤（工作区、活动 Markdown、标签页数量和关闭历史）、文件和标题拼音筛选、最近文件排序与上限、组合输入按键归属、`combobox`/`listbox`/活动项、Tab 焦点陷阱、Esc 焦点恢复、打开面板前选区保留、pinyin 命令执行与最近命令、⌘P/⇧⌘P/⇧⌘O 快捷键、文件列表复用已打开标签、标题跳转、slash/模式菜单关闭；面板内 ⌘P/⇧⌘P/⇧⌘O 切换模式并保留查询、空查询输入或粘贴 `>`/`@` 切换模式且不留下字符、空查询 Backspace 返回文件模式、模式切换写入 `aria-live` 状态区域（打开不写入、同一模式重复写入、播报延迟内连续切换只写入最后一次）、点击面板空白保持焦点、输入框不带共享焦点环、首次进入标题模式才提取并缓存标题、标题语法树超时提示、多行 Setext 合并、最近文件删除与改名清理、模态对话框与恢复对话框打开时不打开面板、外部文档变化关闭面板与执行前文档版本校验；大纲的固定/浮动布局与内容区宽度阈值、全局开关记忆和启动晚到设置、窄布局临时开关不写盘、frontmatter 与单一文章 H1 排除、空标题占位、真实编辑器中的标题跳转（24px 顶部间距、行首光标和焦点）、可见顶部所在章节、300ms 防抖、组合输入暂停与恢复、部分解析提示与后续补齐、文档变化后旧标题位置失效、文档先变化、首次/重新挂载后由真实 CodeMirror Safari dead-key 分支稍后结束组合且无新编辑或 DOM 事件时的自行恢复、切标签/外部载入后的定时器和监听清理、模式菜单互斥、完整鼠标默认焦点时序下的空白点击焦点回退与新控件焦点保留、待处理焦点恢复在另一浮层/重新打开/卸载时取消、命令面板入口和 Windows Ctrl+Shift+L 优先于选中同词；`localStorage` 主题迁移和 `app:open-file` 事件接收；多标签模型与视图分离（后台标签页没有 `EditorView`、DOM 只有一个 `.cm-editor`）、切回恢复选区/滚动/撤销、保存写到模型自己的路径、输入法组合期间不自动保存且组合结束后重新计时、组合取消回原样不保存、其他标签不受组合影响、组合开始前已运行的计时器到点不写盘、排队或写入期间开始的组合在写盘前重查、排队保存被挡后仍恢复并重新计时、写前被挡保留失败状态、连续组合等到真正停顿、丢失 `compositionend` 后按视图销毁/失焦/普通按键恢复保存、失效标记按标签隔离、按鼠须管实测事件序列不写拼音、组合期间关闭/切换/隐藏仍保存组合文字、长时间组合继续更新恢复副本、保存失败与混合换行状态不被组合结束改变、审阅暂停标签保持暂停、关闭与批量关闭确认、按根目录记住和恢复标签与最近文件、单文件标签页、重命名同步、后台标签页的外部修改和删除、15 个标签的标签栏、同名区分、标签命令键位和标签栏键盘操作；装订册布局、文件树按需读取与键盘导航、空文件夹展开不显示占位提示且仍可新建、文件树 Paper 悬停色的单独变量与选中行不受悬停影响、次要按钮在主按钮/空状态/占位页/对话框中的共用类与两主题颜色、文件树/命令面板/slash 菜单的共用选中行及选中行 KeyHint 的次要文字色、Ink 主按钮的填充与文字对比度及 on-accent 焦点环、侧栏工具行的根目录新建、空白失焦不抢焦点、最后一项删除后的空状态焦点、全部折叠和更多菜单、空白处右键菜单保留根目录动作并增加关闭工作区、更多菜单复制工作区路径、移除根目录行后树层级不变、工具行角色为 group、全部折叠后的焦点回退、从工具行取消新建后焦点归还、树中始终有一个 Tab 停靠点、右键菜单调用、状态栏和横幅优先级、外部修改与图片 `create` 事件的区分、重新保存已删除文件后刷新文件树、文件夹切换的防重入和取消保护、对话框焦点陷阱；崩溃恢复的列表、全部恢复/逐个查看/全部丢弃、Esc 等同逐个查看、恢复到磁盘未变/已更改/缺失三种状态、单文件恢复、副本计时不随按键重置、字数口径和时间格式、对话框打开期间磁盘变化后的重新判定、未确认基线、改名后的副本迁移、关窗等待副本操作、打开文件转交延后、其他标签在对话框期间继续自动保存、重新列表失败不按旧快照写回、审阅编辑后按实际磁盘文本决定保留、等待重新列表期间的 watcher 更新和不可恢复副本不写盘、副本去重包含未确认基线；图片 URL 的解析，粘贴、拖入 token 链路，插入凭据的位置映射、组合输入排队和撤销步；`src/services/` 的薄封装。Go 测试覆盖绑定服务、文件树和排除规则、文件操作的路径守卫与 generation、监听自写过滤、关闭工作区后的无根状态（文件、文件树、监听、图片、标签、设置和恢复服务拒绝或返回空状态）、不存在的文件夹返回固定错误、`workspaceClosed` 的设置与清除、拖入文件夹 token 的一次性、过期和路径筛选、单文件授权与显示、设置存储、标签页布局存储的根目录校验、最近文件校验与清理、恢复副本的路径授权与 generation、`diskState` 判定、未确认基线不记录哈希、单文件恢复的安全复核和一次性授权、父目录符号链接、单文件读盘失败不可恢复、JSON 字节上限与 HTML 字面写入、8MB/64MB 上限与替换豁免、损坏文件备份与配额排除、损坏备份按时间保留最新 20 个且不影响有效副本、文件名和内容 id 一致、磁盘哈希在切换根目录时保留仍打开的单文件、测试数据隔离、图片协议的路径守卫与 Content-Type、drop token 的一次性和过期、图片保存的文件名、并发写入与原子失败。
查找替换的 Vitest 覆盖真实 CodeMirror 的查询、大小写和正则开关、无效表达式、计数、循环导航、单行与跨行选区、Unicode/中文/emoji、正则捕获组替换、全部替换的单一撤销步和自动保存模型、匹配配色与代码块层级、面板位置和窄窗约束、焦点/IME/Esc、切换标签清理、任务框快捷键转发以及平台键位。修复轮补充残留 F3 默认入口不改变无效查询、字符串重叠匹配的计数/当前装饰/播报、任务框 Alt+Mod-F 与 Windows/Linux Ctrl+H/F3/Shift-F3、查找输入框打开三种命令面板、opener 恢复与卸载回退、模式菜单双向互斥及 Esc 关闭后恢复模式开关焦点、浮动大纲与查找互斥、slash 与查找在真实 contentDOM target 上的 Esc 所有权顺序。Go 服务的既有测试不受前端查找改动影响，CI 仍会完整运行 Go 套件。

工作区全文搜索的 Vitest 覆盖入口与命令面板、选项、流式分组、计数与高亮、截断/无结果/错误、清空与 Esc 焦点、slash/查找/固定或浮动大纲与搜索输入框的 Esc 所有权、搜索中 ⌘N 先回到树再新建、组合输入、窄浮层、旧查询迟到结果、换根和销毁取消、点击结果的稳定行/列、完整行/匹配/结束行指纹与文档/行锚点校验、UTF-16 选区与居中、脏标签保留、同行重复文字不误跳、前面行长度变化后的重定位、零宽/跨行/长匹配、过期和缺失文件安全、读盘期间后续标签选择或更新结果使旧跳转失效、打开结果后目标标签/视图/文档身份复核。Go 测试覆盖当前工作区搜索的 Markdown/隐藏目录/node_modules/符号链接范围、枚举后替换为文件/目录链接或非普通文件的读取拒绝、FIFO 打开不阻塞、打开后按 FD 类型拒绝、字面/大小写/RE2 正则/非法表达式/零宽与跨行匹配、UTF-16 列与 CRLF/CR 位置、完整行/匹配/结束行指纹向量和锚点边界、流式顺序、非 Markdown 遍历途中的取消和同文件待发送行的取消、generation 停止、1000 处边界与截断、超长行片段、读取错误；搜索服务仍由 `src/services/search.ts` 薄封装，Channel 生命周期由页面管理。

链接、图片与选区编辑的 Vitest 覆盖直接键入 `*`/反引号/`~`/`[` 的包裹与排除条件、连续反引号加层及其选择/文档生命周期失效、非空选区的 `(` 等括号按普通替换而不再配对、没有直接按键记录的非直接输入和真实 DOM replacement、首尾 Unicode 空白、多光标混合空选区、全空选区交给 `closeBrackets`、连续标记和单撤销；实时预览/源码的 `[文字]()` 光标位置、沉浸模式单目标与多选区批量链接草稿、每个目标独立字段、一次完成/一个撤销、Esc 全部取消、任一目标失效整批取消、未确认草稿不落盘，沉浸点击保留正文焦点与 Tab 进入、普通点击只作用于沉浸模式、Mod 加点击不打开编辑弹框；命令面板/slash/浮动大纲/模式菜单与弹框的互斥、切换标签和外部载入关闭弹框、目标编辑后失效、查找输入框拥有 Esc 且链接草稿保留；弹框 340px 目标宽、上下翻转、编辑器宿主与窗口 viewport 交集留边、固定大纲旁右缘、宿主/窗口/滚动/布局变化、小区域有界滚动与底部操作可达、宿主不可用不绘制、多组字段有界滚动、Enter/Esc/IME；Markdown destination 尖括号外壳与字面 `%3C`/`%3E` 的区分、仅改替代文本保留原 destination、真正改地址后的 remote/data/local 序列化、link/image 共用最终合法 destination（空格或不成对括号使用外壳、语法字符按需转义、地址清空且 title 存在时显式空 destination `<>`、无 title 保留 `()`、解析后地址与 title 保持）、图片路径逐段转义与已有转义/remote/data/query/fragment 保持、本地解析往返、remote/data 禁用以及 Go `RevealImage` 的 generation、隐藏目录、`node_modules`、非图片、非普通文件和符号链接逃逸拒绝。

`placeNativeCaret` 每次上方插行都会调用，但只有编辑器被重建后、还没有真实点击就按键的路径才有可见效果（切标签或重启恢复）。仓库没有 WKWebView 场景；Vitest 只用 spy 断言 `Selection.collapse` 的节点和偏移，真实原生选区由发布前手测确认，不声称 jsdom 覆盖其副作用。

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
