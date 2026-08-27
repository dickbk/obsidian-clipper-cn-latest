import { describe, expect, test } from 'vitest';
import { parseBcutResult, describeBcutHttpError, describeBcutApiError, isBcutQuotaError, BCUT_QUOTA_ERROR } from './bcut-asr';

describe('parseBcutResult', () => {
	test('converts millisecond utterances into transcript cues', () => {
		const cues = parseBcutResult({
			language: 'zh',
			utterances: [
				{ start_time: 0, end_time: 1800, transcript: ' 你好 ' },
				{ start_time: 2100, end_time: 4000, transcript: '欢迎回来' },
				{ start_time: 5000, end_time: 6000, transcript: '   ' },
			],
		});
		expect(cues).toEqual([
			{ start: 0, end: 1.8, text: '你好' },
			{ start: 2.1, end: 4, text: '欢迎回来' },
		]);
	});

	test('parses JSON string payloads', () => {
		const cues = parseBcutResult(JSON.stringify({
			utterances: [{ start_time: 90000, end_time: 91000, transcript: '一分钟' }],
		}));
		expect(cues[0].start).toBe(90);
		expect(cues[0].text).toBe('一分钟');
	});

	test('explains BCut HTTP 412 as a blocked origin', () => {
		expect(describeBcutHttpError(412)).toContain('412');
		expect(describeBcutHttpError(412)).toContain('拦截');
		expect(describeBcutHttpError(500)).toBe('BCut HTTP 500');
	});

	test('rewrites the Huasheng quota message into an actionable error', () => {
		expect(isBcutQuotaError('您的免费额度已用尽（前往花生，解锁完整全部能力）')).toBe(true);
		expect(describeBcutApiError({
			code: -403,
			message: '您的免费额度已用尽（前往花生，解锁完整全部能力）',
		})).toBe(BCUT_QUOTA_ERROR);
		expect(describeBcutApiError({ code: -400, message: 'bad request' })).toContain('bad request');
	});
});
