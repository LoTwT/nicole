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
  App.vue                 单窗口外壳：装订册布局、多标签文档模型、自动保存、外部变化与主题
  main.ts                 挂载 Vue
  sample.ts               示例文本
  style.css               Tailwind、主题和字体变量
  image-url.ts            把 Markdown 图片 URL 解析成自定义协议地址
  image-insertion.ts      粘贴、拖入图片与编辑器插入凭据的接线
  app/                    界面状态与纯逻辑辅助
    command-palette.ts    命令面板模式、文件/标题筛选与最近文件列表
    context-menu.ts       文件树、根目录和标签页右键菜单，快捷键取自注册表
    file-tree.ts          文件树节点、排序、展开与增量合并
    line-endings.ts       换行风格检测与写回
    paths.ts              工作区相对路径、主目录缩写
    platform.ts           平台判断、平台文字与本地化标签
    recovery.ts           副本计时器与恢复时间格式
    status.ts             保存状态、横幅优先级和标签页圆点
    tabs.ts               标签页模型、同名区分、关闭问题与后台快照映射
    word-count.ts         字数口径与恢复副本的字数差
    watch-events.ts       监听事件与已打开文档、文件树刷新范围的对应
    workspace-search.ts   搜索结果分组、高亮片段、错误文案与点击定位校验
  commands/               唯一命令注册表、格式/应用命令、键位匹配与格式化、拼音搜索
  components/             界面组件
    AppSidebar.vue        侧栏外壳、宽度拖动、工作区工具行、搜索入口、底部入口
    FileTree.vue          按需读取的文件树、右键菜单、行内新建与重命名
    FileTreeNode.vue      递归树节点与键盘可见结构
    WorkspaceSearch.vue   侧栏全文搜索的输入、开关、流式结果与匹配高亮
    TopBar.vue            多标签标签栏、模式切换、侧栏与大纲入口
    StatusBar.vue         右侧保存状态与临时提示、侧栏不可见时的左侧主题按钮
    AppBanner.vue         外部修改、删除、保存失败和恢复内容横幅
    AppDialog.vue         模态对话框、焦点陷阱与焦点恢复
    CommandPalette.vue    命令、文件和标题三种模式的命令面板
    RecoveryDialog.vue    崩溃恢复列表与三个选择
    EmptyState.vue        开始写作、无文件和最近文件夹
    NonMarkdownPlaceholder.vue  非 Markdown 文件的占位页
    InlineNameInput.vue   行内文件名输入框
    AppIcon.vue           内联 Lucide 1.66.0 图标
    ThemeToggle.vue       侧栏底栏与侧栏不可见时状态栏共用的主题切换按钮
    KeyHint.vue           浅色纯文字的快捷键提示
  editor/                 纯 TypeScript，不依赖 Vue 和 MyGo
    index.ts              createEditor、三种模式、widgets、核心命令、图片插入
    headings.ts           Lezer 语法树的 ATX/Setext 标题提取，供命令面板与大纲复用
    types.ts              对外类型
  services/               MyGo 边界
    mygo.ts               生成的类型化客户端
    app.ts                薄封装（getAppInfo）
    assets.ts             薄封装（粘贴、拖入图片、窗口文件拖放事件）
    clipboard.ts          复制路径时的剪贴板回退
    workspace.ts          薄封装（选择/打开文件夹、列文件、读写、关窗保存）
    files.ts              文件树与文件操作
    settings.ts           全局设置和主题迁移
    tabs.ts               当前根目录的标签页布局
    single-file.ts        单文件标签页的授权、读写与显示
    recovery.ts           未保存内容副本的写入、列表、删除与单文件恢复
    menu.ts               原生右键菜单
    open-file.ts          系统“打开方式”事件
    watch.ts              工作区文件监听
    search.ts             工作区全文搜索的 Channel 封装
        │
        │ MyGo 类型化 IPC（绑定方法 / Channel / Event）
        ▼
