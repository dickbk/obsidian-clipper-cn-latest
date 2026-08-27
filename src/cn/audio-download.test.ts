import { describe, expect, test } from 'vitest';
import { parseContentRange } from './audio-download';

describe('parseContentRange', () => {
	test('reads total size from a 206 response', () => {
		expect(parseContentRange('bytes 0-1/34600192')).toEqual({
			start: 0,
			end: 1,
			total: 34600192,
		});
	});

	test('returns null for missing or malformed headers', () => {
		expect(parseContentRange(null)).toBeNull();
		expect(parseContentRange('attachment')).toBeNull();
	});
});
