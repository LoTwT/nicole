import { readFileSync } from "node:fs";

const release = JSON.parse(readFileSync(process.argv[2], "utf8"));
const match = /^(test-v|v)(\d+\.\d+\.\d+)$/.exec(release.tag_name);
if (!match) throw new Error(`Unsupported release tag: ${release.tag_name}`);

const [, prefix, version] = match;
const start = "<!-- nicole-downloads:start -->";
const end = "<!-- nicole-downloads:end -->";
const testWarning = "测试版，勿用：此版本只用于自动更新渠道的联调，正式使用请安装最新正式版。";

function download(name) {
  const asset = release.assets.find((asset) => asset.name === name);
  if (!asset?.browser_download_url) {
    throw new Error(`Missing download asset: ${name}`);
  }
  return asset.browser_download_url;
}

let body = release.body ?? "";
const blockStart = body.indexOf(start);
if (blockStart !== -1) {
  const blockEnd = body.indexOf(end, blockStart);
  if (blockEnd === -1) throw new Error("Unclosed Nicole downloads section");
  body = body.slice(0, blockStart) + body.slice(blockEnd + end.length);
}
body = body.trim();
// Older test releases put this warning directly in the original notes.
if (prefix === "test-v" && body.startsWith(testWarning)) {
  body = body.slice(testWarning.length).trimStart();
}

const lines = [start];
if (prefix === "test-v") lines.push(testWarning, "");
lines.push(
  "## 下载安装",
  "",
  "| 系统 | 适用设备 | 安装包 |",
  "| --- | --- | --- |",
  `| **macOS** | Apple Silicon / Intel 通用 | **[下载 DMG](${download(`nicole-${version}.dmg`)})** |`,
  `| **Windows** | x64（Intel / AMD） | **[下载 EXE](${download(`nicole-setup-${version}-amd64.exe`)})** |`,
  `| **Linux** | Debian / Ubuntu · x64 | **[下载 DEB](${download(`nicole_${version}_amd64.deb`)})** |`,
  "",
  `Linux 也可使用 [tar.gz 安装版](${download(`nicole-${version}-linux-amd64.tar.gz`)})（x64，支持应用内更新）；DEB 安装版需手动升级。`,
  "",
  "<details>",
  "<summary>安装提示与文件校验</summary>",
  "",
  "- **macOS**：安装包使用 ad-hoc 签名且未公证，首次打开可能出现系统安全提示。",
  "- **Windows**：安装包未签名，首次打开可能出现系统安全提示。",
  `- **文件校验**：下载 [SHA256SUMS](${download("SHA256SUMS")})，核对下载文件的 SHA-256。`,
  "",
  "下方 Assets 还包含自动更新清单、更新归档和安装脚本；直接安装请使用上面的链接。",
  "",
  "</details>",
  "",
  "## 更新内容",
  end,
  "",
  body,
);
process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
