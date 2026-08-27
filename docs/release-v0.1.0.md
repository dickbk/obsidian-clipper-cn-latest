# Release v0.1.0（草稿，上传前确认）

**Tag:** `v0.1.0`  
**扩展版本:** `0.1.0`  
**官方基线:** [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) **1.7.1**  
**仓库:** https://github.com/dickbk/obsidian-clipper-cn-latest  

## 来源说明

本版本是官方 Obsidian Web Clipper **1.7.1** 的 Fork，并参考：

- [nextcaicai/obsidian-clipper-cn](https://github.com/nextcaicai/obsidian-clipper-cn) — 微信 / 飞书 / B 站阅读模式增强
- [whatcccup/obsidian-web-clipper-cn-transcript](https://github.com/whatcccup/obsidian-web-clipper-cn-transcript) — 无字幕时补齐 `{{transcript}}` 的产品流程（本仓库实现为扩展内 FunASR，非 macOS Helper / 必剪）

**非官方声明：** 与 Obsidian、飞书、微信、B 站、千问 / 阿里云均无官方隶属关系。

## 变更点与原因

| 变更 | 原因 |
| --- | --- |
| 扩展名 Obsidian Web Clipper CN | 与商店官方版区分 |
| 微信公众号正文 / 懒加载图修复 | 官方通用提取易残缺 |
| 飞书开放平台 API 提取 | 动态 DOM 导致内容不全 |
| B 站 Reader：嵌入、字幕同步、跳转 | 对齐官方 YouTube Reader |
| FunASR 无 CC 转写并写回 `{{transcript}}` | 无平台字幕时仍可剪藏；不依赖必剪额度与本地 Helper |
| 独立版本号 0.1.0，README 版本对应表 | 避免与官方 1.7.1 版本号混用；便于后续跟进官方 |

## 依赖

- **构建：** Node.js 18+ / npm（见 `package.json`）
- **飞书（可选）：** App ID + App Secret
- **FunASR（无 CC 时）：** 千问 AI 平台 / DashScope API Key（`sk-ws-…`）
- **不依赖：** BCut、macOS Native Messaging、Faster Whisper

## 安装资源（构建后）

- `obsidian-clipper-cn-0.1.0-chrome.zip`
- `obsidian-clipper-cn-0.1.0-firefox.zip`
- `obsidian-clipper-cn-0.1.0-safari.zip`

解压后「加载已解压的扩展程序」。请先禁用官方 Web Clipper。

## 建议 Release 正文（GitHub）

```markdown
## Summary

基于官方 [Obsidian Web Clipper 1.7.1](https://github.com/obsidianmd/obsidian-clipper) 的中文增强 Fork（产品版本 **v0.1.0**）。

参考：
- [obsidian-clipper-cn](https://github.com/nextcaicai/obsidian-clipper-cn)
- [obsidian-web-clipper-cn-transcript](https://github.com/whatcccup/obsidian-web-clipper-cn-transcript)

### 变更点
- 微信公众号正文与懒加载图片
- 飞书文档开放平台完整提取
- B 站阅读模式（嵌入 / 字幕同步 / 时间戳跳转）
- 无可用 CC 时使用千问 Fun-ASR 生成 `{{transcript}}`

### 版本对应
| CN | 官方基线 |
| --- | --- |
| 0.1.0 | 1.7.1 |

### 依赖
- 飞书：App ID / Secret（可选）
- FunASR：千问 AI 平台 API Key（无 CC 时需要）

### 安装
下载对应浏览器 zip → 解压 → 开发者模式加载。请先关闭官方 Web Clipper。
```