Go（main.go）
  Application             版本、平台和 Go 版本（当前）
  updater.Plugin          Sparkle 风格更新窗口与“检查更新…”菜单（当前）
  Workspace               选择文件夹、列 Markdown、代际绑定写入、关窗保存（当前）
  File tree / operations  ListDirectory、新建、重命名、废纸篓、默认应用、Finder（当前）
  Workspace.Watch         mygo.WatchFiles 的 Channel 封装，过滤自写（当前）
  SingleFileService       工作区外单个 .md 的按文件授权、读写与显示（当前）
  OpenedFiles             系统“打开方式”的路径队列与 app:open-file 信号（当前）
  NativeMenu              页面请求的原生右键菜单（当前）
  Settings                settings.json、最近文件夹、展开状态、侧栏宽度、主题、编辑模式（当前）
  WorkspaceTabs           tabs.json、当前根目录的标签页布局与活动标签（当前）
  Recovery                recovery/ 未保存内容副本、磁盘哈希与单文件恢复授权（当前）
  Assets                  图片存到 assets/，读剪贴板和原生拖入路径（当前）
  Image protocol          只映射当前工作区的图片，并阻止顶层导航（当前；启动时注册）
  Window state            启动时在光标屏幕居中，沿用上次尺寸（当前）
  Workspace.Search        当前工作区 Markdown 的磁盘全文搜索，经 Channel 流式返回（当前）
  Export                  导出（后续）
