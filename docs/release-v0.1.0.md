# Release v0.1.0（上传前确认）

**Tag:** `v0.1.0`  
**扩展版本:** `0.1.0`  
**官方基线:** [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) **1.7.1**  
**仓库:** https://github.com/dickbk/obsidian-clipper-cn-latest  
**Release URL（创建后）:** https://github.com/dickbk/obsidian-clipper-cn-latest/releases/tag/v0.1.0  

当前状态：仓库 `main` 已有功能代码；**尚无 Release**；架构说明等文档仍在本地未推送。

---

## 上传步骤（确认后按序执行）

### 0. 前置检查

- [x] 公开仓库已存在：`dickbk/obsidian-clipper-cn-latest`
- [x] `gh` 已登录为 `dickbk`
- [x] 本地 zip 已构建（见下方 Assets）
- [ ] 将架构 / README 等文档提交并 push 到 `main`（与 Release 正文链接一致）
- [ ] 创建 GitHub Release `v0.1.0` 并上传 3 个 zip

### 1. 提交并推送文档（若尚未上 main）

包含：

- `docs/architecture-cn.md`（官方主干 + CN 叠层 / rebase 流程）
- `README.md`（架构摘要 + 版本对应表升级步骤）
- `docs/sideload-cn.md` / `docs/release-v0.1.0.md` / `scripts/readme.md`

```powershell
git add README.md docs/architecture-cn.md docs/sideload-cn.md docs/release-v0.1.0.md scripts/readme.md
git commit -m "Docs: CN overlay architecture for following official releases."
git push origin-cn HEAD:main
```

### 2. 创建 Release 并上传压缩包

```powershell
& "$env:ProgramFiles\GitHub CLI\gh.exe" release create v0.1.0 `
  builds/obsidian-clipper-cn-0.1.0-chrome.zip `
  builds/obsidian-clipper-cn-0.1.0-firefox.zip `
  builds/obsidian-clipper-cn-0.1.0-safari.zip `
  --repo dickbk/obsidian-clipper-cn-latest `
  --title "v0.1.0 — based on official Web Clipper 1.7.1" `
  --notes-file docs/release-notes-v0.1.0.md
```

说明：`docs/release-notes-v0.1.0.md` 为下面「GitHub Release 正文」的纯正文副本（无本确认清单）。确认后会先写出该文件再执行上传。

### 3. 上传后核对

- Release 页可见 3 个 zip
- 正文含：官方基线 1.7.1、架构叠层说明、版本对应表、依赖、安装步骤
- 链接可打开仓库内 `docs/architecture-cn.md`

---

## Assets（将上传）

| 文件 | 约大小 | 用途 |
| --- | --- | --- |
| `obsidian-clipper-cn-0.1.0-chrome.zip` | 4.17 MB | Chrome / Brave / Edge / Arc |
| `obsidian-clipper-cn-0.1.0-firefox.zip` | 4.17 MB | Firefox |
| `obsidian-clipper-cn-0.1.0-safari.zip` | 4.17 MB | Safari |

**不上传：** 旧名 `obsidian-web-clipper-1.7.1-*.zip`、源码树、`.cursor/`。

---

## GitHub Release 正文（拟发布）

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
