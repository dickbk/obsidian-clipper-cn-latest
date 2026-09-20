#!/usr/bin/env bash
# clipper-cn-daily-patrol.sh — Hermes no_agent cron: stdout → 飞书晨检
# 依赖：curl、bash；可选 GH_TOKEN（提高 API 限额 / 读 security alerts）
# 不做：rebase、gh release、自动 push
set -euo pipefail

CN_REPO="dickbk/obsidian-clipper-cn-latest"
OFFICIAL_REPO="obsidianmd/obsidian-clipper"
DATE_CN=$(TZ=Asia/Shanghai date +%Y-%m-%d)

AUTH_HEADER=()
if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${GH_TOKEN:-$GITHUB_TOKEN}")
fi

gh_api() {
  local url="$1"
  curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: clipper-cn-daily-patrol" \
    "${AUTH_HEADER[@]}" \
    "$url"
}

# baseline: raw file on main
BASELINE=$(curl -fsSL \
  -H "User-Agent: clipper-cn-daily-patrol" \
  "https://raw.githubusercontent.com/${CN_REPO}/main/docs/official-baseline" \
  | tr -d '[:space:]' || echo "UNKNOWN")

LATEST_JSON=$(gh_api "https://api.github.com/repos/${OFFICIAL_REPO}/releases/latest" || echo "{}")
LATEST=$(printf '%s' "$LATEST_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 | sed 's/^v//')
[[ -z "$LATEST" ]] && LATEST="UNKNOWN"

OPEN_ISSUES=$(gh_api "https://api.github.com/repos/${CN_REPO}" \
  | sed -n 's/.*"open_issues_count"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
[[ -z "$OPEN_ISSUES" ]] && OPEN_ISSUES="?"

# Dependabot / security（无 token 或无权限时标注「未检查」）
SEC="未检查"
if [[ -n "${GH_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  ALERTS=$(gh_api "https://api.github.com/repos/${CN_REPO}/dependabot/alerts?state=open&per_page=5" 2>/dev/null || true)
  if printf '%s' "$ALERTS" | grep -q '"number"'; then
    N=$(printf '%s' "$ALERTS" | grep -c '"number"' || true)
    SEC="有 Dependabot open≈${N}"
  elif printf '%s' "$ALERTS" | grep -qi 'Not Found\|Bad credentials\|Must have'; then
    SEC="无权限/未启用"
  else
    SEC="无"
  fi
fi

FOLLOW_HINT=""
NEEDS="否"
if [[ "$BASELINE" != "UNKNOWN" && "$LATEST" != "UNKNOWN" && "$BASELINE" != "$LATEST" ]]; then
  NEEDS="是"
  FOLLOW_HINT=$(cat <<EOF

⚠ 官方有新版本：基线 ${BASELINE} → 最新 ${LATEST}
请 Codex 出升级策略（见 docs/ops-hermes-codex.md）。
同意后请回复：#同意升级 <CN产品版本>
Issue：https://github.com/${CN_REPO}/issues?q=label%3Aofficial-follow
EOF
)
fi

# 始终输出（每日全绿也要一条）；空 stdout 在 Hermes no_agent 下会静默
cat <<EOF
【Clipper CN 晨检】${DATE_CN}
官方基线：${BASELINE} | 官方最新：${LATEST} | 需跟进：${NEEDS}
CN 开 Issue：${OPEN_ISSUES} | Security/Dependabot：${SEC}
链接：https://github.com/${CN_REPO}/issues
${FOLLOW_HINT}
EOF
