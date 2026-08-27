# Obsidian Web Clipper CN

> 基于官方 [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) 的 Fork，专门为中文内容平台增强。  
> 本仓库由 [@dickbk](https://github.com/dickbk) 维护：**不是** Obsidian 官方产品。

- 上游官方仓库：[obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)
- 中文增强参考：[nextcaicai/obsidian-clipper-cn](https://github.com/nextcaicai/obsidian-clipper-cn)（微信 / 飞书 / B 站阅读模式）
- 无字幕转写参考：[whatcccup/obsidian-web-clipper-cn-transcript](https://github.com/whatcccup/obsidian-web-clipper-cn-transcript)（流程与产品思路；原使用必剪 BCut 免费额度有限额，本仓库改为扩展内 FunASR - 多ASR比较后是当前性价比最高的方案，不依赖 macOS Helper）

## 架构方案（便于跟随官方更新）

本仓库采用 **官方主干 + CN Overlay** 架构，而不是平行重写：

- 官方负责模板、Interpreter、高亮、Reader、保存到 Obsidian
- `src/cn/` 集中实现微信 / 飞书 / B 站 / FunASR 等中文增强
- 仅在少数官方文件中保留薄 hook（`content` / `clip-utils` / `reader` / `background` / `popup` / `settings`）
- 升级官方时：对官方 tag 做 `npm run overlay:rebase -- <官方版本>`，解决 hook 冲突后更新下方版本表

完整说明（目录职责、hook 清单、rebase 步骤、验证清单）：[`docs/architecture-cn.md`](docs/architecture-cn.md)。

## 版本对应表（跟随官方更新）

本仓库使用**独立产品版本号**；浏览器扩展 `manifest.version` 与 GitHub Release tag 一致。  
「官方基线」记录本版本基于哪一版 [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) 源码 / tag。

| CN 版本 | 官方 Web Clipper 基线 | 说明 |
| --- | --- | --- |
| **0.1.0** | **1.7.1** | 首发：官方 1.7.1 + 中文叠层（微信 / 飞书 / B 站）+ FunASR 无 CC 转写 |

后续跟随官方升级时：

1. `git fetch upstream --tags` → `npm run overlay:rebase -- <新官方 tag>`
2. 按 [`docs/architecture-cn.md`](docs/architecture-cn.md) 检查 hook 与回归
3. 更新本表、`package.json`、`src/manifest.*.json` 中的 **CN 产品版本**（不要把 manifest 改回官方号）
4. 发 Release，正文写明新的官方基线

## 与官方版本有什么不同？

| 变更点 | 原因 |
| --- | --- |
| 扩展显示名改为 **Obsidian Web Clipper CN** | 与商店官方扩展区分，避免同时安装时混淆 |
| 微信公众号（`mp.weixin.qq.com`）正文与懒加载图片归一化 | 官方通用提取器常只拿到首图或残缺正文 |
| 飞书 / Lark 文档走开放平台结构化 API | 官方 DOM 解析在飞书动态渲染下内容不完整 |
| B 站阅读模式：播放器嵌入、字幕滚动 / 高亮、时间戳跳转 | 对齐官方 YouTube Reader 体验 |
| 无平台字幕时，用 **千问 AI 平台 Fun-ASR** 生成 `{{transcript}}` | 参考 transcript 项目「补齐逐字稿、写回原变量」的流程；本仓库在扩展内完成，跨 Windows / macOS，不依赖必剪额度与本地 Helper |
| 旁加载安装（Release zip） | 中文增强无法进入官方商店渠道，需开发者模式加载 |

### 为什么没有合并到官方？

官方维护者曾指出：针对特定网站的提取器更适合放在 [Defuddle](https://github.com/kepano/defuddle)。B 站阅读模式与 ASR 叠层需要扩展侧能力，因此独立维护本 Fork。

## 依赖说明

### 构建依赖（开发者）

- Node.js 18+（建议 20+）
- npm（见根目录 `package.json`）
- 主要运行时库与官方一致：`defuddle`、`dayjs`、`dompurify`、`lz-string`、`lucide`、`webextension-polyfill` 等

### 运行时外部服务（按功能可选）

| 功能 | 依赖 | 说明 |
| --- | --- | --- |
| 普通网页剪藏 | 无额外账号 | 行为对齐官方 1.7.1 |
| 飞书完整文档 | 飞书开放平台 App ID / App Secret | 权限：`docx:document:readonly`、`wiki:node:read`；凭证仅存本地 `browser.storage.local` |
| 微信公众号图片 | 无额外账号 | 需能正常打开公众号文章页 |
| B 站有 CC 字幕 | 无额外账号 | 继续用原生 `{{transcript}}` |
| B 站无 CC / 不可用 CC | **千问 AI 平台 / DashScope API Key**（`sk-ws-…`） | 音频经临时存储上传后由 Fun-ASR 识别；约按量计费，详见[千问 Fun-ASR](https://www.qianwenai.com/models/fun-asr) |

本仓库**不**依赖：必剪 BCut 免费额度（有额度限制，换成高性价比FunASR）、macOS Native Messaging Helper、本地 Faster Whisper。

## 快速开始

> **普通用户请走「方式一」**：不需要 Node.js，也不需要 `npm`。

### 方式一：下载 Release 压缩包（推荐）

前往 [Releases](https://github.com/dickbk/obsidian-clipper-cn-latest/releases) 下载：

- `obsidian-clipper-cn-*-chrome.zip` — Chrome、Brave、Edge、Arc 等 Chromium 浏览器
- `obsidian-clipper-cn-*-firefox.zip` — Firefox
- `obsidian-clipper-cn-*-safari.zip` — Safari

解压后应直接看到 `manifest.json`。请先**禁用商店里的官方 Web Clipper**，再加载本扩展。

**Chromium：**

1. 打开 `chrome://extensions`（Edge：`edge://extensions`）
2. 开启**开发者模式**
3. **加载已解压的扩展程序**，选择解压后的文件夹

**Firefox：**

1. 打开 `about:debugging#/runtime/this-firefox`
2. **临时载入附加组件** → 选择解压目录中的 `manifest.json`

旁加载细节见 [`docs/sideload-cn.md`](docs/sideload-cn.md)。

### 方式二：从源码构建

```bash
npm install
npm run build
```

产物：`dist/`（Chromium）、`dist_firefox/`、`dist_safari/`；生产 zip 写入 `builds/`。

## 无字幕转写流程（FunASR）

1. 有可用平台字幕 → 继续用原生 `{{transcript}}`
2. 无可用 CC → 弹窗 / 阅读模式出现生成空态，并下载对应 BVID+CID 音轨
3. 使用千问 AI 平台临时存储上传音频，调用 Fun-ASR
4. 生成带时间戳逐字稿，写回 `{{transcript}}`；模板与保存流程不变

在扩展设置 → **General → Transcript generator** 中填写「千问 AI 平台 API Key」。

## 许可证与商标

源码遵循与官方一致的 [MIT License](LICENSE)。Obsidian 商标、图标与营销资产不在该许可范围内。  
本项目亦非飞书、微信、哔哩哔哩、阿里云 / 千问的官方产品。

## 官方文档（能力基线）

官方用法仍适用：

- [Documentation](https://help.obsidian.md/web-clipper)
- [Troubleshooting](https://help.obsidian.md/web-clipper/troubleshoot)
