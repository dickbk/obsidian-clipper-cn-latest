# 旁加载 Obsidian Web Clipper CN

这是官方 Web Clipper **1.7.1** 上的中文增强版（产品版本 **0.1.0**），分支为 `cn-overlay`。浏览器里显示的名称是 **Obsidian Web Clipper CN**，用来和商店里的官方扩展区分。

旁加载 = 不经过 Chrome / Edge / Firefox 商店，直接把本地构建结果或 Release zip 解压后装进浏览器。适合自测与分发；商店外安装需要开启开发者模式。

版本对应关系见根目录 [README.md](../README.md) 中的「版本对应表」。

## 开始前

1. **关掉商店里的官方 Web Clipper。** 两个扩展同时开会抢快捷键、重复剪藏，也难以判断问题出在哪一版。
2. 需要本机已安装 [Node.js](https://nodejs.org/) 20+（只用现成 `dist/` 或 Release 解压包时可跳过构建）。
3. 飞书完整文档提取需要自建应用凭证；微信图片和 B 站阅读模式不需要。无可用 CC 的 B 站视频会用 **千问 AI 平台 Fun-ASR** 生成逐字稿（需在设置中填写 API Key）；音频会上传到千问临时存储。

## 1. 构建

在仓库根目录：

```bash
npm install
npm run build:chrome
```

Chrome / Edge / Brave / Arc 加载 **`dist/`** 目录。

Firefox 再执行：

```bash
npm run build:firefox
```

然后加载 **`dist_firefox/`**。

生产 zip 会写到 `builds/obsidian-clipper-cn-0.1.0-chrome.zip`（及 firefox / safari）。zip 不能直接「加载已解压」，需要先解压，或直接选 `dist/`。

开发时可持续编译：

```bash
npm run dev:chrome
```

改完代码后到扩展页点**重新加载**。

## 2. Chrome / Edge / Brave / Arc

1. 地址栏打开扩展页：
   - Chrome / Brave / Arc：`chrome://extensions`
   - Edge：`edge://extensions`
2. 打开右上角 **开发者模式**。
3. 点 **加载已解压的扩展程序**（Edge 文案可能是「加载解压缩的扩展」）。
4. 选中本仓库的 **`dist`** 文件夹（里面应能看到 `manifest.json`），不要选仓库根目录，也不要只选 zip。
5. 确认卡片上的名称是 **Obsidian Web Clipper CN**，版本 **0.1.0**。
6. 点「详细信息」，打开 **在文件网址上允许访问**（如果要剪本地 HTML），并按需要固定到工具栏。

更新代码后：再跑一次 `npm run build:chrome`，回到扩展页点该扩展上的刷新按钮。

## 3. Firefox

临时加载（重启 Firefox 后会消失）：

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点 **临时载入附加组件**
3. 选 `dist_firefox/manifest.json`

若要长期使用，需要 Firefox Nightly 或 Developer Edition：

1. 打开 `about:config`，把 `xpinstall.signatures.required` 设为 `false`
2. 打开 `about:addons` → 齿轮 → **从文件安装附加组件…**
3. 选 `builds/` 里打出的 firefox zip，或继续用临时载入目录

## 4. 第一次设置

1. 点工具栏上的 CN 图标，打开设置。
2. 把 **Vault name** 填成 Obsidian 里显示的库名（是库名，不是磁盘路径）。
3. 需要剪飞书 / Lark 文档时，在 **General → Feishu / Lark** 填 App ID 和 App Secret。
   - 在[飞书开放平台](https://open.feishu.cn/)创建企业自建应用。
   - 权限至少包含 `docx:document:readonly`、`wiki:node:read`。
   - 发布应用版本，并用当前飞书账号可访问的文档做测试。
4. 微信公众号文章不需要这项配置。
5. B 站无可用 CC 时：在 **General → Transcript generator** 开启，并填写 **千问 AI 平台 API Key**（`sk-ws-…`，可在 [platform.qianwenai.com](https://platform.qianwenai.com/) 或 DashScope 控制台创建）。

## 5. 建议自测

| 页面 | 预期 |
| --- | --- |
| 任意普通网页 | 行为与官方 1.7.1 一致 |
| 微信公众号文章 (`mp.weixin.qq.com`) | 正文完整，图片不是裂图（lazy `data-src` 已还原） |
| 飞书文档 / Wiki | 能拿到完整正文和图片；未配凭证时应能看到可理解的失败提示，而不是空白 |
| B 站有 CC 的视频 + 阅读模式 | 能出平台字幕，iframe 能播，进度可跟字幕 |
| B 站无 CC、画面有硬字幕的视频 + 阅读模式 | 出现「生成字幕」空态，随后用 FunASR 生成逐字稿并写回 `{{transcript}}` |

改完扩展后请**刷新一次页面再剪**，旧标签页可能还在跑上一版 content script。

## 6. 常见问题

**扩展页没有「加载已解压」**  
没打开开发者模式，或当前浏览器策略禁用了旁加载。

**加载后名称仍是 Obsidian Web Clipper（没有 CN）**  
选错了目录，或商店官方版还在运行。关掉官方版，确认加载的是本仓库 `dist/` 或 Release 解压目录。

**点扩展没反应 / 剪出来是旧逻辑**  
扩展页点重新加载，然后刷新网页。`npm run dev:chrome` 只编译，不会自动热更新已加载的扩展。

**Firefox 重启后扩展没了**  
临时附加组件就是这样。改用 Nightly/Developer Edition，或每次启动后再加载一次。

**飞书只能剪到标题或残缺正文**  
检查 App ID / Secret、应用是否已发布、权限是否包含上述两个 scope，以及当前登录账号是否有该文档权限。

**B 站阅读模式没有字幕，但画面上能看到字**  
播放器没有 CC 开关时，那是硬字幕，不是平台字幕轨。CN 版会下载音轨、用 FunASR 生成逐字稿。请确认已填写千问 AI 平台 API Key。生成失败时请在 B 站视频页打开阅读模式再试，并确认网络能访问千问 / DashScope。

**70 分钟这类长视频**  
长音轨会按约 12 分钟分段识别。请保持视频标签页开着；若字幕与内容不符，点「重新生成」强制重跑。

**和官方版快捷键冲突**  
只保留一个启用。CN 版改的是提取层，快捷键沿用官方。
