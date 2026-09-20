#!/usr/bin/env node
/**
 * Compare docs/official-baseline with the latest official Web Clipper release tag.
 * Prints JSON to stdout. Exit 0 always (unless fetch fails).
 *
 * Usage: node scripts/detect-official-update.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'docs', 'official-baseline');
const OFFICIAL_REPO = 'obsidianmd/obsidian-clipper';

function readBaseline() {
	const raw = fs.readFileSync(BASELINE_PATH, 'utf8').trim();
	if (!/^\d+\.\d+\.\d+/.test(raw)) {
		throw new Error(`Invalid baseline in ${BASELINE_PATH}: ${raw}`);
	}
	return raw;
}

function fetchJson(url) {
	return new Promise((resolve, reject) => {
		const req = https.get(
			url,
			{
				headers: {
					'User-Agent': 'obsidian-clipper-cn-latest-detect',
					Accept: 'application/vnd.github+json',
				},
			},
			(res) => {
				let body = '';
				res.on('data', (c) => (body += c));
				res.on('end', () => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
						return;
					}
					try {
						resolve(JSON.parse(body));
					} catch (e) {
						reject(e);
					}
				});
			}
		);
		req.on('error', reject);
	});
}

async function main() {
	const baseline = readBaseline();
	const release = await fetchJson(
		`https://api.github.com/repos/${OFFICIAL_REPO}/releases/latest`
	);
	const latest = String(release.tag_name || '').replace(/^v/, '');
	const needsUpdate = Boolean(latest && latest !== baseline);
	const out = {
		baseline,
		latest,
		needsUpdate,
		officialReleaseUrl: release.html_url || null,
		officialPublishedAt: release.published_at || null,
		checkedAt: new Date().toISOString(),
	};
	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch((err) => {
	console.error(err.message || err);
	process.exit(1);
});