```

`main.go` 负责注册插件、绑定服务、注册图片协议、设置菜单和创建窗口；`workspace.go` 实现工作区与路径守卫，`workspace_tree.go` 实现文件树和文件操作，`workspace_watch.go` 封装监听，`workspace_search.go` 实现当前工作区的磁盘全文搜索，`single_file.go` 实现单文件授权，`recovery.go` 实现未保存内容副本和磁盘哈希，`settings.go` 实现设置存储，`tabs.go` 实现标签页布局存储，`menu.go` 实现菜单与原生右键菜单，`assets.go` 实现图片保存，`protocol.go` 实现图片协议，`window_options.go` 定义窗口标题栏，`window_state.go` 实现窗口状态的居中策略。`index.html` 是 Vite 入口，`mygo.config.ts` 描述应用、文件关联、前端构建、生成客户端的位置和输出目录。

## 依赖边界

- `src/editor/` 是纯 TypeScript，不依赖 Vue，也不依赖 MyGo。运行时只导出 `createEditor`；其余导出是调用方需要的类型。
- MyGo 调用只放在 `src/services/` 和 Go 入口（`main.go` 及同一包内直接使用 MyGo 的服务实现），其他前端模块通过 `src/services/` 间接使用后端能力。生成的客户端直接输出到 `src/services/mygo.ts`。
- `main.go` 还注册 MyGo 的 `updater.Plugin`，绑定工作区、图片、设置、单文件、打开方式和原生菜单服务，注册图片协议并设置应用菜单；文件监听由 `Workspace.Watch` 在页面调用时开始。更新源、版本注入和发布流程见[发布与自动更新](release.md)。
- `src/services/` 是生成的 `mygo.ts` 客户端上的薄封装，不承载业务逻辑。`app.ts` 只把 `Application.Info` 包装成 `getAppInfo`；`workspace.ts` 包装 `Workspace` 的 Markdown 方法、`PickFolder`/`OpenFolder` 和关窗保存事件；`files.ts`、`settings.ts`、`single-file.ts`、`menu.ts`、`open-file.ts`、`watch.ts` 和 `search.ts` 分别包装对应服务；`clipboard.ts` 只负责复制界面文字。封装不拼接路径，也不缓存文件内容。
- `src/app/` 只放不依赖 Vue 组件实例的界面逻辑，`src/components/` 只负责渲染和交互事件；`App.vue` 负责把这些模块与 `services/` 接起来，不直接调用 MyGo。`src/app/workspace-search.ts` 只处理流式结果的分组、行片段和点击定位校验，`WorkspaceSearch.vue` 只处理输入、开关、渲染和 Channel 会话。
- `src/commands/` 保存唯一命令注册表、格式与插入命令、应用与文件树命令、键位匹配和显示、拼音搜索/最近使用逻辑；只依赖 CodeMirror、`src/app/platform.ts`，以及类型层面的 `src/app/file-tree.ts`，不依赖 Vue 或 MyGo。`src/editor/slash.ts` 负责 slash 触发、查询和菜单状态，`src/components/SlashMenu.vue` 只负责渲染和定位；`src/app/context-menu.ts` 组装右键菜单并从注册表读取快捷键。`src/app/command-palette.ts` 处理面板模式标识、文件与标题排序；`src/editor/headings.ts` 从 Lezer 树提取标题；`src/components/CommandPalette.vue` 只负责渲染和键盘交互。
- `createEditor` 的接口为：

  ```ts
  type EditorMode = "live" | "immersive" | "source";

  interface CommandKeyBinding {
    key?: string; // CodeMirror 键位，例如 "Mod-b"
    mac?: string;
    win?: string;
    linux?: string;
  }

  interface CommandTarget {
    readonly state: EditorState;
    dispatch(...specs: TransactionSpec[]): void;
  }

  type CommandScope = "editor" | "app" | "file-tree";

  interface CommandContext {
    view: CommandTarget | null; // 应用和文件树命令不依赖编辑器
    platform: AppPlatform;
    app?: AppCommandActions;    // App.vue 提供的打开、保存、切标签等动作
    fileTree?: FileTreeCommandContext; // 焦点节点与打开、重命名、删除、新建动作
  }

  interface CommandDefinition {
    id: string;
    label: string;
    pinyin?: string;        // 额外拼音和英文别名
    icon?: string;          // 供格式工具栏使用
    group: "inline" | "paragraph" | "block" | "insert" | "app";
    scope: CommandScope;
    glyph?: string;         // slash 菜单 22px 示意
    keys?: readonly CommandKeyBinding[];
    inSlashMenu?: boolean;
    available?: boolean;    // false 时只保留定义和键位显示，不参与分发
    run: (context: CommandContext) => boolean;
  }

  createEditor({
    parent,        // 挂载的 DOM 元素
    doc,           // 初始 Markdown 文本
    mode,          // 默认 "live"
    platform,      // 命令上下文里的平台，默认按 navigator.platform 推断
    commands,      // 本次编辑器额外的命令；共享注册表始终合并进来
    restore,       // 后台标签页的选区、顶部行、行内偏移和 historyField JSON
    resolveImage,  // 把图片 URL 解析成可显示地址；返回 null 时保留原文
    onPasteImage,  // 剪贴板里有图片时回调，参数是插入凭据
    onChange,      // 文档变化时回调全文
    onCompositionEnd, // DOM 组合结束时回调；CodeMirror 内部结束或视图销毁时不会回调
    onCompositionStart, // DOM 组合开始时回调
  }): EditorHandle
  ```

  `EditorHandle` 提供 `view`、`mode`、`setMode`、`replaceDocument`、`undo`、`redo`、`containsPoint`、`createInsertionTicket`、`insertImages`、`getRestoreState`、`focus` 和 `destroy`。`getRestoreState` 序列化选区、`historyField`、顶部行号和行内像素偏移；后台标签页销毁视图时只保留这份状态和文本。`replaceDocument` 把磁盘上的新文本作为一次差异修改应用，映射选区并把可见区域顶部保持在原行。`undo()` / `redo()` 在输入法组合期间返回 `false`，不执行历史；`containsPoint(x, y)` 按视口坐标判断落点是否在编辑器内；`createInsertionTicket(x, y)` 按视口坐标创建插入凭据，坐标不在编辑区内时返回 null；`insertImages(ticket, markdown)` 在一个事务里插入文本，因此是一个撤销步。编辑器持续对凭据做位置映射，中文输入法组合期间先排队，组合结束后再插入；多条排队插入逐条处理，前一条插入会映射后一条的位置。`onCompositionStart` 和 `onCompositionEnd` 只转发 DOM 组合事件：应用层用 `onCompositionStart` 清除“组合已失效”标记，用 `onCompositionEnd` 恢复被组合挡下的自动保存计时。CodeMirror 对 Safari dead-key 组合的内部收尾和视图销毁都不会触发回调，应用层需要自行兜底（见[工作区与文件](specs/workspace.md#输入法组合期间)）。`onPasteImage` 只把粘贴事件交给应用层，保存图片和生成 Markdown 由 `src/image-insertion.ts` 经 `src/services/assets.ts` 完成；编辑区不接触 MyGo。三种模式通过同一个 `Compartment` 重配置，`EditorView` 实例不变。编辑器命令的键位由注册表生成，统一通过 `Prec.highest` 注册，组合输入期间返回 `false` 交给输入法。

- 编辑器主题直接读取 CSS 变量；界面切换亮暗时只改 `<html>` 上的 `.dark`，不重建编辑器（见[主题与字体](specs/theming.md#编辑器主题)）。
- 命令注册表只有一份，各入口共用，见 [Slash 命令](specs/slash-commands.md#命令注册表)。`formatCommandShortcut` 把注册表键位转成平台显示文本，悬停提示、`KeyHint`、命令面板、右键菜单和测试都使用这一条路径；`createCommandKeymap` 统一生成编辑器命令的 `Prec.highest` 键位表。`src/commands/keybinding.ts` 先按字符匹配，再用 `w3c-keyname`、`event.code` 和 `keyCode` 做受限的物理键回退（ASCII 字符不按物理字母回退），`App.vue` 分发 `scope: "app"` 的命令，`FileTree.vue` 只在文件树有焦点时分发 `scope: "file-tree"` 的命令；`available: false` 的占位命令不参与分发。`pinyin-pro` 只在第一次打开 slash 菜单或命令面板时动态加载，命令最近使用记录存放在 `localStorage`。格式命令把事务标为 `input.format` 并用 `isolateHistory` 隔离撤销步；slash 执行把删除查询和命令产生的事务合并成一个事务。命令面板执行编辑器命令前恢复打开面板时记录的选区，文件模式的最近文件随 `tabs.json` 保存。
- 编辑模式的设计和限制见[编辑模式](specs/editor-modes.md)。

## IPC 用法

- MyGo 提供类型化 IPC：绑定方法、`Channel` 和 `Event`。
- 用 `mygo generate` 生成 TypeScript 客户端，输出路径由 `mygo.config.ts` 的 `bindings` 指定；本项目是 `src/services/mygo.ts`。
- 前端只通过生成的客户端和 `services/` 调用 Go；Go 用 `mygo.Bind` 暴露服务，用 `*mygo.Channel[T]` 推送流，用 `mygo.NewEvent[T]` 发送事件。
- 当前的最小服务是 `Application.Info()`，返回应用版本、操作系统、架构、Go 版本和主目录，用来验证前端与 Go 的调用链，并让界面把主目录写成 `~`。
- `Workspace` 提供 `ChooseFolder`、`PickFolder`、`OpenFolder`、`OpenDroppedFolder`、`CloseWorkspace`、`ListFiles`、`ReadFile`、`WriteFile`、`ConfirmDiscard` 和 `FinishClose`，以及文件树的 `ListDirectory`、`CreateFile`、`CreateFolder`、`RenameEntry`、`TrashEntry`、`OpenWithDefaultApp`、`RevealEntry`、`Watch` 和 `Search`。`PickFolder` 只返回用户在原生对话框中选择的路径；`OpenFolder` 只接受该路径、Go 记录的最近文件夹或系统提供的文件的所在文件夹，页面不能凭任意字符串切换根目录。只有“系统提供文件的父目录”这一来源会拒绝根目录、盘符根目录和主目录；用户主动选择、当前根目录和最近列表不受限制。`OpenDroppedFolder` 只接受 Go 发放的文件夹 token，不接收页面路径；token 和启动状态字段的规则见[拖入文件夹](specs/workspace.md#拖入文件夹)与[设置存储](specs/workspace.md#设置存储)。写操作携带打开时返回的 `generation`，路径和文件类型的规则见[工作区与文件](specs/workspace.md#路径守卫)和[写入保证](specs/workspace.md#写入保证)。
- 关窗时 Go 发出携带 `token` 的 `workspace:save-before-close` 事件并阻止关闭；前端保存后调用 `FinishClose(token, saved)`。保存失败时由 Go 弹出确认框，只有用户明确选择放弃才关窗；页面无响应时最多等待 5 秒。
- `Workspace.Watch(generation)` 用 `*mygo.Channel[FileWatchPart]` 流式返回 `ready` 和事件批次；底层是 `mygo.WatchFiles`，在 Go 端过滤 Nicole 自己的写入（见[工作区与文件](specs/workspace.md#忽略-nicole-自己的写入)）。工作区状态本身是可替换的单例，后续协议 handler 在启动时注册、运行时读取同一个状态。
- `SingleFileService` 提供 `ChooseSingleFile`、`AcceptSingleFile`、`DismissOfferedFile`、`ReadSingleFile`、`WriteSingleFile`、`RevealSingleFile` 和 `ReleaseSingleFile`；授权按解析后的绝对路径保存，只有对话框选择或 `App.OnOpenFile` 提供的文件才能被接受。打开系统文件的父目录是一次性授权：`OpenFolder` 成功后 Go 消耗对应提供项，取消时页面调用 `DismissOfferedFile`。`OpenedFiles` 暂存系统传入的路径；`app:open-file` 只通知“有新文件”，页面收到信号后调用 `TakePendingOpenedFiles` 一次取走队列，既覆盖启动时到达的文件，也不会重复交付同一个文件。
- `Recovery` 提供 `Save(copy, generation)`、`List(generation)`、`Delete(id, generation)`、`Discard(ids, generation)` 和 `RestoreSingleFile(id)`。工作区副本只接受当前根和 generation；单文件副本写入时核对 `SingleFileService` 的授权。副本请求可带 `baselineUnconfirmed`，此时 Go 不记录也不沿用磁盘哈希。`List` 由 Go 读磁盘并返回 `diskState`、`text` 和 `diskText`，页面不自行读盘；`changed`/`missing` 的结果是列表时的快照，用户在对话框里做出选择前页面会重新 `List`。格式、上限和恢复规则见[工作区与文件](specs/workspace.md#崩溃恢复)。
- `Settings` 提供 `Get`、`MigrateLegacyTheme`、`SetTheme`、`SetEditorMode`、`SetSidebarWidth`、`SetExpandedFolders`、`AddRecentFolder` 和 `RemoveRecentFolder`；`AddRecentFolder` 只接受当前已打开的根目录，最近列表由 `Workspace.open` 写入；`SetTheme` 同时调用 `mygo.Theme.SetSource` 同步原生外观；`SetEditorMode` 只接受 `live`、`immersive` 或 `source`，非法值在写盘前拒绝。`workspaceClosed` 由 Go 维护，页面只通过 `Get` 读取；语义见[设置存储](specs/workspace.md#设置存储)。
- `WorkspaceTabs` 提供 `Get(root)` 和 `Save(root, tabs, active, recentFiles)`，只接受当前打开的根目录；标签和最近文件路径都是相对路径，只用于显示和恢复，不构成文件授权。格式和限制见[工作区与文件](specs/workspace.md#标签页存储)。
- `NativeMenu.PopupNativeMenu` 在调用窗口的页面坐标显示原生菜单，返回选中项 ID 或空字符串；页面最多传 64 项，ID 唯一。正文的 WebView 右键菜单由 `Page.OnContextMenu` 裁剪，见[安全](#安全)。
- 搜索通过 `Workspace.Search(request)` 和 `*mygo.Channel[SearchPart]` 流式返回匹配行与最终汇总；请求只带 generation、查询和两个选项，不带路径。扫描范围、上限、取消和 UTF-16 位置协议见[工作区与文件](specs/workspace.md#搜索)。
- `Assets` 提供 `PasteImage(docPath, generation)` 和 `ImportImages(docPath, generation, dropToken)`，返回保存后的工作区相对路径和 Markdown。粘贴时 Go 先读剪贴板里的本地文件列表；列表非空时只导入其中的图片，没有图片就返回“剪贴板没有图片”，只有列表为空时才读 PNG 位图；拖入时 Go 从 `Window.OnFileDrop` 保存的路径中按一次性 token 取文件。同一个原生 drop 还可能带文件夹 token，页面用它调用 `Workspace.OpenDroppedFolder`。页面不接触路径，图片字节也不经过 IPC；token 规则见[拖入文件夹](specs/workspace.md#拖入文件夹)。
- `src/services/assets.ts` 封装 `Assets.PasteImage`、`Assets.ImportImages` 和 `assets:file-drop`。DOM 拖放事件本身没有路径，只用于阻止浏览器默认行为；页面通过 `assets:file-drop` 从 Go 拿到一次性 token 和落点坐标，用 `EditorHandle.containsPoint` 确认在编辑区内后才创建插入凭据。绝对路径只保存在 Go，页面不记录拖放计数。

各接口的具体语义、错误传播和背压行为见 [MyGo 参考](references/mygo.md#绑定与-ipc)。

## 安全

根据 MyGo 的[页面信任模型](references/mygo.md#页面信任模型)，从自定义协议加载的页面是受信任的，可以直接调用 Go 方法。Markdown 里的原始 HTML 如果直接渲染，就能调用这些方法去读写文件。

因此：

- 渲染出来的 HTML 一律先经过 DOMPurify 清洗。
- 沙箱 iframe 可能会额外起进程，尽量不用。
- Go 的文件服务限制见[工作区与文件](specs/workspace.md#路径守卫)。工作区内的读取、写入和文件操作都以 `os.OpenRoot` 的根为边界，并在操作前用 `filepath.EvalSymlinks` 确认目标仍在工作区内；文件树操作不能借 `..`、绝对路径、盘符路径或符号链接越出根目录。
- 全文搜索只接受 generation、查询和两个选项，没有路径或根目录参数；Go 用 `os.Root` 扫描当前根，跳过隐藏目录、`node_modules` 和符号链接，返回的行片段与匹配文字都有长度上限。切换工作区后旧搜索按 generation 停止，页面也不能把单文件授权当成搜索范围。见[搜索](specs/workspace.md#搜索)。
- 工作区外的文件采用按文件授权：`SingleFileService` 只保存用户通过原生对话框选择、或通过 `App.OnOpenFile` 提供并在页面确认后的解析绝对路径。读写只接受完全相同的路径，列出目录、访问同目录其他文件、相对路径和目录本身都拒绝；授权不跨重启保存，关闭标签页时释放。见[单文件标签页](specs/workspace.md#单文件标签页)。
- **单文件授权经崩溃恢复延续的代价**：`Recovery` 目录里可能出现用户上次已授权的单文件路径。恢复时 Go 先核对路径：必须仍是普通 `.md` 文件、没有变成符号链接、父路径未改变，文件不存在时仍允许授权以便原路径重建；通过后才授权一次。对话框选择由页面保证；Go 只保证副本 id 存在于 `recovery` 目录、路径曾被授权、每条只能恢复一次。`List` 会把曾授权路径的 `diskText` 返回给页面。因此副本最多让一条曾授权路径跨重启延续一次；如果攻击者已经能写 `recovery/` 目录或界面数据目录，本地文件的机密性和完整性已不受这层边界保护。见[崩溃恢复](specs/workspace.md#崩溃恢复)。
- 文件树的“用默认应用打开”在 Go 端按白名单分类：图片、PDF、纯文本和常见办公文档可直接打开；已知启动器类型（PATHEXT、macOS 脚本/快捷方式、Linux `.desktop` 等）直接拒绝；其他类型和 Unix 可执行文件必须先经过 Go 弹出的原生确认框，页面无法绕过。详见[文件操作](specs/workspace.md#打开方式的安全规则)。
- 系统“打开方式”传入的路径先记为“已提供”，不会自动授权；`AcceptSingleFile` 只接受已经提供的路径，页面不能凭任意字符串自行授权。打开父目录是一次性授权，成功打开后由 Go 消耗，取消或失败后由页面调用 `DismissOfferedFile` 消耗；当授权来源只是系统文件时，根目录、盘符根目录和主目录在前后端都拒绝。`app:open-file` 只是“有新文件”的信号，页面收到后调用 `TakePendingOpenedFiles` 清空队列，避免事件与启动时读取重复交付。
- 原生右键菜单只接收菜单项 ID、文字、快捷键、禁用状态和页面坐标，不接收命令或文件内容；菜单项由 Go 组装，选择结果只把 ID 返回页面。正文的 WebView 右键菜单删除“重新载入”“后退”“前进”，非开发构建还删除“检查元素”。
- 文件关联只让系统把 `.md` 路径交给 `App.OnOpenFile`；在用户于页面确认“只打开这个文件”之前，Go 不读写该文件。
- 设置存储、标签页布局、单文件授权和恢复副本都只使用 Go 的文件接口；测试和开发构建通过 `NICOLE_USER_DATA_DIR` 指向临时目录，避免修改用户正在使用的数据（见[开发](development.md#数据隔离)）。标签页布局只接受当前根目录，路径只用于显示和恢复，不能授权访问文件。应用启动时请求单实例锁；不同的 `NICOLE_USER_DATA_DIR` 使用独立的锁命名空间，因此隔离的测试/开发实例不会被误转交给安装版。
- 图片协议只映射当前工作区，handler 在启动时注册，运行时读取可替换的工作区状态。
- 图片协议的 URL 带 `generation`，切换文件夹后旧请求返回 404，不会读到新工作区里的同名文件。
- 拖入路径只从 `Window.OnFileDrop` 进入 Go；页面只能提交一次性 token，不能指定任意路径。路径筛选、过期和一次性规则见[拖入文件夹](specs/workspace.md#拖入文件夹)。
- 工作区可以在运行时关闭。`CloseWorkspace` 清空根并递增 `generation`，依赖根目录的服务返回“没有打开工作区”或 404，内存中的磁盘哈希被清除；`WorkspaceTabs` 和 `Recovery` 不再读写该根的记录，页面不能借关闭后的旧 `generation` 访问原目录。见[工作区与文件](specs/workspace.md#没有打开的根目录)。
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
