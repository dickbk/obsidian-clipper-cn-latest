# 说话人归属修复 & 频道巡检口径收紧

> 日期：2026-09-23 ｜ 环境：Hermes 容器（Linux / 2 核）
> 适用：单嘉宾访谈类音视频（**嘉宾独白型**，主持人只占 10% 上下）的说话人分离；以及「频道巡检关键词表」的误报治理。
> 这份文档自包含，可直接转给其他 agent / 工程师照做，不需要原会话上下文。
> 仓库路径：`dickbk/obsidian-clipper-cn-latest` → `docs/hermes-speaker-attribution-patrol-20260923.md`
> 相关：[对话式 Transcript 升级](hermes-dialogue-transcript-upgrade-20260922.md) · [关键词口径核对](hermes-keyword-audit-20260923.md) · [媒体采集与瘦身](hermes-media-slim-dedupe-20260923.md) · [ops](ops-hermes-codex.md)

---

## 0. 一句话结论

同一份音频（旧声纹），只换「合并 / 文本修正」逻辑的前后对照：

| 指标 | 原始脚本 | 中间态（加了锚点但没做豁免） | 现行 |
|---|---|---|---|
| **锚点台词逐个核对**（13 处已知答案） | 12/13 (92%) | **11/13 (85%) ← 反而更差** | **13/13 (100%)** |
| **最终稿提问点归属**（21 处） | 13/21 (62%) | — | **21/21 (100%)** |
| 主持人说话时长占比 | 10.5% | — | 10.8%（声纹真实值 11.9%） |
| 对话稿段数 | 77 | — | 95 |
| 纯声纹层 A_audio（改造的天花板） | 9/21 (43%) | 9/21 | 9/21（**未变**） |
| 切片冒烟（900s） | 锚点 90% / 最终 80% | — | **100% / 100%** |
| 频道巡检 10 条用例（真配置 × 真代码路径） | — | — | **10/10** |

三条必须看懂的事：

1. **中间态比原始更差（85% < 92%）** ——「把句子改对了，又被合并阶段吃回去」，这就是本文档第 2 节的核心坑。
2. **纯声纹层没变（43%）** —— 真实增益**全部来自文本线索（话术锚点）**，不是调聚类参数。见 §5 的反例。
3. 最终稿能到 100%，靠的是「锚点 + 混段拆分 + 吸收豁免」三件套同时到位，少一件就退回去。

---

## 1. 先能测，才能修：把「已知答案的台词」当尺子

修复前必须先建评测脚本，否则改完只能靠「看起来对」评分。本机脚本：
`/opt/data/scripts/eval-jiapeng-diar.py`（三层指标）

- **A_audio**：纯声纹层，把已知答案的台词所在时间点拿去查归属，看声纹自己判对几个（本机基线 **9/21**）
- **锚点命中**：同一批时间点，查**最终稿**（合并 + 文本修正后）判对几个（原始脚本 12/13 = 92%；**只加锚点、没做豁免时反而掉到 11/13 = 85%**，这就是 §2 层二的直接证据；现行 13/13 = 100%）
- **C 主持人时长占比**：把「主持人占比是否落在合理区间」做成自动门（本机 3%–35%）

尺子从哪来（人工找，一次性成本）：**主持人固定话术**与**嘉宾自介**这两类句子，归属没有歧义。

```
主持人话术：有请X哥 / 欢迎收看 / 欢迎收听 / 欢迎来到 / 本期节目 / 本档节目 /
            我们下期 / 下期再见 / 作客 / 做客 / 访谈一开始
主持短问句：含 ? ？ 吗 呢 / 你怎么 / 你觉得 / 你认为 / 请介绍 / 想问 / 对不对 / 是吧 / 有没有
嘉宾自介  ：我是X（用嘉宾名首字匹配，抗 ASR 同音字：贾鹏 常被写成「贾彭」）
```

> 坑：评测脚本里比对标签别写 `got == exp` —— 实际标签常带后缀（`主持人（韩成龙Jackie）`），要用 `got == exp or got.startswith(exp)`，否则把对判成错。

---

## 2. 真因（两层，第二层是隐藏的）

### 层一：ASR 混段
ASR 常把「嘉宾自介 + 主持人提问」并进**同一段**。本机实例：85.8s 起的那 9 秒，既含
`大家好,我是贾鹏` 又含 `访谈一开始要不先请彭哥…`。一段只能给一个标签 → 必然错一半。

