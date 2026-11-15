# Nicole

<img src="src/assets/brand-mark.png" width="96" alt="Nicole 图标" />

Nicole 是一款面向个人文章和文档的轻量桌面 Markdown 编辑器，支持 macOS、Windows 和 Linux。文件保持普通 `.md` 源码，可以继续用 Git 管理，也可以交给其他编辑器打开。

基于 MyGo、Vue 3 和 CodeMirror 6，界面运行在系统 WebView 中。

[下载与版本记录](https://github.com/LoTwT/nicole/releases) · [文档索引](docs/index.md)

下面介绍当前源码中的功能，已发布安装包的功能以对应版本说明为准。

## 当前能力

- 实时预览、沉浸和源码三种编辑模式，支持 Slash 命令、格式快捷键和可选工具栏。
- 文件夹工作区、多标签、文件树和工作区外单个 Markdown 文件；自动保存与崩溃恢复。
- 大纲与查找替换；工作区内可搜索全文、补全链接，并在重命名时更新引用。
- GFM 表格可视编辑、代码语言高亮、KaTeX 公式、Mermaid 图、可折叠 Callout 和 Frontmatter 表单。
- 在工作区文档中粘贴或拖入图片，保存到工作区根目录的 `assets/` 并插入相对路径。
- 专注和打字机模式、字数与阅读时间、标签排序、只读文档对照及同步滚动。
- 亮暗主题、字体和阅读尺寸、自定义快捷键、受限正文 CSS。
- 导出自包含 HTML、PDF，或复制为富文本。

功能边界见[产品范围](docs/specs/product.md)、[编辑模式](docs/specs/editor-modes.md)与[文档工具](docs/specs/document-tools.md)。

## 开发

先按[环境要求](docs/development.md#环境要求)安装 Go、Bun 和所在平台所需的 WebView 依赖。MyGo CLI 随项目依赖安装。

以下命令使用 Bash 或 Zsh 语法：

```sh
git clone https://github.com/LoTwT/nicole.git
cd nicole
bun install --frozen-lockfile
GOTOOLCHAIN=auto bun run dev
```

这会生成前端调用接口，启动 Vite 和原生开发应用。前端修改走热更新，Go 代码修改后自动重新构建。环境配置、数据隔离和客户端生成的细节见[开发指南](docs/development.md)。

## 本地构建

构建关闭自动更新的本地测试包：

```sh
NICOLE_DISABLE_UPDATES=1 GOTOOLCHAIN=auto bun run build
```

产物放在 `build/<os>-<arch>/`，比如 Apple Silicon 上的应用位于 `build/darwin-arm64/Nicole.app`。默认构建当前平台，跨平台打包、签名和正式发布见[开发指南](docs/development.md#构建)及[发布说明](docs/release.md)。

## 检查

在项目根目录运行：

```sh
bun run typecheck
bun run test
gofmt -l .
GOTOOLCHAIN=auto go vet ./...
GOTOOLCHAIN=auto go test ./...
```

完整检查范围见[测试与检查](docs/development.md#测试与检查)。

## 文档

- [文档索引](docs/index.md)：按阅读场景查找规格和参考资料。
- [产品定位与范围](docs/specs/product.md)：功能分期和已定决策。
- [架构](docs/architecture.md)：技术选型、目录结构、模块边界和 IPC。
- [界面与交互](docs/specs/ui.md)：布局、命令、快捷键和设置。
- [文档工具](docs/specs/document-tools.md)：Frontmatter、导出和富文本复制。

第三方软件与图标的声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 和 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)。
