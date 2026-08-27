import { describe, expect, test } from 'vitest';
import { md5 } from './md5';
import { encodeWbiQuery } from './bilibili-wbi';

describe('md5 and wbi', () => {
	test('hashes known strings', () => {
		expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
		expect(md5('hello')).toBe('5d41402abc4b2a76b9719d911017c592');
	});

	test('signs playurl query with w_rid and sorted keys', () => {
		const query = encodeWbiQuery(
			{ bvid: 'BV1s43t6UEaW', cid: 40434271283, fnval: 16, fnver: 0, fourk: 1 },
			'imgkeyimgkeyimgkeyimgkeyimgkey12',
			'subkeysubkeysubkeysubkeysubkey12',
			1700000000
		);
		expect(query).toContain('bvid=BV1s43t6UEaW');
		expect(query).toContain('cid=40434271283');
		expect(query).toContain('wts=1700000000');
		expect(query).toMatch(/w_rid=[0-9a-f]{32}$/);
	});
});
