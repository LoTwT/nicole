# 性能预算与测量

概要：

- 内存预算按 `phys_footprint` 计算：空载不超过 120MB，打开 10 篇文档不超过 160MB，长时间使用不持续增长。
- 通过只渲染可见内容、复用 widget、懒加载、销毁后台标签页编辑器视图、限制 Go 内存等方式控制占用。
- 测量在 macOS 上用 `footprint` 汇总主进程和 WebKit 子进程。
- 基线数据见[内存基线](../references/memory-baseline.md)。

## 执行状态

自 2026-11-14 起，按用户决定暂停内存排查、测量与优化，包括每次合并后的空载测量；用户明确重启相关工作后，才在授权范围内执行本页方法。以下预算和历史结果保留，暂停不表示问题已修复或性能验收通过。

## 预算

以 `phys_footprint` 计算，口径见[内存基线](../references/memory-baseline.md#口径说明)：

| 场景 | 上限 |
|---|---|
| 空载 | 不超过 120MB |
| 打开 10 篇文档 | 不超过 160MB |
| 长时间使用 | 不持续增长 |

性能和低占用是[硬性要求](product.md#范围)。

## 控制内存的手段

- 只渲染可见内容。
- Widget 实现 `eq`，避免不必要的重建。
- 懒加载：公式、图表、代码块高亮等按需加载。
- 切到后台的标签页只保留文本和恢复所需的少量状态（选区、滚动位置、撤销历史），销毁编辑器视图（见[界面与交互](ui.md#后台标签页与恢复)）。
- 使用单窗口加标签页，避免多余的 WebKit 页面进程（见[工作区模式](workspace.md#工作区模式)）。
- Go 内存限制可通过 `GOMEMLIMIT` 配置；项目目前未主动设置该变量。
- Go 端不缓存文件内容；崩溃恢复只按绝对路径记录文件内容的 SHA-256，用于判断副本写出后磁盘是否变化。

## 测量方法

测量由 [`scripts/measure-memory.sh`](../../scripts/measure-memory.sh) 完成；启动、进程归属、取值和清理的步骤在该脚本中定义，参数和退出码见 `scripts/measure-memory.sh --help`。

```sh
scripts/measure-memory.sh --budget 120
```

输出一张按主进程、GPU、WebContent、Networking、Other 分行的表，最后一行是 `SUMMARY key=value ...`：

- `total_mb` 是与其他基线比较的数字。
- `attribution=coalition` 表示 WebKit 进程按 resource coalition 归属；只有这种结果能记为基线。`pid-diff` 是缺少 `python3` 时的退路，可能混入其他应用的进程。
- `survivor_excluded_mb` 是存活检查中被排除的进程占用；只有 `pid-diff` 模式可能非零，`coalition` 模式始终为 0。

记录基线前退出其他 Nicole 实例。窗口尺寸和屏幕缩放会影响 WebContent 和 GPU 的占用，每次基线都要在[内存基线](../references/memory-baseline.md)中写明。脚本默认创建一个临时用户数据目录，通过 `NICOLE_USER_DATA_DIR` 传给被测应用，测量不会读写 `~/Library/Application Support/Nicole/`，窗口也使用默认尺寸；需要复用一个固定目录时传 `--user-data-dir DIR`（绝对路径）。临时目录在脚本退出时删除，传入的目录保留。

脚本依赖 `footprint`，只在 macOS 上可用，**不接入 CI**：runner 的环境数据不代表真实机器。

十篇文档场景不使用上述空载流程：脚本只测空载并在结束时退出应用。2026-11-12 的验收在隔离实例中按真实的 `tabs.json` / `settings.json` 恢复十篇文档，确认十个标签和内容后，在应用前台持续 30 分钟：每分钟轮换标签、真实编辑并确认自动保存、Undo/Redo、切换三种模式和滚动；在 0/5/10/15/20/25/30 分钟对同一已核验 PID 按 resource coalition 重新发现 WebKit 助手进程，逐进程取 `footprint` 的 MB 值合计。临时采样/前台驱动不加入仓库或 CI。

历史结果：2026-11-12 的 30 分钟协议执行完成，但性能验收 **FAILED**：峰值 286MB，7 个样本全部超过 160MB，末 3 个为 261/268/286MB 且持续上升，WebContent 从 109MB 升到 217MB。协议完成不等于性能通过，也不构成当前版本的验收或合并状态。2026-11-11 的静态 155MB 是恢复后等待 60 秒、约 5 分钟窗口的结果，条件不同，不能替代该 30 分钟序列。完整环境、样本和限制见[内存基线](../references/memory-baseline.md#2026-11-12冻结构建-0ffdd47-的十标签-30-分钟前台序列)；后续工作按[执行状态](#执行状态)暂停。

## 内存基线的更新约定

仅在用户明确授权的测量范围内更新基线，不再因界面 PR 合并而自动测量。需要记录空载时，在指定构建上运行 `scripts/measure-memory.sh --budget 120`，保存 `total_mb`、`attribution`、构建提交和度量环境，与[内存基线](../references/memory-baseline.md)最近的同场景记录比较。`total_mb` 高出 10MB 或更多时，在报告中说明变化和条件差异，并由用户确认下一步；单次测量不自动扩大为优化任务。
