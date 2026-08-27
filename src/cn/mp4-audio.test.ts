import { describe, expect, test } from 'vitest';
import {
	concatBytes,
	cueCoverageSeconds,
	cuesRelativeToChunk,
	mergeChunkedCues,
	parseFmp4Layout,
	planTimeChunks,
	sliceFmp4ByTime,
} from './mp4-audio';

function u32(n: number): number[] {
	return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n: number): number[] {
	return [(n >>> 8) & 0xff, n & 0xff];
}

function box(type: string, payload: number[]): number[] {
	const size = 8 + payload.length;
	return [...u32(size), ...type.split('').map((ch) => ch.charCodeAt(0)), ...payload];
}

function buildFragmentedFile(refCount: number, fragmentBytes: number, fragmentDurationMs: number): Uint8Array {
	const ftyp = box('ftyp', [...'isom'.split('').map((ch) => ch.charCodeAt(0)), ...u32(0)]);
	const mdhd = box('mdhd', [
		0, 0, 0, 0,
		...u32(0),
		...u32(0),
		...u32(1000),
		...u32(refCount * fragmentDurationMs),
	]);
	const mdia = box('mdia', mdhd);
	const trak = box('trak', mdia);
	const moov = box('moov', trak);
	const refs = Array.from({ length: refCount }, () => [
		...u32(fragmentBytes),
		...u32(fragmentDurationMs),
		...u32(0x80000000),
	]).flat();
	const sidx = box('sidx', [
		0, 0, 0, 0,
		...u32(1),
		...u32(1000),
		...u32(0),
		...u32(0),
		...u16(0),
		...u16(refCount),
		...refs,
	]);
	const media = new Array(refCount * fragmentBytes).fill(7);
	return Uint8Array.from([...ftyp, ...moov, ...sidx, ...media]);
}

describe('mp4 audio chunking', () => {
	test('parses sidx duration and fragment byte map', () => {
		const file = buildFragmentedFile(6, 1000, 10000);
		const layout = parseFmp4Layout(file);
		expect(layout).not.toBeNull();
		expect(layout?.duration).toBe(60);
		expect(layout?.fragments).toHaveLength(6);
		expect(layout?.fragments[0].size).toBe(1000);
		expect(layout?.fragments[5].startTime).toBe(50);
	});

	test('plans overlapping 12-minute windows for a 70-minute file', () => {
		const chunks = planTimeChunks(70 * 60, 12 * 60, 8);
		expect(chunks[0]).toEqual({ start: 0, end: 12 * 60 });
		expect(chunks[1].start).toBe(12 * 60 - 8);
		expect(chunks[chunks.length - 1].end).toBe(70 * 60);
		expect(chunks.length).toBeGreaterThanOrEqual(6);
	});

	test('does not split files that already fit in one BCut window', () => {
		expect(planTimeChunks(10 * 60)).toEqual([{ start: 0, end: 10 * 60 }]);
	});

	test('slices fMP4 at fragment boundaries', () => {
		const file = buildFragmentedFile(6, 500, 10000);
		const layout = parseFmp4Layout(file)!;
		const slice = sliceFmp4ByTime(file, layout, 0, 25);
		expect(slice.byteLength).toBe(layout.initEnd + 3 * 500);
		expect(slice.byteLength).toBeLessThan(file.byteLength);
	});

	test('merges overlapping chunk cues at the midpoint', () => {
		const merged = mergeChunkedCues([
			{
				start: 0,
				end: 20,
				cues: [
					{ start: 0, end: 2, text: '开场' },
					{ start: 18, end: 19.5, text: '第一段结尾' },
				],
			},
			{
				start: 15,
				end: 40,
				cues: [
					{ start: 3, end: 4, text: '重叠句' },
					{ start: 6, end: 8, text: '第二段' },
				],
			},
		]);
		expect(merged.map((cue) => cue.text)).toEqual(['开场', '重叠句', '第二段']);
		expect(merged[1].start).toBe(18);
		expect(merged[2].start).toBe(21);
		expect(cueCoverageSeconds(merged)).toBe(23);
	});

	test('concatBytes preserves order', () => {
		const out = concatBytes([Uint8Array.from([1, 2]), Uint8Array.from([3])]);
		expect(Array.from(out)).toEqual([1, 2, 3]);
	});

	test('rewinds a mid-file slice so the first fragment starts at t=0', () => {
		const file = buildFragmentedFileWithMoof(6, 10000);
		const layout = parseFmp4Layout(file)!;
		expect(layout.fragments[2].startTime).toBe(20);

		const slice = sliceFmp4ByTime(file, layout, 20, 45);
		const sliced = parseFmp4Layout(slice)!;
		expect(sliced.fragments[0].startTime).toBe(0);
		expect(sliced.duration).toBe(25);
		expect(sliced.fragments.length).toBe(3);
	});

	test('does not double-shift cues that already use the source timeline', () => {
		const cues = [{ start: 721, end: 724, text: '第二段' }];
		expect(cuesRelativeToChunk(cues, 720)[0].start).toBe(721);
		expect(cuesRelativeToChunk([{ start: 2, end: 4, text: '开场' }], 720)[0].start).toBe(722);
		expect(cuesRelativeToChunk([{ start: 3, end: 4, text: '短片' }], 15)[0].start).toBe(18);
	});
});

function tfdtBox(decodeTime: number): number[] {
	return box('tfdt', [0, 0, 0, 0, ...u32(decodeTime)]);
}

function moofBox(decodeTime: number): number[] {
	return box('moof', box('traf', tfdtBox(decodeTime)));
}

function mdatBox(payloadSize: number): number[] {
	return box('mdat', new Array(payloadSize).fill(7));
}

function buildFragmentedFileWithMoof(refCount: number, fragmentDurationMs: number, timescale = 1000): Uint8Array {
	const ftyp = box('ftyp', [...'isom'.split('').map((ch) => ch.charCodeAt(0)), ...u32(0)]);
	const mdhd = box('mdhd', [
		0, 0, 0, 0,
		...u32(0),
		...u32(0),
		...u32(timescale),
		...u32(refCount * fragmentDurationMs),
	]);
	const moov = box('moov', box('trak', box('mdia', mdhd)));
	const fragments: number[][] = [];
	for (let i = 0; i < refCount; i++) {
		fragments.push([...moofBox(i * fragmentDurationMs), ...mdatBox(40)]);
	}
	const refs = fragments.flatMap((fragment) => [
		...u32(fragment.length),
		...u32(fragmentDurationMs),
		...u32(0x80000000),
	]);
	const sidx = box('sidx', [
		0, 0, 0, 0,
		...u32(1),
		...u32(timescale),
		...u32(0),
		...u32(0),
		...u16(0),
		...u16(refCount),
		...refs,
	]);
	return Uint8Array.from([...ftyp, ...moov, ...sidx, ...fragments.flat()]);
}
