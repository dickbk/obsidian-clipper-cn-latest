# Hermes Token 消耗优化方法论

> 撰写：2026-09-22 | 环境：NAS Docker 内 Hermes（`/opt/data`，模型 deepseek-v4-flash，窗口 1,000,000）
> 用途：跨 agent 经验共享（Codex / Cursor）。本文自成一体，不依赖任何会话上下文。
> 数据来源：`state.db`、`cron/usage_audit.jsonl`、`logs/agent.log`，均为只读查询。
> 仓库路径：`dickbk/obsidian-clipper-cn-latest` → `docs/hermes-token-optimization.md`
> 相关：[ops](ops-hermes-codex.md) · [B站批量收录](hermes-bilibili-batch-ingest.md)

---

## 0. 结论先行

这个 Hermes 在 35 天内烧了 **365M 输入 tokens**。拆开看：

| 来源 | 量 | 占比 |
|---|---|---|
| **主会话（飞书长对话）** | **295.5M** | **80.9%** |
| cron 定时任务 | 42.4M | 11.6% |
| subagent | 27.2M | 7.4% |

**两个真凶，成因完全不同：**

1. **主会话 = 上下文重放**（80.9%）。单次 API 调用平均要重发 **188,993 tokens** 的上下文。这在 LLM API 里是正常机制（每次调用都要重发完整历史），但代价随会话长度**二次增长**。
2. **cron = 固定开销**（11.6%）。每次运行都要重新加载整套系统提示。其中 backlog-sync 一个任务占 cron 的 **89.7%** —— 每 30 分钟跑一次，**99% 的运行只是"看一眼没活干就退出"**，但每次都照付 33,119 tokens。

**优化动作与效果：**

| 动作 | 效果 | 状态 |
|---|---|---|
| backlog-sync 改 no_agent（工具调用下沉到脚本） | 单次 33,119 → **0** | ✅ 已完成，系统报告 `API calls: 0` |
| backlog-sync 降频 `*/30` → `0 *` | -50%（被上一项覆盖后归零） | ✅ 已完成 |
| 压缩阈值 `threshold_tokens` 256,000 → 100,000 | 触发点 -61% | ✅ 已改，待实测复核 |
| 尾部保护 `protect_last_n` 20 → 12 | 压缩后残留预计 ~79.7K → ~31K | ✅ 已改，待实测复核 |

---

## 1. 第一步：定口径（90% 的人在这里算错）

### 1.1 什么叫"token 消耗"

```
总输入 = input_tokens + cache_read_tokens
```

**只看 `input_tokens` 会漏掉约 97% 的量。** 本项目缓存读取占输入 97%（397M / 408M）—— 因为每轮对话前缀基本不变，绝大部分走命中缓存。

缓存价通常是全价的 1/10，所以**成本上**要看全价部分，但**机制上**要看总量 —— 优化重放省的是总量，优化文案省的是全价部分。**两个数都要看，别混着报。**

### 1.2 三个数据源

| 数据源 | 有什么 | 适合回答 |
|---|---|---|
| `state.db` → `sessions` 表 | 会话级累计 `input_tokens` / `cache_read_tokens` / `api_call_count` | 谁在烧、烧了多少 |
| `cron/usage_audit.jsonl` | 每次 cron 运行的逐条记录 | 哪个定时任务在烧 |
| `logs/agent.log` | 压缩事件（`protected_tail_tokens` 等） | 压缩机制的真实参数 |

**⚠️ 重要口径限制（踩过坑）**：`messages.token_count` 这一列在库里 **100% 为空**（0/10,827 有值）。所以**拿不到消息级 token**，无法精确按日切分。`sessions` 的 token 是**会话级累计值**，按 `messages.timestamp` 筛会话会导致跨天会话在每一天都被算全量 —— **数据严重重叠**（曾算出"今日 308M"这种荒谬值）。

**正确做法**：按 `sessions.started_at` 归日。不重叠，代价是跨天长会话的用量全记在起点日。

### 1.3 ⭐ 最有价值的单指标

```
主会话平均单次输入 = 主会话累计总输入 ÷ API 调用次数
```

本项目 = **188,993**。这个数字直接反映**上下文重放严重度**，且不受归日口径影响 —— 优化效果好不好，盯它一个就够。

