## Scripts

### Localization

First, add an OpenAI API key in `.env` at the root of the repo:

```
OPENAI_API_KEY=sk-...
```

Scripts can be run using npm in the root of the repo.

#### Update locale

```
npm run update-locales
```

- Checks the English locale file and automatically translates missing strings
- Reorganizes strings alphabetically

#### Add locale

```bash
npm run add-locale fr
```

### Detect official update（仅检测）

```bash
node scripts/detect-official-update.js
```

- 对比 `docs/official-baseline` 与官方 latest release
- GitHub Action：`.github/workflows/follow-official.yml`（北京 06:00 等价 cron；有差则开 `official-follow` Issue，**不** rebase）
- 流程见 [`docs/ops-hermes-codex.md`](../docs/ops-hermes-codex.md)

### CN overlay rebase（跟随官方）

```bash
npm run overlay:rebase -- 1.8.0
```

- 将当前 CN 分支变基到官方 tag（默认取 upstream 最新数字 tag）
- **须**在飞书 `#同意升级`（或 Cursor 确认）之后由人/Codex 执行
- 完整流程见 [`docs/architecture-cn.md`](../docs/architecture-cn.md)

### Version bump

```bash
./scripts/bump-version.sh 1.0.1
```

- Updates `version` in `package.json`, all browser manifests, and `dev/manifest.json`
- Updates `MARKETING_VERSION` in the Xcode project
- Increments `CURRENT_PROJECT_VERSION` by 1

### Changelog

```bash
./scripts/generate-changelog.sh
```

- Generates `changelogs/<version>.md` from commits since the last git tag
- Reads the version from `package.json`
- Commits starting with "fix" are grouped under an **Improved** section
- Version bump commits are excluded