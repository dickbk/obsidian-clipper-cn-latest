import { describe, expect, test } from 'vitest';
import {
	audioUrlBelongsToCid,
	audioUrlStrictlyMatchesCid,
	cidFromDashAudioUrl,
	dashDurationMatches,
	preferAlternateCdnUrls,
} from './bilibili-audio-match';

describe('bilibili audio match', () => {
	test('reads cid from a DASH m4s filename', () => {
		expect(cidFromDashAudioUrl(
			'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/11/123456789/123456789-1-30280.m4s?e=ig8'
		)).toBe(123456789);
	});

	test('rejects an audio URL that belongs to another cid', () => {
		const related = 'https://xy.bilivideo.com/upgcxcode/01/02/999/999-1-30216.m4s';
		expect(audioUrlBelongsToCid(related, 123456789)).toBe(false);
		expect(audioUrlBelongsToCid(related, 999)).toBe(true);
	});

	test('keeps unknown URL shapes only when no cid is required', () => {
		expect(audioUrlBelongsToCid('https://cdn.example/audio.bin')).toBe(true);
		expect(audioUrlBelongsToCid('https://cdn.example/audio.bin', 111)).toBe(false);
		expect(audioUrlStrictlyMatchesCid('https://cdn.example/audio.bin', 111)).toBe(false);
	});

	test('accepts a real DASH path that contains the cid as a directory', () => {
		expect(audioUrlBelongsToCid(
			'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/83/12/40434271283/40434271283-1-30216.m4s?e=ig8',
			40434271283
		)).toBe(true);
	});

	test('allows similar durations but rejects a clearly different length', () => {
		expect(dashDurationMatches(4180, 4200)).toBe(true);
		expect(dashDurationMatches(180, 4200)).toBe(false);
		expect(dashDurationMatches(4200, 4200)).toBe(true);
	});

	test('downloads from a different CDN host first so the player keeps the primary URL', () => {
		expect(preferAlternateCdnUrls(
			'https://upos-sz-mirrorcos.bilivideo.com/a.m4s',
			[
				'https://upos-sz-mirrorcos.bilivideo.com/b.m4s',
				'https://xy.bilivideo.com/a.m4s',
			]
		)).toEqual([
			'https://xy.bilivideo.com/a.m4s',
			'https://upos-sz-mirrorcos.bilivideo.com/a.m4s',
			'https://upos-sz-mirrorcos.bilivideo.com/b.m4s',
		]);
	});
});
