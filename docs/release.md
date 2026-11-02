# 发布与自动更新

更新日期：2026-11-01。本文维护 Nicole 的版本规则、两条发布渠道、打标签与发布步骤、更新密钥管理、Release 资产一览和发布后验证清单；本地构建与打包 workflow 的用法见[开发指南](development.md#打包与自动更新)，MyGo 0.7.3 的事实与来源见 [MyGo 参考](references/mygo.md#分发)、[自动更新](references/mygo.md#自动更新)和 [GitHub Actions](references/mygo.md#github-actions)。发布由 `LoTwT/nicole` 的 GitHub Releases 承担，也是 MyGo 内置更新的下载源。

## 版本号与两条渠道

- **版本号**：`major.minor.patch`（语义化）。仓库里的 `mygo.config.ts` 保持开发版本 `0.0.1`，发布时**以标签中的版本为准**：Release workflow 从标签取出版本和渠道前缀，通过环境变量 `NICOLE_RELEASE_VERSION` 与 `NICOLE_RELEASE_TAG_PREFIX` 传给 `mygo.config.ts`，不为发版提交版本号改动。
  - 这种方式不向检出目录写入任何过程文件，`git status` 始终干净；Go 的 VCS 戳记因此不会带上 `-modified`，构建日志与 `mygo.App.Version()` 都和标签一致。youkai（MyGo 0.6.2，`mygo.json`）用的是 `git update-index --skip-worktree` 加改写配置；Nicole 不需要这一步。
  - 两个变量必须同时设置；只设置一个时配置加载直接失败。缺省值分别是 `0.0.1` 和 `v`。
- **测试渠道**：标签 `test-v<版本>`（如 `test-v0.0.1`）。发布为**普通 Release**——MyGo 更新器只接受已发布、非草稿、非预发布的版本——但**不设为 latest**，标题与说明注明“测试版，勿用”。测试渠道构建的应用只检查 `test-v` 标签的 Release：`updates.tagPrefix` 为 `test-v`，MyGo 通过 GitHub API 找该前缀下最新的非草稿、非预发布 Release。
- **正式渠道**：标签 `v<版本>`（如 `v0.0.1`）。`updates.tagPrefix` 为 `v` 时，MyGo 把它当作“无前缀”：正式渠道构建读仓库 **latest Release** 的更新清单。因此测试版释放时一律 `--latest=false`，正式版发布时必须 `--latest=true`。
  - **第一个正式版必须以 latest 发布**。GitHub 在仓库没有显式 latest 时，`releases/latest` 会回退到最新发布的非草稿、非预发布 Release；所以在首个 `v*` 之前，唯一的测试版仍可能被 `releases/latest` 当作 latest。测试渠道构建只按 `test-v` 前缀查找，不会读到它；但正式渠道尚无安装时，这个回退不影响任何应用。首个正式版发布后，latest 应恒指向正式版。
- **渠道隔离靠 `updates.tagPrefix`**：前缀由 workflow 按标签写入，应用内嵌的更新源随渠道固定。同一把更新密钥签名两个渠道，公钥自 `0.0.1` 随包内置；晚加或更换公钥需要用户手动重装一次。
- **更新说明**：每个发布版本在 [CHANGELOG.md](../CHANGELOG.md) 有 `## <版本号>` 小节（两个渠道共用同一版本号的小节），小节文字进入该版本的更新清单（`update-*.json` 的 `notes`），即应用内“发现新版本”时显示的说明。**缺失对应小节时发布构建失败**，草稿 job 也会在构建前先检查。

## 更新配置与密钥

`mygo.config.ts` 的 `updates`：

```ts
updates: {
  publicKey: "JUV50KDgCfG2HqXbO0rr+Qrx6xzWTvX59BCg5gGHo+0=",
  github: "LoTwT/nicole",
  tagPrefix: "v", // Release workflow 按标签注入 test-v
}
```

- 公钥与私钥为 Ed25519 对（`mygo keygen` 生成；私钥文件是 `mygo-update.key` 的内容）。**私钥只存于用户的密码管理器和仓库 secret `MYGO_UPDATER_PRIVATE_KEY`，绝不进仓库，也不交给 agent**。丢失私钥会使已安装应用无法再收到更新（搁浅，只能让用户手动重装新公钥的版本）；泄露则任何持有者都能向用户推送任意代码。
- 发布构建必须带 `MYGO_UPDATER_PRIVATE_KEY`；私钥与 `updates.publicKey` 不匹配时构建失败，发布 workflow 缺私钥也会失败。
- 平台签名不新增任何 secret：macOS 使用 ad-hoc 签名，不配置 Developer ID 与公证；Windows 不签名。见[不依赖付费证书的分发路线](#不依赖付费证书的分发路线)。
- 应用侧使用 MyGo 的 `updater.Plugin`（`main.go`），提供 Sparkle 风格更新窗口和“检查更新…”菜单项；哪些构建能检查更新由 MyGo 决定，见 [MyGo 参考](references/mygo.md#自动更新)。
- 各平台的更新归档、差量和清单由 `mygo build` 生成，发布资产见下表；生成规则见 [MyGo 参考](references/mygo.md#自动更新)。

## 文件关联

`mygo.config.ts` 的 `fileAssociations` 声明 `.md` 为 Markdown 文档，系统因此可以在“打开方式”中列出 Nicole，并把双击的 `.md` 路径交给 `App.OnOpenFile`。打包时 MyGo 会把它写进各平台的安装信息：macOS 的 `Info.plist`（`CFBundleDocumentTypes`）、Windows 安装包的注册表项和 Linux 的 `.desktop` 文件与 MIME 声明。它不改变更新清单、签名或 Release 资产；打包后仍按原检查核对 `.app`、EXE 和 `.deb` 的版本与架构。

发布前手测一次：把测试 `.md` 文件拖到构建出的 `.app` 或从“打开方式”选择 Nicole，确认收到 `app:open-file`；不要用 `/Applications` 里的正式安装来测试开发构建。Windows 和 Linux 的安装后关联仍待实测，见[发布后验证](#发布后验证)。

## 发布步骤

1. 确认目标版本号已在 [CHANGELOG.md](../CHANGELOG.md) 有小节、相对上一发布版递增，且要发布的提交已合并 `main`。
2. 在合并提交上打标签并推送（由主会话在用户批准后执行）：
   - 正式版：`git tag v0.0.2 && git push origin v0.0.2`
   - 测试版：`git tag test-v0.0.2 && git push origin test-v0.0.2`
3. `Release` workflow（[release.yml](../.github/workflows/release.yml)）由标签触发：
   1. **草稿 job**：校验标签（`test-v`/`v` + `major.minor.patch`）、CHANGELOG 小节，并用与构建相同的环境变量求值 `mygo.config.ts`，确认版本、`updates.github`（必须是本仓库）与 `tagPrefix` 正确；然后创建该标签的草稿 Release，三个平台 job 上传到同一草稿。
   2. **macOS job**（`macos-latest`）：`mygo build -platform darwin/universal -upload`，私钥经 `MYGO_UPDATER_PRIVATE_KEY`，`GH_TOKEN` 供上传；校验 `.app`、DMG、通用架构、Info.plist 版本、ad-hoc 签名、归档与清单（清单版本等于标签，归档 URL 指向本标签）。
   3. **Windows job**（`ubuntu-latest`，先安装 NSIS 与 7-Zip）：`mygo build -platform windows/amd64 -upload`；校验 EXE、NSIS 安装包、`install.ps1`、归档与清单。
   4. **Linux job**（`ubuntu-latest`）：`mygo build -platform linux/amd64 -upload`；校验可执行文件、`.deb`（版本字段等于标签）、`install.sh`、归档与清单。
   5. **发布 job**（三个平台都成功后）：校验 Release 资产齐全，下载三份清单核对版本与标签，按实际资产重新生成并复核 `SHA256SUMS`；测试渠道以 `--draft=false --prerelease=false --latest=false` 发布，标题“Nicole <版本>（测试版，勿用）”，说明前加警示；正式渠道以 `--draft=false --prerelease=false --latest=true` 发布，标题“Nicole <版本>”。
4. 失败处理：单平台失败可用 “Re-run failed jobs” 重跑，重跑以 `--clobber` 覆盖同一草稿里的同名资产；草稿 job 幂等（Release 已存在则不重建）。发布 job 会在发布前按实际资产重新生成并复核 `SHA256SUMS`：Release 上没有该文件时直接重建；复核发现缺行时补回，发现平台文件哈希与 MyGo 记录不一致时失败并指出应重跑的平台 job。GitHub Actions 的 “Re-run failed jobs” 会重跑失败的 job 及其下游依赖，单个 job 的 “Re-run job” 也会重跑该 job 及其 dependent jobs（见 [REST API 说明](https://docs.github.com/rest/actions/workflow-runs#re-run-a-job-from-a-workflow-run)），所以按提示重跑平台 job 即可，发布 job 会自动重跑，不需要再手动重跑；不要手动发布草稿。标签或 CHANGELOG 问题需要删远端标签重打（由主会话执行）或补小节后重新推送标签触发；已推送的标签不要在原标签上强推覆盖。
5. **首次发布重点看**：`MYGO_UPDATER_PRIVATE_KEY` 是否就位（否则三个平台在构建/校验阶段失败）；Windows job 的 NSIS 是否安装成功；Linux job 的 `.deb` 是否生成；发布 job 的资产清单是否与下表一致；发布后 latest 是否指向正式版。

Release 资产一览（`<版本>` 为标签版本，表列为 GitHub 上的存储名）：

| 文件 | 说明 |
| --- | --- |
| `nicole-<版本>.dmg` | macOS 通用安装镜像（ad-hoc 签名） |
| `nicole-setup-<版本>-amd64.exe` | Windows NSIS 每用户安装包（未签名） |
| `nicole_<版本>_amd64.deb` | Linux Debian 包（更新边界见[参考](references/mygo.md#自动更新)） |
| `nicole-<版本>-darwin-universal.tar.gz` | macOS 更新归档（签名） |
| `nicole-<版本>-windows-amd64.tar.gz` | Windows 更新归档（签名） |
| `nicole-<版本>-linux-amd64.tar.gz` | Linux 更新归档（签名；`install.sh` 安装用） |
| `update-darwin-universal.json` / `update-windows-amd64.json` / `update-linux-amd64.json` | 各平台更新清单（版本、说明、签名，缓存禁用） |
| `install.sh` / `install.ps1` | 安装脚本（macOS/Linux 共用 `install.sh`） |
| `SHA256SUMS` | 安装包、归档与脚本的 SHA-256 清单 |
| `nicole-<旧>-to-<版本>-<target>.delta` | 差量更新（可选；首版没有） |

MyGo 0.7.3 的文件名都不含空格（youkai 的 0.6.2 是 `Youkai 0.0.1 arm64.dmg`、`Youkai Setup 0.0.1 amd64.exe`）。GitHub 上传时仍会把文件名中的空格存成 `.`，发布 job 的资产校验因此按“空格转 `.`”后的存储名比对；当前这些名字转换后不变。

## 不依赖付费证书的分发路线

首版不购买 Apple Developer Program 或 Windows 代码签名证书，也不新增任何证书相关的 secret。

| 平台 | 路线 | 实际影响 | 状态 |
| --- | --- | --- | --- |
| macOS | MyGo 默认的 ad-hoc 本地签名，不做公证 | 在构建它的 Mac 上可运行；从网络下载到其他 Mac 时可能被 Gatekeeper 阻止。用户可能需要右键“打开”或到“系统设置 → 隐私与安全性”中逐次允许。具体提示与可用操作取决于 macOS 版本和管理策略。 | 部分实测（2026-11-01，Apple Silicon），详见[发布后验证](#发布后验证)。 |
| Windows | 不签名 | 新制品可能出现 SmartScreen 提示；Smart App Control 或设备策略可能直接阻止运行。 | 待实测 |
| Linux | 不签名 | 没有系统级签名检查；`.deb` 只提供手工安装，未配置 apt 软件源。 | — |

- 相关限制来自 MyGo 0.7.3 的分发文档和 Apple/Microsoft 的说明：[MyGo 分发](https://mygo.egoist.dev/docs/distribution)、[Apple 打开应用](https://support.apple.com/en-us/102445)、[SmartScreen](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)、[Smart App Control](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)。
- 不能把实测结果推断到其他 macOS 版本、受管设备或其他系统；不能把“关闭整机保护”写成安装步骤，也不能承诺无提示启动或所有拦截都有“仍要运行”按钮。
- 需要改善分发信任体验时再评估 Developer ID、公证和 Authenticode；它们不在当前 PR 与首版范围内。这些签名只影响首次打开的信任提示，不改变 MyGo 更新链：更新始终由内置公钥验签。

## Linux 的更新边界

Nicole 同时发布 `.deb` 与 `.tar.gz`；发布说明必须写清两种安装方式分别由谁负责升级，不要承诺 `.deb` 用户会自动收到新版本。两者的安装位置、更新开关和签名校验条件见 [MyGo 参考](references/mygo.md#自动更新)。

## 发布后验证

以下清单在**真实发布之后**执行。`test-v0.0.1` 与 `test-v0.0.2` 已于 2026-11-01 发布并完成 macOS（Apple Silicon）实测；Windows、Linux、签名拒绝、正式渠道和部分更新行为仍待实测。正式渠道另发 `v0.0.1` 验证 latest。

2026-11-01 的实测版本（两次 release workflow 的全部 job 均成功；均为普通 Release，非草稿、非预发布，标题带“（测试版，勿用）”）：

| 版本 | Release | 构建提交 | workflow run |
|---|---|---|---|
| `test-v0.0.1` | [test-v0.0.1](https://github.com/LoTwT/nicole/releases/tag/test-v0.0.1) | `b2fac4f` | 41259415237 |
| `test-v0.0.2` | [test-v0.0.2](https://github.com/LoTwT/nicole/releases/tag/test-v0.0.2) | `545fb54` | 41262115772 |

实测环境：macOS（Apple Silicon），使用 `darwin/universal` 的 DMG。

- **资产核对** — 实测（2026-11-01，`test-v0.0.1`/`test-v0.0.2`）：两个 Release 的全部资产已下载并逐个核对 `SHA256SUMS`，全部一致；三个平台的 `update-*.json` 版本与 URL 都指向对应标签。
- **版本与渠道** — 部分实测（2026-11-01，macOS）：
  1. 实测确认测试版 0.0.1 能检测到 `test-v0.0.2`；测试版不读取正式版、正式版只检测最新正式版、首个正式版发布后测试版不会成为 `latest`：待实测。
  2. 首个正式版发布后，`https://github.com/LoTwT/nicole/releases/latest` 指向该版本；测试渠道仍按 `test-v` 前缀查找：待实测。
  - 无正式版期间，`releases/latest` 依次返回 `test-v0.0.1` 和 `test-v0.0.2`，与[上文](#版本号与两条渠道)的首个正式版前回退说明一致。
- **检测与说明** — 部分实测（2026-11-01，macOS）：0.0.1 的“检查更新…”窗口显示 0.0.2 和 CHANGELOG 中的说明；更新后的 0.0.2 在启动约 13 秒后自动检查了一次（`updater.json` 的 `lastCheck` 与进程启动时间的差值）。启动后自动检查发现新版本并显示版本号和说明：待实测。
  - 测试提示：0.0.1 在 0.0.2 发布前已启动，启动时的检查已经做过，所以本次没有自动弹窗；验证升级要在新版本发布后重启旧版本并等待启动检查完成，或直接使用“检查更新…”。检查周期见 [MyGo 参考](references/mygo.md#自动更新)。
  - 说明文字与 CHANGELOG 小节逐字一致：待实测。
- **安装与重启** — 部分实测（2026-11-01，macOS）：
  1. 从 0.0.1 安装 0.0.2 后应用自动重启，界面显示 v0.0.2，与标签一致；`Info.plist` 版本核对待实测。Windows 的文件属性或“应用和功能”、Linux 的可执行文件与菜单显示待实测。
  2. 更新后用户数据、窗口状态和历史记录保留：待实测。
  3. Windows 的 NSIS 安装目录（`%LOCALAPPDATA%\Programs\Nicole`）可写，以及“应用和功能”里的版本显示（MyGo 0.7.3 的已知限制见[参考](references/mygo.md#自动更新)）：待实测。若需要随更新刷新，列为后续工作。
- **文件关联** — 部分实测（2026-11-01，macOS 构建出的 `.app`）：用 `open -a <构建出的 .app> <临时 .md>` 打开，页面状态栏显示收到的绝对路径；Windows 注册表关联、Linux MIME 关联和未安装时的“打开方式”列表：待实测。
- **签名拒绝**：待实测。篡改清单或换密钥的归档应安装失败并显示错误，应用继续运行原版本。可用[开发指南](development.md#自动更新的本地演练)的一次性测试密钥对演练，勿用正式密钥。
- **macOS Gatekeeper** — 实测（2026-11-01，macOS Apple Silicon）：从浏览器下载的 `test-v0.0.1` DMG 安装后，首次打开被 Gatekeeper 拦截；在“系统设置 → 隐私与安全性”选择“仍要打开”后可以正常运行。更新到 `test-v0.0.2` 后打开没有再被拦截。其他 macOS 版本与受管设备待实测。
- **Windows SmartScreen**：待实测。首次运行安装包与更新后的 EXE 是否出现 SmartScreen、能否继续，需记录系统版本和策略；受管设备可能直接阻止。
- **Linux**：待实测。按[参考](references/mygo.md#自动更新)区分两种安装方式：`.tar.gz`/`install.sh` 版应能检测并安装更新；`.deb` 版不应出现后台更新检查。
- **差量更新**（从第二个版本起）— 部分实测（2026-11-01）：`test-v0.0.2` 为三个平台各生成了 0.0.1→0.0.2 的差量包，macOS 的差量包约 25KB，完整归档约 10MB。按[参考](references/mygo.md#自动更新)核对差量下载与整包回退：待实测。