### 层二：改对了又被「短段吸收」吃回去（**真凶**）
`--min-seg` 的短段吸收逻辑是：**短于此长度、且被两个「同属另一说话人的长段」夹住的段 → 归入该说话人**。
它对普通短问答是好机制，但对锚点段是灾难：

- 89.3s 的 `访谈一开始…` 只有 3.4s，两侧都是嘉宾长段 → 被吸收回嘉宾，**锚点白打**；
- 更隐蔽：豁免标记如果只打在「**被改动过**的段」上，那么**声纹本来就判对的那段没有标记**，照样被吃。
  同一句在 900s 切片上是对的、在 5571s 全片上又错 —— 因为两段的分窗声纹标签恰好相反。

**教训：豁免要按「文字证据」打，不能按「是否被改过」打。**

**量化证据（同一份音频，只换合并逻辑）**：原始脚本 锚点 **12/13** → 只加话术锚点、没做豁免 **11/13（负优化）** → 加上无条件豁免 **13/13**。
中间态那次「负优化」正是 89.3s 那句被吃回去造成的 —— 所以**改完必须用同一把尺子量前后，别假设「加了机制」=「变好了」**。

---

## 3. 修法（4 处代码 + 1 个开关，全部落在 `merge-diarization.py`）

```python
# ① 锚点定义（--text-heuristic 时启用）
ANCHOR = re.compile(r"我是韩|有请[\u4e00-\u9fff]{1,4}哥|欢迎收看|欢迎收听|欢迎来到|本期节目|本档节目|"
                    r"我们下期|下期再见|作客|做客|访谈一开始")
SOFT   = re.compile(r"感谢.{0,8}(来到|做客|分享|聊)|谢谢.{0,6}(来到|做客)")
QRE    = re.compile(r"[?？]|吗[？。 ，]|呢[？。 ，]|你怎么|你觉得|你认为|请介绍|想问|对不对|是吧|有没有")
GINTRO = re.compile(rf"我是[\u4e00-\u9fff]?{re.escape(guest_name[0])}[\u4e00-\u9fff]")   # 嘉宾名首字

# ② 混段拆分：同段同时命中「嘉宾自介」+「主持人话术」且 ≥3s 才拆，
#    按句末标点切、时间按字数比例分配（时间是近似，归属是对的）
if GINTRO.search(s["text"]) and ANCHOR.search(s["text"]) and s["end"] - s["start"] >= 3:
    ...  # 切段插入 tsegs

# ③ 命中文字证据 → 无条件打豁免标记（关键修复点）
for s in tsegs:
    dur = s["end"] - s["start"]
    txt_anchor = bool(ANCHOR.search(s["text"]))
    txt_q      = bool(dur <= max_q_sec and (SOFT.search(s["text"]) or QRE.search(s["text"])))
    txt_gi     = bool(GINTRO and dur <= max_q_sec and GINTRO.search(s["text"]))
    if txt_anchor or txt_q or txt_gi:
        s["anchor"] = True          # 与声纹当前判成谁无关！
    if txt_gi and s["speaker"] != guest:  s["speaker"] = guest; continue
    if s["speaker"] == host:              continue
    if txt_anchor or txt_q:               s["speaker"] = host

# ④ 吸收阶段：见标记即跳过
def absorb(segs, min_seg):
    ...
    if s.get("anchor"):
        out.append(dict(s)); continue      # 文字证据优先，短段吸收不得覆盖
```

**两处必须同时改，否则标记会丢**（本机踩过）：

```python
# ⑤ coalesce 用固定字段重建字典，会把 anchor 丢掉 → 输入字典要显式带上
{"speaker":…, "name":…, "anchor": bool(s.get("anchor")), "start":…, "end":…, "text":…}
# ⑥ 相邻同说话人合并时保留标记
out[-1]["anchor"] = out[-1].get("anchor", False) or s.get("anchor", False)
# ⑦ 输出前剔除内部键，别污染产物
"segments": [{k: v for k, v in s.items() if k != "anchor"} for s in merged]
```

**开关**：以上都挂在 `--text-heuristic` 下；`--min-seg 3.5` 是吸收阈值（0=关闭），`--no-absorb` 可整体关掉吸收做对照。

---

## 4. 验收流程（照抄可用，别直接跑全片）

### 4.1 三步验收，成本从低到高

