import { describe, expect, test } from 'vitest';
import {
	applyGeneratedTranscript,
	bilibiliUrlFromCacheKey,
	buildGeneratedTranscript,
	buildTranscriptFallbackHtml,
	extractTitleHints,
	hasPlatformTranscript,
	isBilibiliVideoUrl,
	isMostlyMusicTranscript,
	isUsablePlatformTranscript,
	maxTranscriptTimestampSec,
	stripTranscriptFallback,
	transcriptCacheKey,
	transcriptMatchesTitleHints,
} from './transcript-html';

describe('transcript html', () => {
	test('detects Bilibili video URLs and cache keys', () => {
		const url = 'https://www.bilibili.com/video/BV1s43t6UEaW/?spm_id_from=333.337.search-card.all.click&p=2';
		expect(isBilibiliVideoUrl(url)).toBe(true);
		expect(transcriptCacheKey(url)).toBe('bilibili:BV1s43t6UEaW:p2:v17');
		expect(bilibiliUrlFromCacheKey('bilibili:BV1s43t6UEaW:p2:v17')).toBe(
			'https://www.bilibili.com/video/BV1s43t6UEaW/?p=2'
		);
		expect(isBilibiliVideoUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
	});

	test('detects Defuddle platform transcripts', () => {
		expect(hasPlatformTranscript({
			content: '<div class="bilibili transcript">\n<p class="transcript-segment">hi</p></div>',
		})).toBe(true);
		expect(hasPlatformTranscript({
			variables: { transcript: '**0:01** · hello' },
		})).toBe(true);
		expect(hasPlatformTranscript({
			content: '<p>no captions</p>',
			variables: { transcript: '' },
		})).toBe(false);
	});

	test('rejects music-only platform stubs so ASR can run', () => {
		const music = '**0:00** · ♪ 音乐 ♪ ♪ 音乐 ♪\n**0:28** · ♪ 音乐 ♪ ♪ 音乐 ♪';
		expect(isMostlyMusicTranscript(music)).toBe(true);
		expect(isUsablePlatformTranscript({ variables: { transcript: music } }, 4224)).toBe(false);
		expect(isUsablePlatformTranscript({
			variables: {
				transcript: '**0:00** · 大家好，今天请到苏度科技的韩铮\n**12:00** · 我们聊聊具身智能\n**1:05:00** · 谢谢收看',
			},
		}, 4224)).toBe(true);
		// Long video + only a 0:00 cue must not count as usable platform CC
		// (stale ASR leftovers used to hide the generate panel this way).
		expect(isUsablePlatformTranscript({
			variables: {
				transcript: '**0:00** · 今天我们要吃贵阳街头现点现炒奇香无比的地摊豆豉火锅',
			},
		}, 4224)).toBe(false);
		expect(maxTranscriptTimestampSec(music)).toBe(28);
	});

	test('rejects ASR text that clearly belongs to another video title', () => {
		const title = '70分钟完整版！对话苏度科技联创/CEO韩铮—解密苏度：最低调的具身智能超级独角兽';
		expect(extractTitleHints(title).some((hint) => hint.includes('苏度') || hint.includes('韩铮'))).toBe(true);
		expect(transcriptMatchesTitleHints(
			'**0:00** · 大家好，今天请到苏度科技的韩铮聊聊具身智能',
			title
		)).toBe(true);
		expect(transcriptMatchesTitleHints(
			'**0:24** · 好各位久等 X20pro的浅谈来了话说从X80之后啊 VIVO的X系列就成了数',
			title
		)).toBe(false);
	});

	test('builds Defuddle-compatible transcript HTML', () => {
		const result = buildGeneratedTranscript('bilibili', [
			{ start: 0, text: '第一句' },
			{ start: 75, text: '第二句' },
		]);
		expect(result.html).toContain('class="bilibili transcript"');
		expect(result.html).toContain('class="transcript-segment"');
		expect(result.html).toContain('data-timestamp="75"');
		expect(result.html).toContain('1:15');
		expect(result.text).toContain('**1:15** · 第二句');
	});

	test('strips fallback markup from clip content', () => {
		const fallback = buildTranscriptFallbackHtml('bilibili:BV1s43t6UEaW:p1');
		const content = `<p>简介</p>${fallback}`;
		expect(content).toContain('cn-transcript-fallback');
		expect(stripTranscriptFallback(content)).toBe('<p>简介</p>');
	});

	test('applies generated transcript onto parsed content', () => {
		const generated = buildGeneratedTranscript('bilibili', [{ start: 0, text: '你好' }]);
		const parsed = applyGeneratedTranscript(
			{ content: `<p>简介</p>${buildTranscriptFallbackHtml('k')}`, variables: {} as { [key: string]: string } },
			generated.html,
			generated.text
		);
		expect(parsed.content).toContain('class="bilibili transcript"');
		expect(parsed.content).not.toContain('cn-transcript-fallback');
		expect(parsed.variables?.transcript).toBe('**0:00** · 你好');
	});
});
