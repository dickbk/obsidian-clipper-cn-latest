import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchBilibiliPlayurlAudioInPage, lookupBilibiliAudioInPage } from './bilibili-page-audio';

function jsonOk(data: unknown) {
	return Promise.resolve({
		json: () => Promise.resolve(data),
	});
}

function audioUrl(cid: number, qn = 30216): string {
	return `https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/00/00/${cid}/${cid}-1-${qn}.m4s`;
}

describe('lookupBilibiliAudioInPage', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		delete (globalThis as any).__playinfo__;
		delete (globalThis as any).__INITIAL_STATE__;
		delete (globalThis as any).__obsidianClipperBilibiliAudio;
	});

	test('serializes without TypeScript async helpers', () => {
		const source = lookupBilibiliAudioInPage.toString();
		expect(source).not.toMatch(/__awaiter|awaiter|__generator|__webpack/);
		expect(source).not.toMatch(/\basync\b/);
		expect(source).toContain('/x/player/playurl');
		expect(source).not.toContain('win.__playinfo__');
		expect(source).not.toContain('getEntriesByType');
	});

	test('ignores polluted __playinfo__ and always uses view+playurl', async () => {
		(globalThis as any).__playinfo__ = {
			data: {
				dash: {
					duration: 180,
					audio: [{ baseUrl: audioUrl(999888), bandwidth: 67175 }],
				},
			},
		};
		(globalThis as any).__INITIAL_STATE__ = {
			bvid: 'BV1s43t6UEaW',
			videoData: { bvid: 'BV1s43t6UEaW', cid: 40434271283, duration: 4224 },
		};
		vi.stubGlobal('fetch', vi.fn((url: string) => {
			if (String(url).includes('/x/web-interface/view')) {
				return jsonOk({
					code: 0,
					data: {
						bvid: 'BV1s43t6UEaW',
						cid: 40434271283,
						duration: 4224,
						pages: [{ page: 1, cid: 40434271283, duration: 4224 }],
					},
				});
			}
			return jsonOk({
				code: 0,
				data: {
					dash: {
						duration: 4224,
						audio: [{ baseUrl: audioUrl(40434271283), bandwidth: 1 }],
					},
				},
			});
		}));

		const result = await lookupBilibiliAudioInPage('BV1s43t6UEaW', 1);
		expect(result?.audioUrl).toBe(audioUrl(40434271283));
		expect(result?.cid).toBe(40434271283);
	});

	test('falls back to view+playurl when the page has no playinfo', async () => {
		vi.stubGlobal('fetch', vi.fn((url: string) => {
			if (String(url).includes('/x/web-interface/view')) {
				return jsonOk({
					code: 0,
					data: {
						bvid: 'BV1s43t6UEaW',
						cid: 111,
						duration: 4200,
						pages: [{ page: 1, cid: 111, duration: 4200 }],
					},
				});
			}
			return jsonOk({
				code: 0,
				data: {
					dash: {
						duration: 4200,
						audio: [{ baseUrl: audioUrl(111), bandwidth: 1 }],
					},
				},
			});
		}));

		const result = await lookupBilibiliAudioInPage('BV1s43t6UEaW', 1);
		expect(result?.audioUrl).toBe(audioUrl(111));
		expect(result?.cid).toBe(111);
	});
});

describe('fetchBilibiliPlayurlAudioInPage', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test('serializes without TypeScript async helpers', () => {
		const source = fetchBilibiliPlayurlAudioInPage.toString();
		expect(source).not.toMatch(/__awaiter|awaiter|__generator|__webpack/);
		expect(source).not.toMatch(/\basync\b/);
		expect(source).toContain('credentials');
		expect(source).toContain('include');
	});

	test('returns only audio whose CDN path encodes the requested cid', async () => {
		vi.stubGlobal('fetch', vi.fn(() => jsonOk({
			code: 0,
			data: {
				dash: {
					duration: 4224,
					audio: [
						{ baseUrl: audioUrl(999), bandwidth: 1 },
						{ baseUrl: audioUrl(40434271283), bandwidth: 2 },
					],
				},
			},
		})));

		const result = await fetchBilibiliPlayurlAudioInPage('BV1s43t6UEaW', 40434271283, 4224);
		expect(result?.audioUrl).toBe(audioUrl(40434271283));
		expect(result?.cid).toBe(40434271283);
		expect(result?.duration).toBe(4224);
	});
});