```bash
# ① 切片冒烟（900s 音频 ≈ 3 分钟）：先确认逻辑在
bash jp-slice-test.sh            # 内部：diarize-media.py AUDIO --out X --start 0 --end 900 \
                                 #        --speakers 2 --windowed 480 --z 1.75

# ② 全片预验（复用**旧声纹**，不烧 18 分钟）：只换合并/文本逻辑，看指标动没动
merge-diarization.py --transcript "<期>.json" --diar "<旧>.diar.json" \
  --out-prefix jp-full-preview --host-name "主持人（X）" --guest-name "Y" \
  --text-heuristic --min-seg 3.5
#  → 本机这次预验就抓到「切片好了、全片仍错」，直接暴露层二真因

# ③ 正式重跑（5571s 音频 ≈ 18 分钟，2 核）：作业脚本带护栏，不通过不写回
python /opt/data/scripts/rerun-jiapeng-speakers.py                # 全流程
python /opt/data/scripts/rerun-jiapeng-speakers.py --test         # 干跑，只落 scratch
python /opt/data/scripts/rerun-jiapeng-speakers.py --reuse-diar <旧diar> --test   # 复用声纹
```

### 4.2 写回前必须过 5 查（本机已做成自动门 + 人工复核）

1. **head 逐字节不变**：文章 `## Transcript` 之前的内容必须 `ha == hb`（本机 21473 → 21473 字节）
2. **段数合理**：合并后段数不该暴涨/暴跌
3. **锚点命中不下降**：`new ≥ old`，下降即拒写
4. **主持人占比在 3%–35%**：越界即拒写（占比解析失败也算拒写，别把「没解析出来」当通过）
5. **先备份**：article + assets 的 .md/.json + 旧 diar 全部 copy 到 `backup/<时间戳>/`

> 拒写时脚本必须**如实返回失败 + 原因**并保留原产物，绝不静默写坏。

---

## 5. 反面教训（诚实边界，别对外夸大）

1. **`--windowed` 分窗局部阈值实测近乎无效**：`--windowed 480 --z 1.75` 与关闭时**逐段相同**，只动了 2 个块。
   原因：阈值法本以全库多数派中心为参照，分窗只微调判定边界。**别指望分窗救极端不平衡**。
2. **中段长对话仍有误标风险**：修好的是「有文字线索的句子」（开场/收尾/自介/短问句）。嘉宾连续长篇陈述里若夹杂无特征短句，仍可能错。
   → 因此文章里的可靠性说明要**如实表述**（写「已逐句校对开场/收尾，中段仍有误标风险」），不要写一刀切的「可靠性低」。
3. **不要把「加了机制」当成「修好了」**：同一把尺子量前后。本次就是「切片 100%、全片仍 ✗」才挖出层二。
4. **同参数重跑 ≠ 原稿**：转写产物不可复现（VAD 切点漂移 + `condition_on_previous_text` 放大，实测同参数重跑与已定稿稿差 **55%**）。
   → 已定稿的转写稿不要为了「重新压音频」而重跑；音频只压文件。

---

## 6. 频道巡检口径收紧（泛词双命中）

### 6.1 现象与依据
小宇宙候选 5 条「命中」里 **4 条的命中词来自描述里的泛词**（当期都不是具身题材）→ 每次巡检都在误报。

### 6.2 规则（配置 + 代码两处，缺一不可）

```yaml
# media-channels.yaml（全部挂在 topics: 下）
topics:
  keywords:        [ ... 全部候选词 ... ]
  people:          [ ... 人名（天然强特征词）... ]
  generic_channels: [十字路口, 课代表立正]        # 泛科技频道，话题杂
  weak_keywords:                                     # 泛词名单
    - 落地, 泡沫, 行业泡沫, 本体, 量产, 商业化, 泛化,
      generalization, adaptation, 快速适应, 供应链, 格局, 终局
```

```python
# check-media-channels.py
def strong_keywords(topics):        # 强 = keywords 去掉 weak，再并入全部人名
    weak = {str(w) for w in topics.get("weak_keywords", [])}
    return ({str(k) for k in topics.get("keywords", [])} - weak) | {str(p) for p in topics.get("people", [])}

i["topics_matched"]      = match_topics(title, topics)                      # 只认标题
i["topics_matched_weak"] = [k for k in match_topics(f"{title} {desc}", topics)  # 描述命中只留档
                            if k not in i["topics_matched"]]
if i["topics_matched"] and is_generic_channel(i["channel"], topics):
    if not any(k in strong_keywords(topics) for k in i["topics_matched"]):
        i["topics_matched_weak"] += i["topics_matched"]; i["weak_only"] = True
        i["topics_matched"] = []                       # 整条降级，不告警
i["matched"] = bool(i["topics_matched"]) and not i["is_clip"]   # 切片不算命中
```

