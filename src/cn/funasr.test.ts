import { describe, expect, test } from 'vitest';
import { parseFunAsrResult, FUNASR_MISSING_KEY_ERROR } from './funasr';

describe('funasr', () => {
	test('converts millisecond sentences into transcript cues', () => {
		const parsed = parseFunAsrResult({
			properties: { original_duration_in_milliseconds: 4224000 },
			transcripts: [{
				sentences: [
					{ begin_time: 0, end_time: 1800, text: ' 你好 ' },
					{ begin_time: 2100, end_time: 4200, text: '苏度科技' },
					{ begin_time: 5000, end_time: 6000, text: '   ' },
				],
			}],
		});
		expect(parsed.cues).toEqual([
			{ start: 0, end: 1.8, text: '你好' },
			{ start: 2.1, end: 4.2, text: '苏度科技' },
		]);
		expect(parsed.originalDurationSec).toBe(4224);
	});

	test('exposes a clear missing-key message', () => {
		expect(FUNASR_MISSING_KEY_ERROR).toContain('API Key');
	});
});