**注意**：这个指标必须**脱离日期单独查**（主会话起点在很久以前，按"最近 N 天"筛选永远筛不到它）。这是实际踩过的坑。

---

## 2. 第二步：找出谁在烧

```bash
# 按来源拆（主会话 / cron / subagent）
sqlite3 -readonly /opt/data/state.db "
  SELECT source,
         COUNT(*) n,
         SUM(COALESCE(input_tokens,0)+COALESCE(cache_read_tokens,0)) total_in,
         SUM(COALESCE(api_call_count,0)) api
    FROM sessions GROUP BY source ORDER BY total_in DESC;"

# 单会话排名（找出异常粗的会话）
sqlite3 -readonly /opt/data/state.db "
  SELECT substr(id,1,30), source,
         COALESCE(input_tokens,0)+COALESCE(cache_read_tokens,0) ti,
         COALESCE(api_call_count,0) api
    FROM sessions ORDER BY ti DESC LIMIT 10;"
```

**看到什么算什么**：

- 某个来源占比 > 70% → 优先攻它
- 单会话累计 > 100M → 上下文重放问题，去调压缩
- 某 cron job 单次 > 30K → 固定开销问题，考虑 no_agent
- 会话数多但每个很小 → 检查是否有空转任务

---

## 3. 四类优化手段（按收益排序）

### 3.1 消除固定开销 —— 收益最大、最彻底

**症状**：cron/subagent 单次 3 万+ tokens，任务本身却很轻。

**成因**：agent 型 cron 每次运行都要加载完整系统提示（工具定义 + 指令 + 技能清单 + MEMORY + USER）。本项目这套约 **33K tokens**，与任务大小无关。

**解法：工具调用下沉 + `no_agent`**

判断链：

```
这个 cron 需要 LLM 推理吗？
├─ 不需要（只是"跑脚本 → 转发输出"）→ 直接改 no_agent
└─ 需要（要看内容、做判断）
   ├─ prompt 里有没有工具调用（如写记忆、发消息）？
   │  ├─ 有 → 把该步骤下沉到脚本（脚本自己调 HTTP API），再改 no_agent
   │  └─ 没有 → 评估降频，或让脚本做预处理只把摘要喂给 LLM
   └─ 判断逻辑复杂，脚本写不了 → 保留 agent，改降频
```

**⚠️ 最大的坑**：`no_agent` **不调推理、也不调工具**。如果原 prompt 里夹着 `hindsight_retain` 之类的工具调用而你没把它下沉，**切完会静默丢掉那一步** —— 任务"成功"了，但副作用没发生。

本项目实例：`poll-backlog-sync.py` 已经用 `urllib` 直调思源 API，`build_retain_summary()` / `format_feishu_message()` 都是纯 Python —— 唯一必须走 agent 的只有 `hindsight_retain` 这一步。换成 `POST /v1/.../memories` 之后，整个 job 不再需要 LLM。

### 3.2 降低重放基数 —— 改会话生命周期

**症状**：主会话平均单次输入 > 15 万。

**原理**：每轮 API 调用都要重发完整对话历史。会话越长，单次越贵。设阈值 T、压缩后残留 R、平均轮次 N，总输入约为：

```
总输入 ≈ N × (T + R) / 2
```

**解法按收益排序**：

| 手段 | 效果 | 代价 |
|---|---|---|
| **开新会话** | 最彻底（重放基数归零） | 需确认持久层不丢信息 |
| **降低压缩阈值 T** | 线性下降 | 压缩更频繁（但压缩本身很便宜） |
| **减小残留 R**（`protect_last_n`） | 直接削减后半段 | 保护的历史变少 |

**⚠️ 别做的事：micro-compaction。** 它每轮重写历史，破坏 prompt-cache 前缀命中。本项目缓存读取占 97%，命中率被破坏的代价远大于收益。

### 3.3 收窄触发条件 —— 调阈值

**先搞清楚阈值到底是多少，再谈调。** 本项目曾以为阈值是 50%（`threshold: 0.5`），实际从未生效：

```
threshold_percent = 0.5
threshold = int(1,000,000 × 0.5) = 500,000
threshold = min(500,000, threshold_tokens_cap, ctx)
threshold_tokens_cap = 256,000      ← 出厂默认，来自 config_defaults.py
最终 threshold = 256,000
```

