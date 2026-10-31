# 文档索引

## 文档导航

在此收录项目文档，使用相对链接并说明适用的阅读场景；新增、移动或移除文档时同步维护导航。

| 文档 | 何时阅读 |
|---|---|
| [architecture.md](architecture.md) | 了解技术选型、进程与模块结构、依赖边界、IPC 和安全约束，或确认主要风险时。 |
| [development.md](development.md) | 准备开发环境、安装依赖、启动热更新、构建 `.app`，或查看测试与 CI 命令时。 |
| [specs/product.md](specs/product.md) | 确认产品定位、命名、范围、功能分期、平台优先级和已定决策时。 |
| [specs/editor-modes.md](specs/editor-modes.md) | 实现或调整实时预览、沉浸、源码三种模式，或处理中文输入法和渲染粒度时。 |
| [specs/slash-commands.md](specs/slash-commands.md) | 添加命令、用户模板，或调整 slash 菜单、快捷键、命令面板和浮动工具栏时。 |
| [specs/workspace.md](specs/workspace.md) | 处理工作区、标签页、保存、崩溃恢复、图片和搜索时。 |
| [specs/theming.md](specs/theming.md) | 接入主题、字体或自定义 CSS，或处理亮暗切换和导出预览时。 |
| [specs/performance.md](specs/performance.md) | 评估内存占用、实现性能优化或复测基线时。 |
| [references/mygo.md](references/mygo.md) | 使用 MyGo 的绑定、IPC、插件或脚手架，或核对版本状态时。 |
| [references/memory-baseline.md](references/memory-baseline.md) | 查看 2026-10-31 的 footprint 实测数据、打包体积和口径说明时。 |
| [references/ayingott-theme.md](references/ayingott-theme.md) | 确认 `@ayingott/theme` 0.3.0 的能力、限制或字体文件问题时。 |

## 目录约定

`docs/` 下的其他文件和目录有实际内容时再创建；可沿用已有的合理结构。下表说明常见内容的归属，不限定全部可用路径，表中路径均相对于 `docs/`。

其他独立的项目级指导可用准确的主题名命名为 Markdown 文件，平铺在 `docs/` 下；需要组织多份相关文档时，可按主题建立子目录。

| 路径 | 内容归属 |
|---|---|
| `architecture.md` | 全局架构、模块关系、依赖边界与共享约束。 |
| `development.md` | 环境准备、开发方式、项目特有的编码约定、测试与验证方法。 |
| `release.md` | 版本管理、发布流程、发布专属检查与发布后验证。 |
| `specs/` | 专项需求、设计、必要的调研结论与取舍依据、接口合同、验收标准。 |
| `references/` | 供查阅的领域资料、第三方约束与资料来源，由相关规格或实现引用。 |
| `decisions/` | 需要独立保存的重要决策历史、当时的背景与取舍。 |

## 内容维护

- 全局结构与共享约束由架构文档维护，具体功能的设计与行为由相关规格维护。
- 日常开发与验证方法归入 `development.md`，发布流程引用共用的方法或已有脚本，仅单独说明发布所需的步骤与检查。
- 参考资料保留事实与来源；被项目采用的设计选择和约束写入相关规格，并引用支撑资料。
- 简短的设计理由直接写在相关规格中；需要独立追溯决策时再创建 `decisions/` 中的记录，由当前规格引用。
- 较长的文档在开头给出概要或章节结构，便于按章节查阅。
- 草案与尚未确认的内容明确标注；被替代的决策指向后续决定，保留必要的历史背景。
