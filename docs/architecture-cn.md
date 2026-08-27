# 架构方案：基于官方 Obsidian Web Clipper 的中文叠层

本仓库不是从零重写剪藏器，而是在官方 [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) 之上叠加 **CN Overlay（中文叠层）**。  
目标：官方能力原样保留；中文站点增强集中在 `src/cn/`；跟随官方发版时以 **rebase 官方 tag** 为主路径。

## 1. 总体结构

```text
官方 Web Clipper（模板 / Interpreter / 高亮 / Reader / 保存）
        │
        │  少量 hook 调用（见第 3 节）
        ▼
src/cn/  中文叠层
  ├── overlay.ts              统一入口：微信 / 飞书 / B 站嵌入与字幕
  ├── wechat* / image-normalize*
  ├── feishu-*
  ├── bilibili-*
  ├── transcript-* / funasr*  无 CC → FunASR → 写回 {{transcript}}
  └── background.ts           CN 后台消息与网络规则
```

设计原则：

| 原则 | 做法 |
| --- | --- |
| 官方主干尽量干净 | 业务逻辑放在 `src/cn/`，避免大段改写官方模块 |
| 单一保存链路 | ASR 只写回官方已有的 `{{transcript}}`，不另建笔记管线 |
| 可 rebase | 与官方的衔接集中在少量 import / 调用点，冲突面可控 |
| 版本解耦 | CN 产品版本（如 `0.1.0`）≠ 官方基线（如 `1.7.1`），见 README 版本对应表 |

## 2. 目录与职责

| 路径 | 归属 | 说明 |
| --- | --- | --- |
| `src/cn/**` | **CN 叠层** | 中文增强全部实现；优先在此增删改 |
| `src/utils/clip-utils.ts` 等 | 官方 + 薄 hook | 仅调用 `prepareDocumentForClip` / `overlayParsedContent*` |
| `src/content.ts` / `src/background.ts` / `src/core/popup.ts` / `src/utils/reader.ts` / `src/managers/general-settings.ts` | 官方 + 薄 hook | 注册 CN 入口、Reader / 设置 / 弹窗面板 |
| `src/manifest.*.json` | 双方 | 权限可能因 CN 增加（如 `declarativeNetRequest`）；名称 / 版本号按 CN 规则 |
| `package.json` | 双方 | `version` 用 **CN 产品版本**；依赖跟随官方 bump，再按需加 CN 所需包 |
| `scripts/rebase-overlay.js` | CN 工具 | `npm run overlay:rebase [tag]`，把当前分支变基到官方 tag |

## 3. 官方代码中的 hook 点（更新时优先检查）

跟随官方升级时，先看这些文件是否被上游改动，再解决冲突：

| 官方文件 | CN 接入点 | 作用 |
| --- | --- | --- |
| `src/content.ts` | `overlayParsedContentAsync` / `prepareDocumentForClip` | 页面提取后叠中文内容 |
| `src/utils/clip-utils.ts` | 同上 | CLI / 通用剪藏路径 |
| `src/utils/reader.ts` | overlay + B 站 embed + `wireTranscriptFallback` | 阅读模式 |
| `src/utils/reader-transcript.ts` | B 站播放进度 tracker | 字幕跟播 |
| `src/background.ts` | `cn/background` 消息与监听 | 飞书下载、FunASR、音轨下载等 |
| `src/core/popup.ts` | 飞书剪藏提示、Transcript 面板 | 弹窗 UI |
| `src/managers/general-settings.ts` | 飞书 / Transcript 设置块 | 设置页 |
| `src/settings.html` / `popup.html` / `side-panel.html` | CN 区块 DOM | 设置与面板控件 |
| `src/styles/**` | CN 样式补充 | 弹窗 / Reader 字幕区 |
| `src/manifest.*.json` | 权限、名称、`homepage_url`、CN `version` | 扩展元数据 |
| `src/_locales/en` / `zh_CN` | CN 文案 key | 设置与状态文案 |

**约定：** 上游若重构上述文件，把 CN 的 `import` 与调用重新接到等价位置即可；不要把 `src/cn/` 逻辑拆散回官方文件。

