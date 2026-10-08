## Summary

基于官方 [Obsidian Web Clipper 1.7.1](https://github.com/obsidianmd/obsidian-clipper) 的中文增强 Fork（产品版本 **v0.1.1**）。本版新增 **小红书** 适配。

**不是** Obsidian 官方产品。

### 新增：小红书剪藏

| 能力 | 说明 |
| --- | --- |
| 图文笔记 | 全部图片以稳定原图链接写入 |
| 视频笔记 | 写入 `<video>` 播放链接与封面，不把视频文件下载进 vault（与 YouTube 做法一致） |
| PC 网页弹窗模式 | 从页面运行时状态读取当前打开的笔记，不再混入其他笔记内容 |
| 点点 AI 官方解读 | 评论区「点点」的逐字稿 / 总结写入「官方解读（点点）」小节 |
| 视频逐字稿 | 弹窗点 **Generate transcript**，视频地址直接交给千问 Fun-ASR 拉取（不经本机下载上传），多条 CDN 线路依次尝试 |

参考：[xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) —— 借鉴其从 `window.__INITIAL_STATE__.note.noteDetailMap` 读取笔记的思路与字段；**未**引入其代码，不做登录自动化、搜索或发布。

### 注意事项

- 图片与视频是小红书 CDN 外链，不是本地文件；平台删除或改链后可能失效
- 「点点」回复受平台限制约 1000 字，长视频常被截断；以 Fun-ASR 逐字稿为准
- Fun-ASR 按量计费，需在设置中填写千问 AI 平台 / DashScope API Key；专有名词可能识别有误
- 仅读取你当前能正常浏览的页面数据，不绕过登录、不批量抓取；请遵守小红书用户协议与内容版权

### 版本对应

| CN 版本 | 官方 Web Clipper 基线 |
| --- | --- |
| **0.1.1** | **1.7.1** |
| 0.1.0 | 1.7.1 |

### 安装

1. 先禁用商店里的官方 Web Clipper  
2. 下载对应浏览器 zip 并解压（目录内应有 `manifest.json`）  
3. Chromium：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序（已装 0.1.0 的，替换目录后点「重新加载」）  
4. Firefox：`about:debugging#/runtime/this-firefox` → 临时载入 → 选择 `manifest.json`

旁加载细节：[docs/sideload-cn.md](https://github.com/dickbk/obsidian-clipper-cn-latest/blob/main/docs/sideload-cn.md)

### 验证情况

- Chrome：实机测试小红书视频笔记全流程
- Firefox：`web-ext lint` 0 error（warning 与 v0.1.0 相同）
- Safari：仅结构检查，未实机测试
