# 工作区与文件

概要：

- 工作区采用单窗口加标签页，不使用 MyGo 的 Documents API。
- 前端持有正在编辑的内容，Go 负责落盘，停止输入约 1 秒后保存。
- 崩溃恢复依赖 `PathUserData` 下的未保存内容副本。
- 拖入和粘贴的图片存到 `assets/`，图片数据不经过 IPC。
- 搜索在 MVP 阶段直接扫描文件，将来改用 SQLite FTS5 的 trigram 分词。
- 文件监听使用 MyGo 的 `watch` 插件。

## 工作区模式

只用一个窗口，用标签页切换文档。

**不用** MyGo 的 Documents API（见 [MyGo 参考](../references/mygo.md#documents-api)）：每多一个窗口就多一个 WebKit 页面进程，约多 40–50MB。内存预算见[性能](performance.md#预算)。

复用 MyGo 的文件关联和最近文档功能：双击 `.md` 文件时，打开它所在的文件夹作为工作区，并定位到这个文件。

## 保存

- **前端管正在编辑的内容，Go 管磁盘。**
- 停止输入约 1 秒后，把全文发给 Go 保存。文章很小，不需要增量同步。
- Go 先写临时文件，再改名覆盖目标文件，避免中途失败留下半个文件。
- 自动保存在三种编辑模式下都生效（见[编辑模式](editor-modes.md#所有模式共用的能力)）。

## 崩溃恢复

Go 在 `PathUserData` 目录下保存未保存内容的副本，用于崩溃恢复。

## 图片

| 来源 | 做法 |
|---|---|
| 拖入文件 | 用 `onFileDrop` 拿到文件路径，由 Go 复制。 |
| 粘贴 | 由 Go 直接读取系统剪贴板。 |

- 图片存到工作区的 `assets/` 目录。
- 在 Markdown 中插入相对路径。
- 图片数据都不经过 IPC，因为 MyGo 会把 `[]byte` 转成 base64 再传输。
- 显示图片时，用 `mygo.Protocol.Handle` 注册自定义协议；协议的范围和访问限制见[安全](../architecture.md#安全)。

## 搜索

- MVP 阶段由 Go 直接扫描文件，通过 Channel 流式返回结果（见 [IPC 用法](../architecture.md#ipc-用法)）。
- 文件多了以后再上 SQLite FTS5，使用 **trigram 分词**；默认分词器切不开中文。

## 文件监听

使用 MyGo 的 `watch` 插件监听工作区变化。插件的能力和默认参数见 [MyGo 参考](../references/mygo.md#插件)。
