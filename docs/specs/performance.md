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
- 切到后台的标签页只保留文本，销毁编辑器视图。
- 使用单窗口加标签页，避免多余的 WebKit 页面进程（见[工作区模式](workspace.md#工作区模式)）。
- Go 端设置 `GOMEMLIMIT`。
- Go 端不缓存文件内容。

## 测量方法

测量由 [`scripts/measure-memory.sh`](../../scripts/measure-memory.sh) 完成。启动、进程归属、取值和清理的步骤只在该脚本的注释与实现中定义；本节给出调用方式和输出契约。

```sh
scripts/measure-memory.sh --budget 120
```

- 默认启动 `build/<os>-<arch>/Nicole.app`；`--app PATH` 指定其他 `.app`，`--wait SECONDS` 改启动后的等待时间（默认 10）。
- 输出一张按主进程、GPU、WebContent、Networking、Other 分行的表，最后一行是 `SUMMARY key=value ...`；`total_mb` 是与其他基线比较的数字。
- 脚本只结束它自己启动的实例。其他应用的 WebKit 子进程按 resource coalition 排除；缺少 `python3` 时退回 PID 差分并告警。
- `--budget MB` 在合计超过阈值时以状态 2 退出；前置条件或测量失败以状态 1 退出。

默认等待 10 秒；机器较慢或数字明显波动时可以用 `--wait` 加长：

```sh
scripts/measure-memory.sh --wait 90 --budget 120
```

本次 10 秒与 90 秒的合计一致（见[内存基线](../references/memory-baseline.md#口径说明)）。同时运行的安装版或 `mygo dev` 实例会干扰测量（实测合计约 121–140MB）；记录基线前先退出这些实例。

脚本依赖 `footprint`，只在 macOS 上可用，**不接入 CI**：runner 的环境数据不代表真实机器。

## 内存基线的更新约定

可能影响内存的 PR 合并后，在最新的 `main` 上构建 `.app`，运行 `scripts/measure-memory.sh --budget 120` 测一次空载，把 `total_mb`、构建提交和度量环境写进 PR 描述；与[内存基线](../references/memory-baseline.md)的最新数字比较，差异明显时说明原因。