**⚠️ 排查方法**：不要只看配置文件，去 `agent.log` 里 grep 实际的 `effective_threshold`。配置写了不等于生效。

**阈值怎么定**（有公式，别凭经验）：

```
总输入 ≈ N × (T + R)/2 + (D / (T − R)) × C

T = 触发阈值    R = 压缩后残留    C = 单次压缩成本
N = 总轮次      D = 总 token 需求
```

**两个约束**：

1. `T > R`（否则压缩完立刻又超阈值 → 死循环）
2. `(T − R)` **不能太小** —— 这是关键。T 接近 R 时，压缩次数 `D/(T−R)` 爆炸式增长，**总量反而上升**。

代入本项目实测值（R=78K，C=38K）：

| T | 压缩次数 | 总输入 | vs 原值 |
|---|---|---|---|
| 256,000（原值） | 13 | 295M | — |
| 120,000 | 55 | 154M | -48% |
| 100,000 | 105 | 141M | -52% |
| **85,000** | 331 | **138M** | **-53%（甜点）** |
| 80,000 | 1,157 | 165M | **-44%（反弹）** |

**先测出真实的 R，再回代公式定 T。** 不要照抄别人的数字。

### 3.4 压缩常驻内容 —— 收益最小，最后做

**症状**：想通过"清理 MEMORY.md / 精简技能"省 token。

**实测**：本项目 MEMORY.md + USER.md = 3,403 字符，占压缩后残留的 **4.3%**。**全删掉也只省 4%。**

系统提示本体 25,554 字符，其中技能清单约 7,217 字符（28%）、工具定义与指令约 14,934 字符（58%）—— 这部分**改不动**（工具定义是框架的）。

**结论：文档卫生不是主要矛盾。** 压缩后残留的大头是 `protect_last_n` 撑出的消息体量（本项目占 65%），**那是配置问题，不是文档问题**。

**Hindsight 类长期记忆也不是常驻成本** —— 它是按需召回，不是全量注入，常驻开销约等于 0。不需要"定期梳理"。

---

## 4. ⭐ 关键认知：优化项之间常常不可叠加

多个优化看似能累加，实际会被**乘法归零**。判断法：把每项写成

```
改变次数 × 改变单次成本
```

再相乘。本项目实例：

| 方案 | 次数 | 单次 | 结果 |
|---|---|---|---|
| 现状 | 1,150 | 33,119 | 38.09M |
| A：降频到 60 分钟 | 575 | 33,119 | 19.05M（-50%） |
| B：改 no_agent | 1,150 | **0** | **0（-100%）** |
| **B 之后再做 A** | 575 | **0** | **0 —— 与只做 B 完全相同** |

**B 在 token 维度上是 A 的超集。** 做完 B 再降频，一分钱不再省。

**但次序仍建议先 A 后 B**：A 一分钟、无副作用、立刻拿 -50%；B 要走派发 → 实现 → 验证（可能数天）。期间 A 的收益已经落袋，最终数字相同而中间几天不白烧。

**报告时要讲清"省的是哪一头"**：把工具调用下沉到脚本后，被调服务**自己**的 LLM 开销不变。本项目实例：Hindsight 服务端每次 retain 仍会做事实提取（响应里 `usage.input_tokens ≈ 3150`），这部分照旧。省掉的只是 Hermes 侧 agent 框架的固定开销。**不说清这条，对账单会和预期差很远。**

---

## 5. 什么不值得优化

| 别做 | 原因 |
|---|---|
| 定期梳理 MEMORY.md / USER.md | 占残留 4.3%，全删也只省 4% |
| "优化"Hindsight 常驻开销 | 按需召回，常驻 ≈ 0 |
| 为减少压缩次数而抬高阈值 | 压缩本身极便宜（13 次共 0.17%） |
| 启用 micro-compaction | 破坏 prompt-cache 前缀，缓存占 97% 时得不偿失 |
| 砍掉长会话/批量 subagent | 那是**为功能付的必要成本**，不是浪费 |

**判断原则**：区分"可优化的浪费"和"为功能付的必要成本"。长会话是设计选择的结果，批量 subagent 是并行能力的结果 —— 它们**不都是问题**。

---

