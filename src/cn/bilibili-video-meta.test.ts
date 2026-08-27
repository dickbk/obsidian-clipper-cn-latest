import { describe, expect, test, vi } from 'vitest';
import {
	buildBilibiliEmbedUrl,
	rewriteBilibiliEmbedHtml,
	resolveBilibiliVideoMeta,
} from './bilibili-video-meta';

const meta = {
	bvid: 'BV1s43t6UEaW',
	aid: 114514,
	cid: 40434271283,
	page: 1,
	expectedDuration: 4224,
};

describe('bilibili embed binding', () => {
	test('builds an embed URL locked to aid, bvid, and cid', () => {
		const src = buildBilibiliEmbedUrl(meta);
		expect(src).toContain('isOutside=true');
		expect(src).toContain('aid=114514');
		expect(src).toContain('bvid=BV1s43t6UEaW');
		expect(src).toContain('cid=40434271283');
		expect(src).toContain('p=1');
	});

	test('rewrites a Defuddle iframe that only has bvid', () => {
		const html = '<iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid=BV1s43t6UEaW&amp;page=1&amp;high_quality=1&amp;danmaku=0" title="Bilibili video player" frameborder="0" allowfullscreen=""></iframe>';
		const rewritten = rewriteBilibiliEmbedHtml(html, meta);
		expect(rewritten).toContain('cid=40434271283');
		expect(rewritten).toContain('aid=114514');
		expect(rewritten).toContain('isOutside=true');
		expect(rewritten).not.toContain('credentialless');
		expect(rewritten).not.toContain('sandbox=');
		expect(rewritten).toContain('&amp;cid=');
	});

	test('resolveBilibiliVideoMeta rejects a view response for a different bvid', async () => {
		vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
			json: () => Promise.resolve({
				code: 0,
				data: { bvid: 'BV1usRgBEESe', aid: 1, cid: 2, duration: 10, pages: [{ page: 1, cid: 2, duration: 10 }] },
			}),
		})));
		const result = await resolveBilibiliVideoMeta('https://www.bilibili.com/video/BV1s43t6UEaW/');
		expect(result).toBeNull();
		vi.unstubAllGlobals();
	});
});
