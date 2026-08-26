#!/usr/bin/env node
/**
 * Rebase the CN overlay branch onto the latest official tag.
 * Usage: node scripts/rebase-overlay.js [tag]
 */
const { execSync } = require('child_process');

function run(command) {
	return execSync(command, { encoding: 'utf8' }).trim();
}

function latestOfficialTag() {
	run('git fetch upstream --tags');
	const tags = run('git tag --list "[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname')
		.split(/\r?\n/)
		.filter(Boolean);
	if (tags.length === 0) {
		throw new Error('No numeric tags found on upstream');
	}
	return tags[0];
}

const tag = process.argv[2] || latestOfficialTag();
console.log(`Rebasing CN overlay onto official ${tag}`);
execSync(`git rebase ${tag}`, { stdio: 'inherit' });
