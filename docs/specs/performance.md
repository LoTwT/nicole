# 性能预算与测量

概要：

- 内存预算按 `phys_footprint` 计算：空载不超过 120MB，打开 10 篇文档不超过 160MB，长时间使用不持续增长。
- 通过只渲染可见内容、复用 widget、懒加载、销毁后台标签页编辑器视图、限制 Go 内存等方式控制占用。
- 测量在 macOS 上用 `footprint` 汇总主进程和 WebKit 子进程。
- 基线数据见[内存基线](../references/memory-baseline.md)。

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
- Go 端设置 `GOMEMLIMIT`。
- Go 端不缓存文件内容。

## 测量方法

测量由 [`scripts/measure-memory.sh`](../../scripts/measure-memory.sh) 完成；启动、进程归属、取值和清理的步骤在该脚本中定义，参数和退出码见 `scripts/measure-memory.sh --help`。

```sh
scripts/measure-memory.sh --budget 120
```

输出一张按主进程、GPU、WebContent、Networking、Other 分行的表，最后一行是 `SUMMARY key=value ...`：

- `total_mb` 是与其他基线比较的数字。
- `attribution=coalition` 表示 WebKit 进程按 resource coalition 归属；只有这种结果能记为基线。`pid-diff` 是缺少 `python3` 时的退路，可能混入其他应用的进程。
- `survivor_excluded_mb` 是存活检查中被排除的进程占用；只有 `pid-diff` 模式可能非零，`coalition` 模式始终为 0。

记录基线前退出其他 Nicole 实例。窗口尺寸和屏幕缩放会影响 WebContent 和 GPU 的占用，每次基线都要在[内存基线](../references/memory-baseline.md)中写明；脚本启动的实例与安装版共用用户数据目录（退出时会写窗口状态），这一点目前无法避免。

脚本依赖 `footprint`，只在 macOS 上可用，**不接入 CI**：runner 的环境数据不代表真实机器。

## 内存基线的更新约定

可能影响内存的 PR 合并后，在最新的 `main` 上构建 `.app`，运行 `scripts/measure-memory.sh --budget 120` 测一次空载，把 `total_mb`、`attribution`、构建提交和度量环境写进 PR 描述；与[内存基线](../references/memory-baseline.md)的最新数字比较，差异明显时说明原因。
