# NAS Hermes：登记 clipper-cn-daily-patrol

目标：每天北京 **06:00** 跑脚本，把 stdout **原样**发到飞书（`no_agent`，不耗模型）。  
监听 `#同意升级` 仍靠日常飞书对话（不是这条 cron）。

参考：[Hermes Cron — no-agent / script](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)

---

## A. 把脚本放到 Hermes 容器能读到的路径

在 NAS 上（路径按你现网 Hermes `HERMES_HOME` / data 卷调整；Lilo 同机常见 `/opt/data`）：

```bash
# 例：主机路径（按实际改）
mkdir -p /volume1/docker/MultAgent/hermes/data/scripts
# 从本仓库拷贝：
#   official/deploy/hermes/clipper-cn-daily-patrol.sh
# → /volume1/docker/MultAgent/hermes/data/scripts/clipper-cn-daily-patrol.sh

# 关键：属主必须是容器内 hermes 用户（现网常见 uid/gid 10000），
# 权限至少对属主可执行。Synology / 外部同步常写成 1000:uucp + 0600 → hermes 读不了。
chown 10000:10000 /volume1/docker/MultAgent/hermes/data/scripts/clipper-cn-daily-patrol.sh
chmod 700 /volume1/docker/MultAgent/hermes/data/scripts/clipper-cn-daily-patrol.sh

# 容器内冒烟（容器名按实际改）
sudo docker exec <hermes容器名> bash -lc \
  '/opt/data/scripts/clipper-cn-daily-patrol.sh'
```

若上传后 Hermes 报「读不了 / 已用等效脚本顶上」：先按上面 `chown`+`chmod`，再在飞书让它把 job 的 script 切回该文件并 `cron run` 一次。

可选：在 Hermes 环境变量里加 `GH_TOKEN`（classic 或 fine-grained，至少公开仓只读；要 Dependabot 再加 security 相关权限）。无 token 也可跑（公开 API），Security 行会显示「未检查」/ unavailable。

---

## B. 飞书发给 Hermes（登记 cron）— 整段粘贴

先确认该会话已 `/set-home`（或已配置 `FEISHU_HOME_CHANNEL`），否则结果可能无处投递。

```text
请用 cronjob 工具创建（若已存在同名则先 list 再 edit）定时任务：

- name: clipper-cn-daily-patrol
- schedule: 0 6 * * *（Asia/Shanghai，每天早上 6:00）
- no_agent: true
- script: /opt/data/scripts/clipper-cn-daily-patrol.sh
  （若你容器内路径不同，改成实际绝对路径）
- deliver: feishu（投递到当前会话 / home）
- 行为：只跑脚本；stdout 全文作为飞书消息；禁止 rebase、禁止 gh release、禁止 push

创建后请：
1. list 确认任务存在且 schedule / script / no_agent 正确
2. 立刻 run 一次该 job，让我在飞书收到一条「【Clipper CN 晨检】」冒烟结果
```

若 Hermes 不支持你这版的 `no_agent`，改用备选（会耗模型）：

```text
请创建 cron：name=clipper-cn-daily-patrol，每天 06:00 Asia/Shanghai，deliver=feishu。
每次执行：运行 bash /opt/data/scripts/clipper-cn-daily-patrol.sh，把脚本 stdout 原样发给我；不要改写、不要 rebase。
然后 list + 立刻 run 一次冒烟。
```

---

## C. 口令约定（飞书记死，对话非 cron）

**格式（唯一有效）：** `#同意升级 <CN产品 semver>`  
示例：`#同意升级 0.2.0`  
无效：只写官方号、漏版本号、改成别的前缀。

同一飞书会话（晨检投递的那个 home）整段发给 Hermes：

```text
【口令约定 · Clipper CN · 请写入长期记忆并严格执行】

唯一发版同意口令格式：
#同意升级 <CN产品版本>
例：#同意升级 0.2.0

规则：
1. 仅当消息以「#同意升级」开头且后面带 semver（如 0.2.0）时，视为同意升级。
2. 收到后立刻飞书回复确认：已记录同意升级到该 CN 版本；并明确提醒 Codex 按 https://github.com/dickbk/obsidian-clipper-cn-latest/blob/main/docs/ops-hermes-codex.md 执行（rebase → 回归 → 更新版本表与 docs/official-baseline → Release）。
3. 禁止：你自己 rebase、git push、gh release、改官方基线。
4. 无此口令（且无 Cursor 侧确认）→ 只保留晨检 / official-follow Issue，不触发升级执行。
5. 双通道：Cursor 口头确认可作为补充；但飞书以此口令为准。请确认已记住，并简短回复「口令约定已生效」。
```

---

## D. 验收清单

- [x] 容器内 / cron run 冒烟出现「【Clipper CN 晨检】」+ PC 版字段格式
- [x] Hermes `cron list` 有 `clipper-cn-daily-patrol`（每天 06:00）
- [ ] 飞书回复「口令约定已生效」（完成本节粘贴后）
- [ ] （可选）明天 06:00 自动晨检

仓内脚本与说明：`deploy/hermes/`。完整 ops：`docs/ops-hermes-codex.md`。
