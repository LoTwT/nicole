# 架构

概要：

- 桌面外壳使用 MyGo Web 模式，前端是 Vue 3 + Vite + Tailwind CSS v4，编辑器是 CodeMirror 6。
- `src/editor/` 是纯 TypeScript 模块，不依赖 Vue 和 MyGo；MyGo 调用只出现在 `src/services/` 和 `main.go`。
- 前后端通过 MyGo 的类型化 IPC 通信。
- 渲染的 HTML 必须经过 DOMPurify；文件与协议访问默认限制在当前工作区，工作区外的单个文件需要按文件授权。
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
| 文件监听 | Go 端 `Workspace.Watch` 封装 `mygo.WatchFiles`，过滤自写后经 Channel 交给页面，见[工作区与文件](specs/workspace.md#文件监听)。 |
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
  image-insertion.ts      粘贴、拖入图片与编辑器插入凭据的接线
  editor/                 纯 TypeScript，不依赖 Vue 和 MyGo
    index.ts              createEditor、三种模式、widgets、核心命令、图片插入
    types.ts              对外类型
  services/               MyGo 边界
    mygo.ts               生成的类型化客户端
    app.ts                薄封装（getAppInfo）
    assets.ts             薄封装（粘贴、拖入图片、窗口文件拖放事件）
    workspace.ts          薄封装（选择文件夹、列文件、读写、关窗保存）
    files.ts              文件树与文件操作
    settings.ts           全局设置和主题迁移
    single-file.ts        单文件标签页的授权与读写
    menu.ts               原生右键菜单
    open-file.ts          系统“打开方式”事件
    watch.ts              工作区文件监听
        │
        │ MyGo 类型化 IPC（绑定方法 / Channel / Event）
        ▼
Go（main.go）
  Application             版本、平台和 Go 版本（当前）
  updater.Plugin          Sparkle 风格更新窗口与“检查更新…”菜单（当前）
  Workspace               选择文件夹、列 Markdown、代际绑定写入、关窗保存（当前）
  File tree / operations  ListDirectory、新建、重命名、废纸篓、默认应用、Finder（当前）
  Workspace.Watch         mygo.WatchFiles 的 Channel 封装，过滤自写（当前）
  SingleFileService       工作区外单个 .md 的按文件授权与读写（当前）
  OpenedFiles             系统“打开方式”的路径队列与 app:open-file 信号（当前）
  NativeMenu              页面请求的原生右键菜单（当前）
  Settings                settings.json、最近文件夹、展开状态、侧栏宽度、主题（当前）
  Assets                  图片存到 assets/，读剪贴板和原生拖入路径（当前）
  Image protocol          只映射当前工作区的图片，并阻止顶层导航（当前；启动时注册）
  Window state            启动时在光标屏幕居中，沿用上次尺寸（当前）
  Search                  通过 Channel 流式返回结果（后续）
  Export / Recovery       导出与崩溃恢复（后续）
```

`main.go` 负责注册插件、绑定服务、注册图片协议、设置菜单和创建窗口；`workspace.go` 实现工作区与路径守卫，`workspace_tree.go` 实现文件树和文件操作，`workspace_watch.go` 封装监听，`single_file.go` 实现单文件授权，`settings.go` 实现设置存储，`menu.go` 实现菜单与原生右键菜单，`assets.go` 实现图片保存，`protocol.go` 实现图片协议，`window_options.go` 定义窗口标题栏，`window_state.go` 实现窗口状态的居中策略。`index.html` 是 Vite 入口，`mygo.config.ts` 描述应用、文件关联、前端构建、生成客户端的位置和输出目录。

## 依赖边界

- `src/editor/` 是纯 TypeScript，不依赖 Vue，也不依赖 MyGo。运行时只导出 `createEditor`；其余导出是调用方需要的类型。
- MyGo 调用只放在 `src/services/` 和 Go 入口（`main.go` 及同一包内直接使用 MyGo 的服务实现），其他前端模块通过 `src/services/` 间接使用后端能力。生成的客户端直接输出到 `src/services/mygo.ts`。
- `main.go` 还注册 MyGo 的 `updater.Plugin`，绑定工作区、图片、设置、单文件、打开方式和原生菜单服务，注册图片协议并设置应用菜单；文件监听由 `Workspace.Watch` 在页面调用时开始。更新源、版本注入和发布流程见[发布与自动更新](release.md)。
- `src/services/` 是生成的 `mygo.ts` 客户端上的薄封装，不承载业务逻辑。`app.ts` 只把 `Application.Info` 包装成 `getAppInfo`；`workspace.ts` 包装 `Workspace` 的 Markdown 方法与关窗保存事件；`files.ts`、`settings.ts`、`single-file.ts`、`menu.ts`、`open-file.ts` 和 `watch.ts` 分别包装对应服务。封装不拼接路径，也不缓存文件内容。
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
    onPasteImage,  // 剪贴板里有图片时回调，参数是插入凭据
    onChange,      // 文档变化时回调全文
  }): EditorHandle
  ```

  `EditorHandle` 提供 `view`、`mode`、`setMode`、`undo`、`redo`、`containsPoint`、`createInsertionTicket`、`insertImages`、`focus` 和 `destroy`。`undo()` / `redo()` 在输入法组合期间返回 `false`，不执行历史；`containsPoint(x, y)` 按视口坐标判断落点是否在编辑器内；`createInsertionTicket(x, y)` 按视口坐标创建插入凭据，坐标不在编辑区内时返回 null；`insertImages(ticket, markdown)` 在一个事务里插入文本，因此是一个撤销步。编辑器持续对凭据做位置映射，中文输入法组合期间先排队，组合结束后再插入；多条排队插入逐条处理，前一条插入会映射后一条的位置。`onPasteImage` 只把粘贴事件交给应用层，保存图片和生成 Markdown 由 `src/image-insertion.ts` 经 `src/services/assets.ts` 完成；编辑区不接触 MyGo。三种模式通过同一个 `Compartment` 重配置，`EditorView` 实例不变。

- 编辑器主题直接读取 CSS 变量；界面切换亮暗时只改 `<html>` 上的 `.dark`，不重建编辑器（见[主题与字体](specs/theming.md#编辑器主题)）。
- 命令注册表只有一份，各入口共用，见 [Slash 命令](specs/slash-commands.md#命令注册表)。
- 编辑模式的设计和限制见[编辑模式](specs/editor-modes.md)。

## IPC 用法

- MyGo 提供类型化 IPC：绑定方法、`Channel` 和 `Event`。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；本项目是 `src/services/mygo.ts`。
- 前端只通过生成的客户端和 `services/` 调用 Go；Go 用 `mygo.Bind` 暴露服务，用 `*mygo.Channel[T]` 推送流，用 `mygo.NewEvent[T]` 发送事件。
- 当前的最小服务是 `Application.Info()`，返回应用版本、操作系统、架构和 Go 版本，用来验证前端与 Go 的调用链。
- `Workspace` 提供 `ChooseFolder`、`ListFiles`、`ReadFile`、`WriteFile`、`ConfirmDiscard` 和 `FinishClose`，以及文件树的 `ListDirectory`、`CreateFile`、`CreateFolder`、`RenameEntry`、`TrashEntry`、`OpenWithDefaultApp`、`RevealEntry` 和 `Watch`。写操作携带打开时返回的 `generation`，路径和文件类型的规则见[工作区与文件](specs/workspace.md#路径守卫)和[写入保证](specs/workspace.md#写入保证)。
- 关窗时 Go 发出携带 `token` 的 `workspace:save-before-close` 事件并阻止关闭；前端保存后调用 `FinishClose(token, saved)`。保存失败时由 Go 弹出确认框，只有用户明确选择放弃才关窗；页面无响应时最多等待 5 秒。
- `Workspace.Watch(generation)` 用 `*mygo.Channel[FileWatchPart]` 流式返回 `ready` 和事件批次；底层是 `mygo.WatchFiles`，在 Go 端过滤 Nicole 自己的写入（见[工作区与文件](specs/workspace.md#忽略-nicole-自己的写入)）。工作区状态本身是可替换的单例，后续协议 handler 在启动时注册、运行时读取同一个状态。
- `SingleFileService` 提供 `ChooseSingleFile`、`AcceptSingleFile`、`ReadSingleFile`、`WriteSingleFile` 和 `ReleaseSingleFile`；授权按解析后的绝对路径保存，只有对话框选择或 `App.OnOpenFile` 提供的文件才能被接受。`OpenedFiles` 暂存系统传入的路径；`app:open-file` 只通知“有新文件”，页面收到信号后调用 `TakePendingOpenedFiles` 一次取走队列，既覆盖启动时到达的文件，也不会重复交付同一个文件。
- `Settings` 提供 `Get`、`MigrateLegacyTheme`、`SetTheme`、`SetSidebarWidth`、`SetExpandedFolders`、`AddRecentFolder` 和 `RemoveRecentFolder`；`SetTheme` 同时调用 `mygo.Theme.SetSource` 同步原生外观。
- `NativeMenu.PopupNativeMenu` 在调用窗口的页面坐标显示原生菜单，返回选中项 ID 或空字符串；页面最多传 64 项，ID 唯一。正文的 WebView 右键菜单由 `Page.OnContextMenu` 裁剪，见[安全](#安全)。
- 搜索通过 Channel 流式返回结果（见[工作区与文件](specs/workspace.md#搜索)）。
- `Assets` 提供 `PasteImage(docPath, generation)` 和 `ImportImages(docPath, generation, dropToken)`，返回保存后的工作区相对路径和 Markdown。粘贴时 Go 先读剪贴板里的本地文件列表；列表非空时只导入其中的图片，没有图片就返回“剪贴板没有图片”，只有列表为空时才读 PNG 位图；拖入时 Go 从 `Window.OnFileDrop` 保存的路径中按一次性 token 取文件。页面不再传拖入路径，图片字节也不经过 IPC（见[工作区与文件](specs/workspace.md#图片)）。
- `src/services/assets.ts` 封装 `Assets.PasteImage`、`Assets.ImportImages` 和 `assets:file-drop`。DOM 拖放事件本身没有路径，只用于阻止浏览器默认行为；页面通过 `assets:file-drop` 从 Go 拿到一次性 token 和落点坐标，用 `EditorHandle.containsPoint` 确认在编辑区内后才创建插入凭据。绝对路径只保存在 Go，页面不记录拖放计数。

各接口的具体语义、错误传播和背压行为见 [MyGo 参考](references/mygo.md#绑定与-ipc)。

## 安全

根据 MyGo 的[页面信任模型](references/mygo.md#页面信任模型)，从自定义协议加载的页面是受信任的，可以直接调用 Go 方法。Markdown 里的原始 HTML 如果直接渲染，就能调用这些方法去读写文件。

因此：

- 渲染出来的 HTML 一律先经过 DOMPurify 清洗。
- 沙箱 iframe 可能会额外起进程，尽量不用。
- Go 的文件服务限制见[工作区与文件](specs/workspace.md#路径守卫)。工作区内的读取、写入和文件操作都以 `os.OpenRoot` 的根为边界，并在操作前用 `filepath.EvalSymlinks` 确认目标仍在工作区内；文件树操作不能借 `..`、绝对路径、盘符路径或符号链接越出根目录。
- 工作区外的文件采用按文件授权：`SingleFileService` 只保存用户通过原生对话框选择、或通过 `App.OnOpenFile` 提供并在页面确认后的解析绝对路径。读写只接受完全相同的路径，列出目录、访问同目录其他文件、相对路径和目录本身都拒绝；授权不跨重启保存，关闭标签页时释放。见[单文件标签页](specs/workspace.md#单文件标签页)。
- 文件树的“用默认应用打开”在 Go 端按白名单分类：图片、PDF、纯文本和常见办公文档可直接打开；已知启动器类型（PATHEXT、macOS 脚本/快捷方式、Linux `.desktop` 等）直接拒绝；其他类型和 Unix 可执行文件必须先经过 Go 弹出的原生确认框，页面无法绕过。详见[文件操作](specs/workspace.md#打开方式的安全规则)。
- 系统“打开方式”传入的路径先记为“已提供”，不会自动授权；`AcceptSingleFile` 只接受已经提供的路径，页面不能凭任意字符串自行授权。`app:open-file` 只是“有新文件”的信号，页面收到后调用 `TakePendingOpenedFiles` 清空队列，避免事件与启动时读取重复交付。
- 原生右键菜单只接收菜单项 ID、文字、快捷键、禁用状态和页面坐标，不接收命令或文件内容；菜单项由 Go 组装，选择结果只把 ID 返回页面。正文的 WebView 右键菜单删除“重新载入”“后退”“前进”，非开发构建还删除“检查元素”。
- 文件关联只让系统把 `.md` 路径交给 `App.OnOpenFile`；在用户于页面确认“只打开这个文件”之前，Go 不读写该文件。
- 设置存储和单文件授权都只使用 Go 的文件接口；测试和开发构建通过 `NICOLE_USER_DATA_DIR` 指向临时目录，避免修改用户正在使用的数据（见[开发](development.md#数据隔离)）。应用启动时请求单实例锁；不同的 `NICOLE_USER_DATA_DIR` 使用独立的锁命名空间，因此隔离的测试/开发实例不会被误转交给安装版。
- 图片协议只映射当前工作区，handler 在启动时注册，运行时读取可替换的工作区状态。
- 图片协议的 URL 带 `generation`，切换文件夹后旧请求返回 404，不会读到新工作区里的同名文件。
- 拖入路径只从 `Window.OnFileDrop` 进入 Go；页面只能提交约 10 秒有效、一次性的 token，不能指定任意路径。源文件是符号链接或非常规文件时拒绝读取。
- 协议只接受 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`、`.svg`，只接受 GET 和 HEAD；路径经过与文件读写相同的检查并用 `os.Root` 打开，越界、隐藏目录、`node_modules`、符号链接逃逸和目录都返回 404。
- 响应显式设置 `Content-Type` 和 `X-Content-Type-Options: nosniff`，不会把伪装成图片的 HTML 当页面执行。
- **顶层导航**：MyGo 把已注册协议的页面当作受信任页面，因此窗口通过 `OnWillNavigate` 取消任何顶层导航到 `nicole-image:` 的请求。图片只在 `<img>` 中加载，不会被打开成可调用 Go 的文档。
- **SVG**：SVG 可能内嵌脚本。页面只用 `<img>` 加载图片；导入时去掉 BOM、XML 声明、注释和 DOCTYPE 后要求第一个元素是 `<svg`。协议响应同时设置 `Content-Security-Policy: default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; sandbox`，即使直接访问 SVG，脚本也不会执行，外部资源和内嵌对象也不会加载。因此允许显示工作区里的 SVG，但禁止它成为可执行页面。

## 主要风险

| 风险 | 应对 |
|---|---|
| 中文输入法在 macOS WKWebView 里的表现 | 技术验证第一周就测；拼音输入过程中不能重建当前行的渲染，见[中文输入法](specs/editor-modes.md#中文输入法)。 |
| MyGo 的 API 可能变化 | MyGo 仍处于 0.x（当前锁定 0.7.3，见[参考](references/mygo.md)）；锁定版本，并把所有调用集中在 `src/services/` 和 `main.go`。 |
| 沉浸模式的边界情况多 | 先把实时预览做好，再逐步补齐沉浸模式，见[编辑模式](specs/editor-modes.md)。 |
| Linux 的 WebKitGTK 能力较弱 | 平台优先级排在最后，见[平台优先级](specs/product.md#平台优先级)。 |
