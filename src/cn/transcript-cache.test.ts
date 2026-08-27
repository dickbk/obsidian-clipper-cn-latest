import { describe, expect, test } from 'vitest';
import { cacheBelongsToVideo, isCachedTranscriptComplete, type CachedTranscriptIdentity } from './transcript-cache-logic';
import { transcriptMatchesTitleHints } from './transcript-html';

function makeCached(overrides: Partial<CachedTranscriptIdentity> = {}): CachedTranscriptIdentity {
	return {
		coverageSec: 4000,
		expectedDurationSec: 4224,
		audioCid: 40434271283,
		bvid: 'BV1s43t6UEaW',
		text: '**0:00** · 大家好，今天请到苏度科技的韩铮',
		...overrides,
	};
}

describe('transcript cache identity', () => {
	test('completeness uses coverage threshold', () => {
		expect(isCachedTranscriptComplete(makeCached({ coverageSec: 4000 }), 4224)).toBe(true);
		expect(isCachedTranscriptComplete(makeCached({ coverageSec: 1000 }), 4224)).toBe(false);
	});

	test('rejects untagged or mismatched ASR caches when video meta is known', () => {
		const meta = {
			cid: 40434271283,
			bvid: 'BV1s43t6UEaW',
			expectedDuration: 4224,
			title: '对话苏度科技联创韩铮',
		};
		expect(cacheBelongsToVideo(makeCached(), meta, transcriptMatchesTitleHints)).toBe(true);
		expect(cacheBelongsToVideo(makeCached({ audioCid: undefined }), meta, transcriptMatchesTitleHints)).toBe(false);
		expect(cacheBelongsToVideo(makeCached({ bvid: undefined }), meta, transcriptMatchesTitleHints)).toBe(false);
		expect(cacheBelongsToVideo(makeCached({ audioCid: 111 }), meta, transcriptMatchesTitleHints)).toBe(false);
		expect(cacheBelongsToVideo(makeCached({ bvid: 'BVother' }), meta, transcriptMatchesTitleHints)).toBe(false);
		expect(cacheBelongsToVideo(
			makeCached({ text: '**0:24** · 好各位久等 X20pro的浅谈来了 VIVO' }),
			meta,
			transcriptMatchesTitleHints
		)).toBe(false);
	});
});
