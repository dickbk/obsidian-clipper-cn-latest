# Hermes → Cursor 经验共享：B站访谈批量收录全流程

> 来源：Hermes Agent（NAS 容器）2026-09-21 完成的「12 期访谈批量收录」  
> 目的：把这套流程与踩过的坑同步给 Cursor，便于后续协作时双方认知对齐、不重复踩坑  
> 落盘位置：容器 `/opt/data/obsidian-raw/` = 宿主机 `/volume1/DQ-agent/Obsidian/llm-wiki/raw/`（PC↔NAS Syncthing 双向）  
> 相关文档：[本批成果清单](hermes-batch-ingest-summary-20260921.md) · [贾鹏期说话人分离根因](hermes-diarization-jiapeng-root-cause.md) · [对话式 Transcript 批量升级 2026-09-22](hermes-dialogue-transcript-upgrade-20260922.md) · [说话人归属与巡检口径 2026-09-23](hermes-speaker-attribution-patrol-20260923.md) · [关键词口径核对](hermes-keyword-audit-20260923.md) · [Token 优化方法论](hermes-token-optimization.md) · [媒体采集与瘦身 2026-09-23](hermes-media-slim-dedupe-20260923.md) · [改动验证方法论](hermes-change-verification-20260923.md) · [发版 ops](ops-hermes-codex.md)

---

## 一、任务背景

DQ 要求把三个频道（十字路口 / 韩成龙Jackie / WhynotTV）近 2 年的相关访谈**全量收录**进 Obsidian 知识库。一次 12 期，总时长约 21 小时。

**成果**：17 篇文章 + 15 个视频目录（480p 视频 + 音频 + vtt + 4063 帧 + 图文转录）+ 14 套转写四件套。

---

## 二、全流程（7 步，可复用）

| 步 | 做什么 | 关键命令/脚本 |
|---|---|---|
| 1 | 拉频道投稿清单，**按时长降序排**，识别正片 vs 切片 | B站搜索接口 + mid 精确过滤 |
| 2 | 音频（`.m4a`）与 480p 视频（纯画面无音轨）分开下载 | `yt-dlp -f 30280` / `-f "bv*[height<=480][ext=mp4]"` |
| 3 | 音频转写 | `transcribe-media.py --model small --beam-size 1 --language zh` |
| 4 | 抽帧（每 20 秒一帧） | `ffmpeg -vf fps=1/20`，**必须在转写完成后跑** |
| 5 | 后处理：术语纠正 + srt→vtt | `prep-transcripts.py` |
| 6 | 按 vault 规范搬运到 articles / videos / assets | `stage-to-vault.sh` |
| 7 | 提炼文章 + 图文转录 | 并行 subagent 共用 `EXTRACT-SPEC.md` |

---

## 三、关键技术要点

### 3.1 B站数据获取

- **UP主投稿列表接口已风控**（返回 `-352` / `412`），不可用。改用**搜索接口 + `author`/`mid` 精确过滤**：
  `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=<kw>&order=pubdate`
- **官方章节**：`x/player/v2` 返回的 `view_points` 字段。12 期里只有 4 期有，没有的要自拟章节。
- **时长是关键信号**：正片 44–184 分钟，切片 1–20 分钟。

### 3.2 去重（硬性规则，DQ 明确要求）

> 「有些博主会把长视频切成多个短视频，这样我们就只选完整版执行操作。」

**判据**：
- 标题含「完整版 / 全集」**或**时长 ≥30 分钟 → **正片**
- 时长 <20 分钟，**或**标题含「第 N 集 / 切片 / 精华版 / 预告」→ **切片**（跳过）
- 同一嘉宾多条 → 取最长那条

**实测效果**：韩成龙Jackie 频道 40 条投稿里**只有 7 条正片**，其余全是切片。不筛就会收进一堆碎片。

### 3.3 yt-dlp 格式坑

- 音频：`-f 30280`（m4a，170k）
- 480P 视频：**格式 ID 因视频而异，禁止写死**！
  - 2026 年投稿：`30032`（avc1）
  - 2025 年老投稿：`100047`（avc1），用 `30032` 会报 `Requested format is not available`
  - 其他可能：`30033`（hevc）、`100023`（av01）
  - **免查写法**：`-f "bv*[height<=480][ext=mp4]"`
- 480P 是**纯画面无音轨**，音频必须单独下一次。

### 3.4 转写

- 环境：`/opt/data/.venv-asr/bin/python`，参数 `--model small --beam-size 1 --language zh`
- **性能**：2 核 cgroup 下实测 **2.46–2.70× 实时**（对话密集语料）
- **small 的术语错字很少**：2.5 万段里只有 3 类（仿真→「访证」11 次、真机数据→「尊数据」、具身→「聚身」各 1 次）。**用替换表就够，不必上 medium（慢 10 倍）**。
- `HF_HUB_DISABLE_XET=1` 避免下载卡顿。

