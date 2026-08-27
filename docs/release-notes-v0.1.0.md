## Summary

基于官方 [Obsidian Web Clipper 1.7.1](https://github.com/obsidianmd/obsidian-clipper) 的中文增强 Fork（产品版本 **v0.1.0**）。

参考：

- [obsidian-clipper-cn](https://github.com/nextcaicai/obsidian-clipper-cn) — 微信 / 飞书 / B 站阅读模式
- [obsidian-web-clipper-cn-transcript](https://github.com/whatcccup/obsidian-web-clipper-cn-transcript) — 无字幕补齐 `{{transcript}}` 的流程（本仓库为扩展内 FunASR）

**不是** Obsidian 官方产品。

### 架构（便于后续跟官方更新）

采用 **官方主干 + `src/cn/` 叠层**：

- 官方负责模板、Interpreter、高亮、Reader、保存
- 中文增强集中在 `src/cn/`；官方文件仅保留薄 hook
- 升级官方：`npm run overlay:rebase -- <官方 tag>`，再更新版本对应表

详见仓库文档：[docs/architecture-cn.md](https://github.com/dickbk/obsidian-clipper-cn-latest/blob/main/docs/architecture-cn.md)

### 变更点与原因

| 变更 | 原因 |
| --- | --- |
| 扩展名 Obsidian Web Clipper CN | 与商店官方版区分 |
| 微信公众号正文 / 懒加载图 | 官方通用提取易残缺 |
| 飞书开放平台 API 提取 | 动态 DOM 导致内容不全 |
| B 站 Reader（嵌入 / 字幕同步 / 跳转） | 对齐官方 YouTube Reader |
| 无可用 CC 时 FunASR → `{{transcript}}` | 补齐逐字稿；不依赖必剪与 macOS Helper |
| 独立 CN 版本号 + 版本对应表 | 避免与官方号混用；可 rebase 跟进上游 |

### 版本对应

| CN 版本 | 官方 Web Clipper 基线 |
| --- | --- |
| **0.1.0** | **1.7.1** |

### 依赖

- 构建：Node.js 18+ / npm（见 `package.json`）
- 飞书（可选）：App ID / App Secret
- FunASR（无 CC 时）：千问 AI 平台 / DashScope API Key（`sk-ws-…`）
- **不依赖：** BCut、macOS Native Messaging、Faster Whisper

### 安装

1. 先禁用商店里的官方 Web Clipper
2. 下载对应浏览器 zip 并解压（目录内应有 `manifest.json`）
3. Chromium：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序
4. Firefox：`about:debugging#/runtime/this-firefox` → 临时载入 → 选择 `manifest.json`

旁加载细节：[docs/sideload-cn.md](https://github.com/dickbk/obsidian-clipper-cn-latest/blob/main/docs/sideload-cn.md)