## 6. 坑与解法（全部实测踩过）

| 坑 | 表现 | 解法 |
|---|---|---|
| **配置写了不生效** | `threshold: 0.5` 看着对，实际 `effective_threshold: 256000` | 去 `agent.log` grep 实际值，别信配置文件 |
| **agent 不能改 config** | 直接 patch `config.yaml` 被护栏拒绝：*"Refusing to write to Hermes config file"* | 用 `hermes config set <key> <value>` |
| **压缩参数生效时机** | 以为要重启 | `compression.*` 改动**下一条消息即生效**，无需重启 |
| **归日口径重叠** | 按 `messages.timestamp` 筛会话 → "今日 308M"（实际累积才 295M） | 按 `sessions.started_at` 归日 |
| **单指标查不到** | 主会话平均单次输入永远为空 | 它起点在很久以前，必须脱离日期单独查 |
| **消息级 token 不可得** | 想精确按日切分 | `messages.token_count` 100% 为空，此路不通 |
| **no_agent 静默丢步骤** | 切完任务"成功"但副作用没发生 | 切之前先核 prompt 里有无工具调用；有就下沉到脚本 |
| **no_agent 的 stdout 语义** | 以为会包一层格式 | stdout **原样投递**；**空 stdout = 完全不发**（watchdog 模式）；非零退出码 → 发错误告警 |
| **凭经验定阈值** | 拍脑袋定 50% | 用 §3.3 的公式算，先测 R |
| **改完不验证** | 以为生效了 | 看运行报告有无 `Mode: no_agent (script)` 行 + 对比 `executions.db` 耗时 |
| **拿 `API calls: 0` 当"零 LLM"证据** | 它没有判别力（agent 型同样是 0） | 改为看报告结构 + 耗时 |
| **模型名用官方品牌名** | `deepseek-v4.1-flash` 直接 HTTP 400（真实 ID 是 `deepseek-flash`） | 换模型前先探真实 ID；`model_metadata.py` 里登记 ≠ API 认 |
| **跨天环比误导** | 「今天总量比昨天 -94%」像优化成果，其实是昨天有并行 subagent、今天没有 | 对比必须同源比同源（`by_source_*`）；总量下跌不要当成果报 |

---

## 7. 可复用脚本与命令

### 7.1 日常检查（本项目已部署为 daily-reflect 的一部分）

```bash
# 人读
/opt/hermes/.venv/bin/python /opt/data/scripts/token-daily-check.py

# 机器读（只输出 ~400 tokens 的 JSON，给 agent 消费）
/opt/hermes/.venv/bin/python /opt/data/scripts/token-daily-check.py --json
```

输出结构：

```json
{
  "date": "2026-09-22",
  "total_today": 1526753,
  "total_prev": 29003798,
  "by_source_today": {"cron": 1526753},
  "main_session": {"id": "...", "total": 307847475, "api_calls": 1636, "per_call": 188170},
  "flags": ["主会话平均单次输入 188,170（上下文重放偏重）"],
  "pending_optimizations": ["主会话压缩阈值实测复核", "..."]
}
```

**agent 只看 `flags`**（空数组 = 正常）。`pending_optimizations` 是一份**待办清单**（`/opt/data/state/token-optimization-backlog.md`）里的未完成项 —— 目的是**避免每天重复提同一件事**。

### 7.2 看压缩机制的真实参数

```bash
grep -oE 'protected_(tail|head)_tokens[^,]*|effective_threshold[^,]*|Preflight compression[^"]*' \
  /opt/data/logs/agent.log | tail -20
```

### 7.3 no_agent 改造后的验证

```bash
# ① 看运行报告结构（最可靠）：出现 `Mode: no_agent (script)` 才算切换成功
#    agent 型报告里是 `Schedule:` + ## Prompt + ## Response，没有 Mode 行
#    ⚠️ 别用 `API calls: 0` 判断 —— 那是外层委托计数，agent 型同样为 0
# ② 耗时对比
sqlite3 -readonly /opt/data/cron/executions.db \
  "SELECT started_at, finished_at FROM executions ORDER BY started_at DESC LIMIT 5;"
# ③ 脚本自身日志
tail -20 /opt/data/logs/backlog-sync-run.log
```

### 7.4 回滚配置