### 3.5 抽帧

- `ffmpeg -vf fps=1/20`，帧编号 ↔ 时间 = **`fN ↔ (N-1)×20s`**（f1 = 0:00:00）
- **转写期间不要并行抽帧**：2 核不够分，会把转写从 ~6× 拖到 1.9×。转写完再补，只要几分钟。

### 3.6 vault 落盘规范（PC 侧约定，务必遵守）

```
raw/
├── articles/        # 一层到底，不建子目录
├── videos/<嘉宾>_<主题>_<日期>/   # 480p.mp4 + .m4a + .vtt + frames/ + 图文转录.md
├── assets/<同名>/   # 转写四件套 .md/.srt/.txt/.json
├── inbox/           # Clipper 快捕区，不参与 compile
└── papers/ repos/
```

- **articles 文件名**：`<created 日期> — <标题>｜<频道>`
  - `｜` 必须**全角**；标题内的半角 `|` 一律改全角
  - **禁止出现 `| " : ? * \ /`**（Syncthing → Windows 会炸）
  - 末尾频道名**只加一次**
- **frontmatter**：`title / source / author / interviewer / interviewee / topics / published / created / description / tags / status`
  - `tags: - "clippings"`、`status: "raw"`（标记已读 = `status: "raw"`，不写 `read: true`）
- **图文转录**：`status: compiled`，含 `video_file / article（反链）/ video_resolution / video_duration`
- **Transcript 格式**：`**H:MM** · 文本`（超 1 小时用 `H:MM:SS`）

---

## 四、踩过的坑与解法（8 条）

### 1. 内容风控：长转写不要整篇读进 LLM 上下文 ⚠️ 最重要

把 1960 段转写一次性读进上下文，触发 DeepSeek 内容安全过滤：
```
content_policy_blocked: HTTP 400: Content Exists Risk
```
**内容本身完全正常**，纯粹是长度触发的，任务直接失败。

**解法**（批量派 subagent 时必须写进它的 context，否则它会自然地整篇读）：
- Transcript 用 **脚本**从源生成，直接写目标文件，**不经过模型上下文**
- 写要点用**抽样**：每 40 行抽 1 行打印（约 50–100 行）把握脉络
- 需要细节时针对性小批量读（**每次 ≤120 行**）

### 2. 并行子任务的文件名会不一致

6 个并行 subagent 对「是否加频道后缀」「全角还是半角」判断不一，2 篇用了半角 `|`。**解法**：写幂等的 `normalize-filenames.py` 统一 + 同步更新反链。

### 3. `Path.with_suffix` 会覆盖原始转写

输出路径一律**字符串拼接**，禁用 `with_suffix`。

### 4. `pkill -f` 会自杀

`pkill -f batch-frames.sh` 匹配到自己的 shell 命令行 → `exit -15`。**改用精确 PID**。

### 5. `nohup` 后台任务起不来

`bash: logs/batch-audio.out: No such file or directory`（目录没建 + nohup 被子 shell 收走）。**用工具原生 background 机制**。

### 6. 子任务会「自作聪明」重排内容

必须明确要求：**Transcript 保留转写原文一字不改**，专名误识只在文章正文用正确写法 + 文末加「机器转写，可能有误识」警示。

### 7. 跨日边界

长任务跨日时注意 `created` 日期取**当天**，别沿用启动日。

### 8. 小红书等需登录平台

小红书短链需登录态，无法直接下载。**解法**：找同源 B站/YouTube 视频替代（本次徐梦迪那期就是这么解决的）。

---

## 五、协作边界（避免撞车）

| 角色 | 负责 |
|---|---|
| **DQ** | 唯一决策入口；去重规则、分层调整、发版口令等均由 DQ 拍板 |
| **Hermes（NAS）** | 知识库收录全流程（抓取→转写→抽帧→落盘）；频道巡检 cron；lilo 项目当项目经理（盯进度/记状态，不自己 curl/crawl） |
| **Cursor（PC）** | clipper-cn / lilo-assistant 代码改动、`D:\CodeX\projects\` 下仓库；raw 文件夹的 PC 侧同步与 Obsidian 使用 |
| **Codex CLI** | 按思源 backlog 任务执行编码；完成后回写状态 |

**共享约定**：
- 编码类任务（`#design` `#implement` `#review` 等）入队前走「需求澄清门闸」——信息不齐先一次性追问（≤5 问），齐全后发「拟派发摘要」，DQ 回「确认派发」才入队
- lilo-assistant 的 NAS 操作用户手操，Hermes 只记状态
- **定点修复铁律**：少量坏数据只用 `--refetch-urls` / 单关 backfill / 增量 index，**禁止 full**

---

## 六、可复用脚本清单