## 4. 运行时数据流（简图）

```text
打开页面 → 官方提取（Defuddle 等）
         → CN overlay（微信正文 / 飞书 API / B 站 iframe）
         → 若 B 站且无可用 CC → FunASR 生成 transcript
         → 写入变量 {{transcript}} / content
         → 官方模板、Interpreter、保存到 Obsidian（不变）
```

## 5. 跟随官方版本更新（标准流程）

假设当前 CN 基线为官方 `1.7.1`，产品版本 `0.1.0`，要升到官方 `1.8.0`：

### 5.1 准备 remote

```bash
git remote -v
# upstream → https://github.com/obsidianmd/obsidian-clipper.git
# origin   → https://github.com/dickbk/obsidian-clipper-cn-latest.git（或本仓库实际 remote）
```

若无 `upstream`：

```bash
git remote add upstream https://github.com/obsidianmd/obsidian-clipper.git
```

### 5.2 变基到官方 tag

```bash
git fetch upstream --tags
npm run overlay:rebase -- 1.8.0
# 等价于: node scripts/rebase-overlay.js 1.8.0
```

解决冲突时：

1. **优先保留** `src/cn/**` 与 hook 调用。
2. 官方文件大改时：先接受上游，再按第 3 节把 CN hook 接回去。
3. `package.json` 依赖以官方为准合并；**不要**把 CN 的 `version` 改成官方号。

### 5.3 更新 CN 版本元数据

| 文件 | 动作 |
| --- | --- |
| README「版本对应表」 | 新增一行：CN `0.2.0` ↔ 官方 `1.8.0`（示例） |
| `package.json` → `version` | 升 **CN 产品版本**（如 `0.2.0`） |
| `src/manifest.*.json` → `version` | 与 CN 产品版本一致 |
| Release 说明 | 写明官方基线与变更摘要 |

### 5.4 验证清单

- [ ] `npm install` && `npm test` && `npm run build`
- [ ] 普通网页剪藏与官方行为一致
- [ ] 微信公众号多图 / 懒加载
- [ ] 飞书文档（已配置 App 时）正文与图片
- [ ] B 站有 CC：原生 `{{transcript}}` + Reader 跟播
- [ ] B 站无 CC：FunASR 生成并写回（需 API Key）
- [ ] 设置页飞书 / Transcript 区块正常

### 5.5 发布

```bash
npm run build
# builds/obsidian-clipper-cn-<CN版本>-{chrome,firefox,safari}.zip
# 打 Git tag：v<CN版本>，上传 zip，正文写明官方基线
```

## 6. 版本号规则（避免混用）

| 号码 | 含义 | 写入位置 |
| --- | --- | --- |
| 官方基线（如 `1.7.1`） | 本 CN 基于哪一版官方源码 / tag | README 版本表、Release 正文 |
| CN 产品版本（如 `0.1.0`） | 本仓库对外发版号 | `package.json`、`manifest.version`、GitHub Release tag（建议 `v0.1.0`） |

**不要**把官方 `1.7.1` 直接当作本扩展 `manifest.version` 长期使用：否则无法区分「仅跟官方小改」与「CN 自身功能发版」。

## 7. 与参考项目的关系

| 项目 | 关系 |
| --- | --- |
| [obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper) | **上游基线**；架构与 rebase 目标 |
| [nextcaicai/obsidian-clipper-cn](https://github.com/nextcaicai/obsidian-clipper-cn) | 微信 / 飞书 / B 站 Reader 能力参考 |
| [whatcccup/obsidian-web-clipper-cn-transcript](https://github.com/whatcccup/obsidian-web-clipper-cn-transcript) | 「无字幕补 `{{transcript}}`」产品流程参考；本仓库为扩展内 FunASR，非 macOS Helper |

## 8. 维护建议

- 新中文站点能力：先加在 `src/cn/`，再在第 3 节列表中增加最小 hook。
- 官方 PR / release notes：每次 rebase 后浏览上游 CHANGELOG，重点看 Reader、transcript、background、settings。
- 冲突过多时：可新建分支自官方 tag checkout，再把 `src/cn/` 与 hook 补丁拣选过来（仍保持叠层边界）。