```bash
H=/opt/hermes/.venv/bin/hermes
$H config get compression.threshold_tokens      # 看当前值
$H config set compression.threshold_tokens 256000   # 回滚
```

### 7.5 换某个 cron 任务的模型

**cronjob 工具改不了 model/provider**（传了报 `No updates provided.`，该字段不在它的 schema 里）。必须用 CLI：

```bash
H=/opt/hermes/.venv/bin/hermes

# 先备份（CLI 会原地重写 jobs.json，备份是唯一回滚路径）
cp -a /opt/data/cron/jobs.json /opt/data/cron/jobs.json.bak-before-model-change-$(date +%Y%m%dT%H%M%S)

$H cron edit <job_id> --model <API真实ID> --provider <provider>

# 核对落盘
python3 -c "import json; j=json.load(open('/opt/data/cron/jobs.json')); \
  print([(x['name'], x.get('model')) for x in (j if isinstance(j,list) else j['jobs'])])"
```

**⚠️ 模型名必须用 API 真实 ID，官方品牌名会 400。** 实测：传 `deepseek-v4.1-flash` 得到
`The supported API model names are deepseek-flash, deepseek-v4-pro`。真实 ID 是 **`deepseek-flash`**；
`deepseek-v4-flash` 是指向它的**别名**（传别名，返回的 `model` 字段是 `deepseek-flash`）。

**陷阱**：Hermes 的 `model_metadata.py` 里**登记了** `deepseek-v4.1-flash`（连 1M 窗口都标了），
所以它「看起来存在」、`hermes cron edit` 也不会拦你 —— **只有真调用才 400**。
换模型前先用 `GET /v1/models` 或一个 `max_tokens:1` 的探测请求确认真实 ID。

**回滚**：用备份覆盖 jobs.json，再 `hermes cron list` 核对。

**换完必须验收质量**：手动 `run` 一次，与换前输出逐条对比（信息密度、是否带数字、有没有过度归因）。
本次实测：daily-reflect 换 flash 后耗时 **158.79s → 81.62s**、输出 **4 条 → 5 条且带具体数字**，质量未降。

---

## 8. 协作边界（给 Codex / Cursor）

| 事项 | 谁来定 |
|---|---|
| 改 cron 频率 / 切 no_agent | 运维性改动，凡只涉及容器内脚本与 cron 配置，可**绕过 PC 派发流程**直接做（有先例） |
| 改 Hermes 配置 | **只能用 `hermes config set`**，agent 直接写 config.yaml 会被护栏拒绝 |
| 改业务代码（vault、抓取、wiki） | 走正常派发流程 |
| 新增脚本 | 新增独立文件，**不改运行中的脚本** —— 这样回滚 = 删新文件，秒级复位 |

**改动铁律**：

1. **可回滚** —— 改前先备份（job 配置 JSON / 脚本副本 / config 快照），并写出回滚步骤
2. **不覆盖运行中的文件** —— 新增编排层，原脚本一行不动
3. **失败时宁可重试不可丢数据** —— 本项目安全阀：写记忆失败时**绝不**回写"已同步"标记，让下轮自动重试
4. **改完必须实测** —— 看运行报告的**结构**（有没有 `Mode: no_agent (script)` 行）与 `executions.db` 耗时；**不要用 `API calls` 这个数字判**（它没有判别力，见 §9）
5. **验证用临时命名空间** —— 写测试只往临时 bank/库写，验完删除，不碰生产数据

---

## 9. 本项目实测数据（2026-09-22，供对照）

**总量**：35 天 365M 输入 tokens，成本约 $5.04。

**主会话**：1,534 次 API 调用，平均单次 192,600；4,230 条消息中 82.2% 已压缩。持久层 = MEMORY.md 3,287 B + USER.md 2,598 B + 101 个技能 + Hindsight（远程）+ `state.db` 10,316 条 + 磁盘 12,400+ 文件。

**压缩后残留 79,681 tokens 的拆解**：

| 部分 | tokens | 占比 |
|---|---|---|
| 尾部保护（`protect_last_n=20`） | 51,834 | **65%** |
| 系统侧常驻 | 27,847 | 35% |
| ├ 系统提示本体 | 25,554 chars | 技能清单 28% + 工具与指令 58% |
| ├ MEMORY.md | 2,161 chars | |
| └ USER.md | 1,242 chars | |