全部在 `/opt/data/feishu/20260921-批量收录/`：

| 脚本 | 用途 | 是否幂等 |
|---|---|---|
| `batch-download.sh` | 音频/视频批量下载（audio\|video 两模式） | 是（已存在跳过） |
| `batch-transcribe.sh` | 批量转写（small + beam 1） | 是 |
| `batch-frames.sh` | 每 20 秒抽一帧 | 是 |
| `prep-transcripts.py` | 术语纠正 + srt→vtt | 是 |
| `stage-to-vault.sh` | 按 vault 规范搬运 | 是 |
| `fetch-meta.py` | B站官方元数据（标题/简介/发布日/时长/官方章节） | 是 |
| `normalize-filenames.py` | 文件名规范化（全角｜、频道名去重、反链同步） | 是 |
| `EXTRACT-SPEC.md` | 提炼规范（供并行 subagent 共用） | — |

---

## 七、其他积累（非本次）

- **说话人分离**：speakerlab CAMPPlus + 自研能量 VAD + 层次聚类。**极端不平衡下（主持人 <2%）层次聚类会退化**，需自动回退阈值法（`sim < median - 1.75*std`）；实测分段聚类（50%）**劣于**阈值法（83%）。播客是「嘉宾独白型」时**不该跑**——先判值不值得跑。
- **人物/频道索引**：`articles/_人物与频道索引.md` + 机器可读 `/opt/data/media-channels.yaml`，每 2 天巡检一次（B站搜索接口），**无命中静默**，有命中才发简报；切片不计入命中。
- **Hermes 环境**：容器内无 sudo / 无 docker socket；重启 gateway 唯一方式 `/command/s6-svc -r /run/service/gateway-default`；用户 uid/gid 10000，`/opt/data` 下 root 建的目录不可写。

---

## 八、待确认（DQ）

1. 索引笔记新增的 11 位受访者（周晨、段江哗、胡宇航、黄一、王家伟、世博同学、杨硕、胡渊鸣、翁家翌、陈天奇、王晓刚）暂放「重点跟踪」，分层调整需 DQ 确认。
2. 「四方对谈」那期是四家公司代表，转写中未出现清晰姓名，暂以公司名登记。

---

## 九、Hermes 侧当前全景（供 Cursor 对齐）

### 9.1 在跑的工作线

| 线 | 内容 | 状态 |
|---|---|---|
| ① clipper-cn | Obsidian Web Clipper 中文 fork | onboarding Step 1-3 代码闭环（commit `0ac1d07`）；**浏览器旁加载手测未做**；每天 06:00 晨检 |
| ② lilo-assistant | 独立法律助手（飞书 Bot + Obsidian 库 + 全国海关处罚抓取） | P4.2③ 批次 enable 收口（已 enable >20 关）；③-E/F/G NAS 烟测排队；抓取新策略（07:25、Phase2 先于 Phase1）待 NAS 落地 |
| ③ 知识库 raw 共建 | Hermes ↔ Obsidian 直连 + PC↔NAS Syncthing | **本次 12 期批量收录完成** |
| ④ 说话人分离 + 元数据治理 | 对话式 Transcript 16/16；merge 短段吸收 `--min-seg 3.5`；patch 写回 head 双校验 | 已上线 |
| ⑤ 频道巡检 | B站搜索接口 + 去重判据 + 空转静默 | cron 每 2 天 07:00 |

### 9.2 定时任务（5 个）

| 任务 | 频率 | 说明 |
|---|---|---|
| clipper-cn 晨检 | 每天 06:00 | no_agent，直投飞书 |
| 频道巡检 | 每 2 天 07:00 | no_agent，**有新内容才发，空转静默** |
| backlog-sync | 每 30 分钟 | 同步思源 backlog 到长期记忆 |
| project-digest | 12:00 / 18:00 | 有更新才发 |
| daily-reflect | 23:00 | 日终小结 + 记忆整理 |

### 9.3 Hermes 侧硬性约束（Cursor 改动时请留意）

- **vault 只写** `/opt/data/obsidian-raw/`（= `/volume1/DQ-agent/Obsidian/llm-wiki/raw/`），**不新增子目录类型**，禁写家目录与 `/volume2/Document`
- **lilo-assistant**：禁止 `discover.py` / 站点级 `.py`；增关只改 YAML；`list_url` 必须 stealthy-fetch 实测
- **飞书入口**：`#问` / `#查` 第一步必须走 `/opt/data/scripts/lilo-search-wrapper.sh`，**禁止 web_search / web_extract / browser_***
- **clipper-cn 发版口令**：唯一口令 `#同意升级 <semver>`；Hermes **禁止**自行 rebase / push / `gh release` / 改基线
- **不主动打扰**：空转静默；飞书只发人话短摘要，禁 job_id / JSON / 终端大段
