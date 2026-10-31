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

1. 先记录当前已经存在的 WebKit 进程。
2. 用 `open -n` 启动应用。
3. 等待 10 秒，让进程稳定下来。
4. 找出新出现的 `com.apple.WebKit.*` 进程。
5. 对这些进程和主进程分别运行 `footprint -p <pid>`，求和。

基线数据、打包体积和口径说明见[内存基线](../references/memory-baseline.md)。
