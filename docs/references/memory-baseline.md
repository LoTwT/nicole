# 内存基线

概要：记录 2026-10-31 的 MyGo 模板/编辑器演示数据和 2026-11-01 的 `main` 构建数据，供[性能预算](../specs/performance.md#预算)对照。

- 指标：`phys_footprint`，即活动监视器“内存”列使用的指标。
- 测量：[`scripts/measure-memory.sh`](../../scripts/measure-memory.sh)；调用方式和输出格式见[性能预算与测量](../specs/performance.md#测量方法)。
- 合计：主进程与所有 WebKit 子进程的 `phys_footprint` 之和，每个进程取 `footprint` 显示的 MB 值后相加。

## 2026-11-01：`main` de81760

环境：

- 日期：2026-11-01
- 提交：`de81760`（被测的 `main`）；脚本为本 PR 的 `scripts/measure-memory.sh`
- 机器：MacBookPro18,3（Apple M1 Pro，32GB 内存），arm64
- 系统：macOS 27.0.1（26A434）
- 工具链：Go 1.27.3，Bun 1.4.4，MyGo 0.7.3
- 构建：`GOTOOLCHAIN=auto bun run build -- -skip-dmg`
- 窗口：1436×929（启动后用 System Events 只读查询；窗口状态与安装版共享，默认尺寸为 1100×780）
- 屏幕：内置 Liquid Retina XDR，3024×1964；UI 逻辑分辨率 1512×982，2× 缩放
- 测量：`scripts/measure-memory.sh --budget 120`，三次独立启动；`SUMMARY` 为 `attribution=coalition`；测量时没有其他 Nicole 实例。单位为 MB。

| 次数 | 主进程 | GPU | WebContent | Networking | 合计 |
|---|---|---|---|---|---|
| 1 | 37 | 25 | 98 | 6 | 166 |
| 2 | 37 | 24 | 98 | 6 | 165 |
| 3 | 37 | 24 | 98 | 6 | 165 |
| 中位数 | 37 | 24 | 98 | 6 | **165** |

同一构建另用 `--wait 90` 复测三次，合计为 163、164、162MB，比默认的 10 秒低 2–3MB。

脚本在 `--budget 120` 下以状态 2 退出：当前空载比预算高 45MB。

### 与 109MB 的差异

2026-10-31 的 109MB 来自 MyGo 编辑器演示，不是这个仓库的构建。应用脚手架、编辑器、主题和更新插件都是此后才加入 `main` 的，且没有逐项改动的前后对比，不能把差额归到具体一项。可以确定的是分项变化：

- WebContent：50 → 98MB，是差额的主要来源。
- GPU：14 → 24MB。
- 主进程：38 → 37MB，基本不变；Networking：7 → 6MB。

默认的 10 秒与 `--wait 90` 只相差 2–3MB，不足以解释与 109MB 的差额，差异不是等待时间造成的。可能的原因：2026-10-31 的数字来自模板演示，页面内容与当前编辑器不同；当时的构建方式也没有记录，无法确认 MyGo 参数是否一致。没有逐项测量前，不把差额归到单一改动。

## 2026-10-31：MyGo 模板与编辑器演示

- 测量日期：2026-10-31
- 环境：macOS arm64
- 指标：`phys_footprint`，即活动监视器“内存”列使用的指标
- 测量方法：当时是手动步骤，等待 10 秒；没有记录构建方式。

单位为 MB。

| 应用 | 主进程 | WebKit 子进程（GPU + 页面 + 网络） | 合计 |
|---|---|---|---|
| MyGo 空模板 | 39 | 25 + 43 + 7 | **114** |
| MyGo + 编辑器演示 | 38 | 14 + 50 + 7 | **109** |
| TextEdit（对照） | 35 | — | 35 |

## 打包体积

| 产物 | 2026-10-31 | 2026-11-01 |
|---|---|---|
| `.app` | 9.9MB | 11.7MB |
| dmg | 3.2MB | 未构建（`-skip-dmg`） |

## 口径说明

- 指标和等待时间与 2026-10-31 一致（`phys_footprint`、主进程 + 所有 WebKit 子进程、启动后等待 10 秒）；进程归属方法不同（本次按 resource coalition），旧数据的构建方式未知。
- 合计是主进程与所有 WebKit 子进程的 `phys_footprint` 之和，包含 GPU、页面和网络进程；每个进程取 `footprint` 显示的 MB 值后相加。
- 2026-11-01 的 WebKit 子进程合计 128MB（GPU 24 + WebContent 98 + Networking 6），占 165MB 的绝大部分；主进程为 37MB。
- 2026-10-31 的数据里 WebKit 约 70–75MB，编辑器相对空模板只多约 7MB；当前构建的 WebContent 明显更大（见[与 109MB 的差异](#与-109mb-的差异)）。
- MyGo 官网提到的 62MB 与这里的实测口径不同，不能直接比较。
- WebKit 在启动后可能创建预热 WebContent 进程，其他应用也会在测量窗口内创建自己的 WebKit 进程。脚本按 resource coalition 只统计被测实例；默认等待 10 秒，本次用 `--wait 90` 复测低 2–3MB。
- 窗口尺寸和屏幕缩放会影响 WebContent 和 GPU 的占用；本次窗口为 1436×929，屏幕为 2× 缩放。