**关键**：**65% 是配置撑出来的消息体量，不是文档臃肿。** 这也是为什么"定期梳理文档"是伪命题。

**cron 明细**：

| job | 次数 | 单次 | 合计 |
|---|---|---|---|
| backlog-sync | 1,150 | 33,119 | **38.09M** |
| daily-reflect | 22 | 101,580 | 2.23M |
| project-digest | 47 | 45,290 | 2.13M |
| clipper-cn-patrol | 1 | 17,370 | 17K |

**backlog-sync 改造后的硬证据**（cron 运行报告 + executions.db）：

| 判据 | agent 型 | no_agent 型 |
|---|---|---|
| **报告头部结构** | `Schedule:` + 完整 `## Prompt` + `## Response` | **`Mode: no_agent (script)`** + `Status: silent (empty output)` |
| **单次耗时** | 19:30 那次 **3.94 秒**（等 LLM 往返） | 19:56 **0.21 秒** / 20:00 首跑 **0.29 秒** |

**⚠️ 别拿 `API calls: 0` 当判据 —— 它没有判别力。** 那是 cron_run **外层委托**的计数，
与 job 内部是否调 LLM 无关：实测 daily-reflect 是 agent 型、跑了 **158.79 秒**、明确调了 LLM，
报告里同样写着 `API calls: 0`。**可靠判据是报告结构（有没有 `Mode:` 行）+ 耗时对比。**

**换模型的 A/B 实测**（daily-reflect，同一天前后两次手动 run，其余变量不变）：

| | `deepseek-v4-pro` | `deepseek-v4-flash` |
|---|---|---|
| 耗时 | 158.79 s | **81.62 s（-49%）** |
| 输出 | 4 条，偏概括 | **5 条，带具体数字** |
| 单次成本（10.2 万 tokens、97% 缓存命中） | ≈ $0.0063 | **≈ $0.0008** |

**但省的钱极少**：daily-reflect 每天 1 次 × 10 万 tokens ≈ 3M/月，**只占总用量 0.6%** → 每月约省 $0.17。
**换模型的价值在能力与口径统一，不在省钱**；省钱的主战场是主会话重放（占 80.9%）。

**分源对比的教训（本项目真踩过）**：检查脚本里给了 `total_today` vs `total_prev` 的环比，
agent 据此报出「今天定时用量比昨天掉 94%」——**数字全对，但对比无意义**：

| 日期 | subagent | cron |
|---|---|---|
| 09-21 | 27,156,399 | 1,847,399 |
| 09-22 | —（当天无并行任务） | 1,705,518 |

**同源对比（cron vs cron）只降 7.7%，不是 94%。** 那个 -94% 纯粹是「昨天跑了 2700 万 subagent」造成的，
与当天的优化改动毫无因果关系。**教训：跨天对比必须同源比同源；「总量下跌」不要当优化成果报给用户。**

---

## 附：一句话速查

- **口径**：总输入 = `input_tokens` + `cache_read_tokens`；只看前者漏 97%
- **归日**：按 `sessions.started_at`，不要按 messages（会重叠）
- **盯一个数**：主会话平均单次输入（重放严重度）
- **优先攻**：固定开销（no_agent）> 重放基数（会话生命周期）> 阈值 > 文档卫生
- **切 no_agent 前**：先核 prompt 里有没有工具调用，有就下沉到脚本
- **阈值**：先测 R，再回代 `总输入 ≈ N×(T+R)/2 + (D/(T−R))×C`，注意 T 不能太接近 R
- **不叠加**：次数 × 单次成本；单次打到 0 后降频不再省
- **改配置**：只能 `hermes config set`，`compression.*` 下一条消息生效
- **验证**：认运行报告里的 `Mode: no_agent (script)` + `executions.db` 耗时；`API calls` 这个数没有判别力
- **换 cron 模型**：`hermes cron edit <id> --model <API真实ID>`（cronjob 工具改不了）；模型名要用 API ID，官方品牌名会 400
- **跨天对比**：必须同源比同源；总量环比下跌 ≠ 优化成果
- **不折腾**：MEMORY/USER 只占 4.3%，Hindsight 按需召回，压缩本身 0.17%