四条口径，一次说清：

| 规则 | 说明 |
|---|---|
| **命中只认标题** | 描述命中降为弱命中，只进 JSON 备查，不告警 |
| **泛词双命中** | 泛科技频道标题里只有泛词（无强特征词/人名）→ 整条降级为弱命中 |
| **垂直频道例外** | 具身垂类频道（韩成龙Jackie / WhynotTV）不受限 —— 在那儿「量产」本身就是强信号 |
| **切片不算命中** | 博主切出的短视频切片永不告警，等完整版 |

### 6.3 验收：必须跑「真配置 × 真代码路径」

不要只测隔离函数。本机 10 条用例（全过）覆盖：
① 强词命中 ② 泛词单独出现不命中（`AGI 终局`）③ 泛词 + 强词双命中（`具身智能的量产终局`）④ 人名命中
⑤ 只在描述命中不告警 ⑥ 切片不算命中 ⑦ 垂类频道泛词仍命中 ⑧ 无关标题零命中 ⑨ 弱命中归档字段正确 ⑩ 描述不覆盖标题结论。

```bash
# 巡检实跑（今天 0 条新内容 → 无输出 = 静默，符合「无更新不打扰」）
python /opt/data/scripts/check-media-channels.py --dry-run --all -v
python /opt/data/scripts/check-media-channels.py -v        # 真实跑（写入 state）
```

---

## 7. 协作边界（谁改什么，别越界）

| 事项 | 归属 |
|---|---|
| 说话人分离脚本 / 合并脚本 / 评测脚本 / 巡检脚本 | Hermes 容器侧（`/opt/data/scripts/`） |
| PC 侧生成的文件（如 `domains/**/index.md`） | **保持 CRLF**；容器侧改写必须还原 CRLF，否则同步工具整文件冲突 |
| 文章本体（`raw/articles/*.md`） | 只替换 `## Transcript` 段；frontmatter / 目录 / 提炼段一字不动；head 逐字节校验 |
| 音频重跑 | **禁止**为了省体积而重跑已定稿的转写（见 §5.4） |
| 词表口径（关注话题、泛词名单） | 属**用户决策项**，改动前先确认，不擅自扩表 |

---

## 8. 可复用脚本清单（本机路径）

| 脚本 | 作用 |
|---|---|
| `/opt/data/scripts/diarize-media.py` | 说话人分离（`--speakers` / `--z` 阈值 / `--windowed` 分窗 / `--start --end` 片段） |
| `/opt/data/scripts/merge-diarization.py` | 合并声纹 + 转写（话术锚点 / 混段拆分 / 短问答修正 / 短段吸收 / 写回文章 `--article`） |
| `/opt/data/scripts/eval-jiapeng-diar.py` | 三层评测（A_audio / 锚点 / 主持人占比），支持 `--max-anchor` |
| `/opt/data/scripts/rerun-jiapeng-speakers.py` | 重跑作业：全流程 + 验收护栏 + 失败不写回 + 备份（`--test` / `--reuse-diar`） |
| `/opt/data/scripts/check-media-channels.py` | 频道巡检（命中口径 / 跨平台判重 / 状态落盘 / 静默） |
| `/opt/data/media-channels.yaml` | 频道与话题配置（`keywords` / `weak_keywords` / `people` / `generic_channels`） |

**备份约定**：改动运行中脚本前先 `cp X.py X.py.bak-<YYYYMMDD>`；本机已有 `diarize-media.py.bak-20260923`、`merge-diarization.py.bak-20260923`、`check-media-channels.py.bak-20260923`。

---

## 9. 待确认项（交给接手的人）

1. `--windowed` 分窗路径实测无效 —— 是**修**还是**直接摘掉参数**（避免后人误以为它在起作用）？
2. 泛词名单目前 13 词，`格局 / 终局` 是本次新增。是否还有同类泛词该收（如「融资」「开源」）？
3. 中段长对话的误标没有根治手段 —— 是否接受「开场/收尾逐句校对 + 中段如实标注风险」的现状？
4. 评测脚本 `eval-jiapeng-diar.py` 名字绑定了单期，是否改造成通用 `eval-diar.py --anchor-spec <yaml>`？
