# Ops：Hermes × Codex × Clipper CN 发版与情报边界

> 仓库：[dickbk/obsidian-clipper-cn-latest](https://github.com/dickbk/obsidian-clipper-cn-latest)  
> 官方上游：[obsidianmd/obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper)  
> 当前基线文件：[`docs/official-baseline`](official-baseline)（发版升基线时必须同步改此文件与 README 版本表）

本文档是 **ops 定稿**（架构策略已讨论同意）。版本 follow 日常流程是：检测 → 策略 → 飞书口令同意 → 再 rebase/Release；**不是**每次升级再开架构研讨会。

---

## 1. 角色

| 角色 | 职责 |
| --- | --- |
| **Hermes** | 每天北京 **06:00** 巡检；飞书通知；转发 / 摘要 GitHub Issue；收口令 `#同意升级 …` |
| **Codex** | 有新官方版本时写升级策略；口令通过后执行 rebase、回归、发版；每周搜 Obsidian/skill → backlog |
| **Cursor / designer** | 架构与关键词设计；复杂冲突时协助；Cursor 口头确认可作为双通道补充 |
| **diqing** | 飞书口令同意发版；拍板 P2 日报与升 B |

**禁止：** GitHub Action 或机器人在无人同意时自动 rebase / 自动 Release。

---

## 2. 发版同意（双通道，以飞书为准）

| 通道 | 用法 |
| --- | --- |
| **主** | 飞书回复：`#同意升级 0.2.0`（CN **产品版本号**写死，勿只写官方号） |
| **辅** | 已在 Cursor 对话中口头确认时，Codex 可开干，并在对应 Issue 留痕「经 Cursor 确认」 |

无口令且无 Cursor 确认 → 只保留 Issue / 策略报告，不 push Release。

---

## 3. 每日巡检（Hermes，北京 06:00）

### 3.1 检测项

1. **官方版本**：`docs/official-baseline` vs [官方 Releases](https://github.com/obsidianmd/obsidian-clipper/releases/latest)  
   - 仓内 Action [`Detect official update`](../.github/workflows/follow-official.yml) 在 UTC 22:00（= 北京 06:00）也会跑：**仅开/更新** label `official-follow` 的 Issue，**不** rebase。
2. **本仓用户信号**：[Issues](https://github.com/dickbk/obsidian-clipper-cn-latest/issues) / Discussions / PR  
3. **报警 / 符合性**：Dependabot、Security advisories、Secret scanning、仓库告警邮件（若有）

### 3.2 飞书简报模板（无更新也可「全绿」一条）

```text
【Clipper CN 晨检】yyyy-mm-dd
官方基线：{baseline} | 官方最新：{latest} | 需跟进：是/否
CN 开 Issue：{n} | Security/Dependabot：无 / 有（摘要）
链接：https://github.com/dickbk/obsidian-clipper-cn-latest/issues
```

有新版本时追加：

```text
请 Codex 出升级策略。同意后请回复：
#同意升级 {建议CN产品版本}
```

### 3.3 Hermes 可粘贴任务说明

> **真正落地步骤（NAS + cron）：** 见 [`deploy/hermes/README.md`](../deploy/hermes/README.md)。  
> 推荐：`no_agent` + [`clipper-cn-daily-patrol.sh`](../deploy/hermes/clipper-cn-daily-patrol.sh)，stdout 直达飞书。

```text
任务名：clipper-cn-daily-patrol
时刻：每天 06:00（Asia/Shanghai）
动作：
1. 读 dickbk/obsidian-clipper-cn-latest 的 docs/official-baseline（或跑 node scripts/detect-official-update.js）
2. 对比 obsidianmd/obsidian-clipper latest release tag
3. 列出本仓 open issues / 是否有 security 相关告警
4. 按「飞书简报模板」发一条到配置频道
5. 若 needsUpdate=true：提醒 Codex 写策略；监听口令 #同意升级 <semver>
6. 收到口令后：通知 Codex 执行升级（rebase → 回归 → 更新版本表与 official-baseline → Release），不要自己静默 push
不做：自动 rebase、自动 gh release
```

本地/容器自检：

```bash
# 仓内 Node 版
node scripts/detect-official-update.js

# NAS Hermes 推荐脚本（无 Node）
bash deploy/hermes/clipper-cn-daily-patrol.sh
```

---

## 4. 官方升级策略（Codex 输出模板）

有新官方 tag 时，策略 Issue / 飞书附件固定包含：

1. 官方变更摘要（破坏性？权限？Reader / transcript / background / settings？）
2. 对 `src/cn/` 与 [architecture-cn.md](architecture-cn.md) hook 清单的影响（绿 / 黄 / 红）
3. 建议 **CN 产品版本**（如 `0.2.0`）与官方基线（如 `1.8.0`）
4. 回归清单（微信 / 飞书 / B 站 Reader / FunASR / 弹窗与 Reader 字幕一致）
5. 是否改 manifest 权限或 FunASR 相关

同意后执行顺序：

1. `npm run overlay:rebase -- <官方 tag>`
2. 解 hook 冲突 → test / build
3. 更新 README 版本表、`package.json`、`manifest.*.json`、**`docs/official-baseline`**
4. 先 push 文档与代码 → 再打 tag / Release 上传 zip
5. 关闭或注释 `official-follow` Issue

细节见 [architecture-cn.md](architecture-cn.md) 与 v0.1.0 回顾（工作区根 `PROJECT-RETROSPECTIVE-v0.1.0.md`）。

---

## 5. 每周优化（Codex，扩展仓）

- 在 GitHub 搜 Obsidian Web Clipper / Defuddle / 相关 skill 与 issue
- **只产出 backlog**（设计/实现任务），不直接大改发版
- 与行业日报解耦

---

## 6. P2 情报日报（独立于扩展发版）— 方案 C，可升 B

| | 方案 C（当前） | 方案 B（预留） |
| --- | --- | --- |
| Clipper CN | 人用浏览器剪藏；保证字幕/中文站点质量 | 能力抽成 CLI/服务供 Hermes 无头调用 |
| 日报 | Hermes 自有采集（如 Scrapling）+ 关键词追踪 | 复用 Clipper 下载/ASR/写笔记管线 |
| 发版节奏 | 日报迭代 **不影响** 扩展 Release | 仍建议分仓或分目录，避免拖垮 follow |

### 6.1 第一批关键词（定稿）

**具身智能相关**

1. 具身智能当前模型：多模态基础模型（视频理解、VLM 落地）
2. 新模型发展：世界模型 / World Model
3. 具身智能 / Embodied AI（含苏度、人形机器人核心采访）

**智能辅助 / 优秀实践**

1. Agent / 工具调用落地（浏览器 / 桌面 / 企业工作流，贴近 Clipper）
2. 本地知识库 / Obsidian 工作流（剪藏 → 笔记 → 日报闭环）

### 6.2 日报分类标签（内容侧）

- `类似GPT时刻前` / `类似GPT时刻后` / `应用推广期`
- 素材类型：视频、博客、长文、采访等

日报配置与关键词列表建议放在 **Hermes / 情报仓**，本扩展仓只保留本节指针，避免与 `src/cn/` 混编。

---

## 7. 与「架构策略讨论」的边界

| 短语 | 含义 |
| --- | --- |
| 先策略后同意（ops） | 本文件所描述的分工与门闩，讨论定稿后再落地（已完成） |
| 先策略后同意（单次升级） | Codex 出升级策略 → 飞书 `#同意升级 x.y.z` → 再 rebase/Release |

GitHub Action **只检测开 Issue**；执行升级永远在同意之后。

---

## 8. 相关文档（知识库收录）

B 站访谈批量收录（Hermes 侧流程、坑、脚本与协作边界）不在本扩展发版主路径内，但与 Hermes vault / 情报线共用同一套约束：

- [hermes-bilibili-batch-ingest.md](hermes-bilibili-batch-ingest.md) — 全流程经验
- [hermes-batch-ingest-summary-20260921.md](hermes-batch-ingest-summary-20260921.md) — 12 期成果清单
- [hermes-diarization-jiapeng-root-cause.md](hermes-diarization-jiapeng-root-cause.md) — 说话人分离根因
- [hermes-dialogue-transcript-upgrade-20260922.md](hermes-dialogue-transcript-upgrade-20260922.md) — 对话式 Transcript 升级 + merge 短段吸收（`--min-seg 3.5`）；纠正「严格交替」误诊
- [hermes-token-optimization.md](hermes-token-optimization.md) — Hermes Token 消耗优化方法论（口径、no_agent、压缩阈值、勿用 `API calls: 0` 判零 LLM）
- [hermes-change-verification-20260923.md](hermes-change-verification-20260923.md) — 改动验证方法论（落盘≠生效≠正确≠有效；快照差分验收）
- [hermes-media-slim-dedupe-20260923.md](hermes-media-slim-dedupe-20260923.md) — 媒体采集与瘦身 / 跨平台判重（勿用产物文本做 A/B）
- [hermes-speaker-attribution-patrol-20260923.md](hermes-speaker-attribution-patrol-20260923.md) — 说话人归属修复（锚点+混段+吸收豁免）与巡检泛词双命中
- [hermes-keyword-audit-20260923.md](hermes-keyword-audit-20260923.md) — 人物/关键词口径核对（索引 vs media-channels.yaml；待 designer 定夺）
