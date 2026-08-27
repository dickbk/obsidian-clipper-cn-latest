import { TranscriptCue } from './transcript-html';

export const BCUT_CHUNK_SECONDS = 12 * 60;
export const BCUT_CHUNK_OVERLAP_SECONDS = 8;

export interface MediaFragment {
	start: number;
	size: number;
	startTime: number;
	duration: number;
}

export interface Fmp4Layout {
	initEnd: number;
	duration: number;
	fragments: MediaFragment[];
}

export interface TimeChunk {
	start: number;
	end: number;
}

interface Mp4Box {
	type: string;
	start: number;
	size: number;
	headerSize: number;
}

function readU32(view: DataView, offset: number): number {
	return view.getUint32(offset);
}

function readU64(view: DataView, offset: number): number {
	const high = view.getUint32(offset);
	const low = view.getUint32(offset + 4);
	return high * 0x100000000 + low;
}

function dataViewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
	dataViewOf(bytes).setUint32(offset, value >>> 0);
}

function writeU64(bytes: Uint8Array, offset: number, value: number): void {
	const view = dataViewOf(bytes);
	view.setUint32(offset, Math.floor(value / 0x100000000));
	view.setUint32(offset + 4, value >>> 0);
}

function iterateBoxes(bytes: Uint8Array, start: number, end: number): Mp4Box[] {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const boxes: Mp4Box[] = [];
	let offset = start;
	while (offset + 8 <= end) {
		let size = readU32(view, offset);
		const type = String.fromCharCode(
			bytes[offset + 4],
			bytes[offset + 5],
			bytes[offset + 6],
			bytes[offset + 7]
		);
		let headerSize = 8;
		if (size === 1) {
			if (offset + 16 > end) break;
			size = readU64(view, offset + 8);
			headerSize = 16;
		} else if (size === 0) {
			size = end - offset;
		}
		if (size < headerSize) break;
		if (offset + size > end + 1) {
			boxes.push({ type, start: offset, size: end - offset, headerSize });
			break;
		}
		boxes.push({ type, start: offset, size, headerSize });
		offset += size;
	}
	return boxes;
}

function findBox(
	bytes: Uint8Array,
	start: number,
	end: number,
	type: string,
	recursive = true
): Mp4Box | null {
	const boxes = iterateBoxes(bytes, start, end);
	for (const box of boxes) {
		if (box.type === type) return box;
		if (recursive && (box.type === 'moov' || box.type === 'trak' || box.type === 'mdia' || box.type === 'minf' || box.type === 'stbl' || box.type === 'moof' || box.type === 'traf')) {
			const nested = findBox(bytes, box.start + box.headerSize, box.start + box.size, type, true);
			if (nested) return nested;
		}
	}
	return null;
}

function parseMdhd(bytes: Uint8Array, box: Mp4Box): { timescale: number; duration: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payload = box.start + box.headerSize;
	if (payload + 8 > bytes.byteLength) return null;
	const version = bytes[payload];
	if (version === 1) {
		if (payload + 32 > bytes.byteLength) return null;
		const timescale = readU32(view, payload + 20);
		const duration = readU64(view, payload + 24);
		return timescale ? { timescale, duration: duration / timescale } : null;
	}
	if (payload + 20 > bytes.byteLength) return null;
	const timescale = readU32(view, payload + 12);
	const duration = readU32(view, payload + 16);
	return timescale ? { timescale, duration: duration / timescale } : null;
}

function parseTfdt(bytes: Uint8Array, box: Mp4Box): number | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payload = box.start + box.headerSize;
	if (payload + 4 > bytes.byteLength) return null;
	const version = bytes[payload];
	if (version === 1) {
		if (payload + 12 > bytes.byteLength) return null;
		return readU64(view, payload + 4);
	}
	if (payload + 8 > bytes.byteLength) return null;
	return readU32(view, payload + 4);
}

function parseSidx(bytes: Uint8Array, box: Mp4Box): { fragments: MediaFragment[]; duration: number } | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const payload = box.start + box.headerSize;
	if (payload + 12 > bytes.byteLength) return null;
	const version = bytes[payload];
	const timescale = readU32(view, payload + 8);
	if (!timescale) return null;
	let cursor = payload + 12;
	let earliest = 0;
	let firstOffset = 0;
	if (version === 0) {
		if (cursor + 8 > bytes.byteLength) return null;
		earliest = readU32(view, cursor);
		firstOffset = readU32(view, cursor + 4);
		cursor += 8;
	} else {
		if (cursor + 16 > bytes.byteLength) return null;
		earliest = readU64(view, cursor);
		firstOffset = readU64(view, cursor + 8);
		cursor += 16;
	}
	if (cursor + 4 > bytes.byteLength) return null;
	const referenceCount = view.getUint16(cursor + 2);
	cursor += 4;
	if (cursor + referenceCount * 12 > bytes.byteLength) return null;

	const mediaStart = box.start + box.size + firstOffset;
	const fragments: MediaFragment[] = [];
	let byteCursor = mediaStart;
	let timeCursor = earliest / timescale;
	for (let i = 0; i < referenceCount; i++) {
		const referencedSize = readU32(view, cursor) & 0x7fffffff;
		const subsegmentDuration = readU32(view, cursor + 4);
		const duration = subsegmentDuration / timescale;
		fragments.push({
			start: byteCursor,
			size: referencedSize,
			startTime: timeCursor,
			duration,
		});
		byteCursor += referencedSize;
		timeCursor += duration;
		cursor += 12;
	}
	return { fragments, duration: timeCursor };
}

function parseMoofFragments(bytes: Uint8Array, timescale: number): MediaFragment[] {
	const top = iterateBoxes(bytes, 0, bytes.byteLength);
	const fragments: MediaFragment[] = [];
	for (let i = 0; i < top.length; i++) {
		if (top[i].type !== 'moof') continue;
		const mdat = top[i + 1]?.type === 'mdat' ? top[i + 1] : null;
		const end = mdat ? mdat.start + mdat.size : top[i].start + top[i].size;
		const tfdt = findBox(bytes, top[i].start + top[i].headerSize, top[i].start + top[i].size, 'tfdt', true);
		const decodeTime = tfdt ? parseTfdt(bytes, tfdt) : null;
		const startTime = decodeTime != null && timescale
			? decodeTime / timescale
			: (fragments.length ? fragments[fragments.length - 1].startTime + fragments[fragments.length - 1].duration : 0);
		fragments.push({
			start: top[i].start,
			size: end - top[i].start,
			startTime,
			duration: 0,
		});
	}
	for (let i = 0; i < fragments.length; i++) {
		const next = fragments[i + 1];
		fragments[i].duration = next ? Math.max(0, next.startTime - fragments[i].startTime) : 0;
	}
	return fragments;
}

export function parseFmp4Layout(bytes: Uint8Array): Fmp4Layout | null {
	if (bytes.byteLength < 16) return null;
	const top = iterateBoxes(bytes, 0, bytes.byteLength);
	if (!top.length) return null;

	const sidxBox = top.find((box) => box.type === 'sidx') || findBox(bytes, 0, bytes.byteLength, 'sidx', true);
	const moov = top.find((box) => box.type === 'moov');
	const mdhd = moov ? findBox(bytes, moov.start + moov.headerSize, moov.start + moov.size, 'mdhd', true) : null;
	const mdhdInfo = mdhd ? parseMdhd(bytes, mdhd) : null;

	const firstMedia = top.find((box) => box.type === 'sidx' || box.type === 'moof' || box.type === 'mdat');
	const initEnd = firstMedia ? firstMedia.start : (moov ? moov.start + moov.size : 0);

	if (sidxBox) {
		const parsed = parseSidx(bytes, sidxBox);
		if (parsed?.fragments.length) {
			return {
				initEnd,
				duration: parsed.duration || mdhdInfo?.duration || 0,
				fragments: parsed.fragments,
			};
		}
	}

	const timescale = mdhdInfo?.timescale || 1000;
	const fragments = parseMoofFragments(bytes, timescale);
	if (fragments.length) {
		const last = fragments[fragments.length - 1];
		return {
			initEnd,
			duration: mdhdInfo?.duration || last.startTime + last.duration,
			fragments,
		};
	}

	if (mdhdInfo?.duration) {
		return { initEnd: bytes.byteLength, duration: mdhdInfo.duration, fragments: [] };
	}
	return null;
}

export function planTimeChunks(
	duration: number,
	chunkSeconds = BCUT_CHUNK_SECONDS,
	overlapSeconds = BCUT_CHUNK_OVERLAP_SECONDS
): TimeChunk[] {
	if (!(duration > 0)) return [{ start: 0, end: 0 }];
	if (duration <= chunkSeconds + 30) {
		return [{ start: 0, end: duration }];
	}
	const step = Math.max(30, chunkSeconds - overlapSeconds);
	const chunks: TimeChunk[] = [];
	for (let start = 0; start < duration; start += step) {
		const end = Math.min(start + chunkSeconds, duration);
		chunks.push({ start, end });
		if (end >= duration) break;
	}
	return chunks;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

function writeTfdt(bytes: Uint8Array, box: Mp4Box, decodeTime: number): void {
	const payload = box.start + box.headerSize;
	if (bytes[payload] === 1) {
		writeU64(bytes, payload + 4, decodeTime);
		return;
	}
	writeU32(bytes, payload + 4, decodeTime);
}

function writeMdhdDuration(bytes: Uint8Array, box: Mp4Box, duration: number): void {
	const payload = box.start + box.headerSize;
	if (bytes[payload] === 1) {
		writeU64(bytes, payload + 24, duration);
		return;
	}
	writeU32(bytes, payload + 16, duration);
}

function collectTfdt(bytes: Uint8Array): Array<{ box: Mp4Box; time: number }> {
	const result: Array<{ box: Mp4Box; time: number }> = [];
	for (const box of iterateBoxes(bytes, 0, bytes.byteLength)) {
		if (box.type !== 'moof') continue;
		const tfdt = findBox(bytes, box.start + box.headerSize, box.start + box.size, 'tfdt', true);
		if (!tfdt) continue;
		const time = parseTfdt(bytes, tfdt);
		if (time == null) continue;
		result.push({ box: tfdt, time });
	}
	return result;
}

/**
 * BCut / ffmpeg honor container timestamps. A mid-file DASH slice still has
 * tfdt/mdhd from the original 70-minute timeline, so ASR returns 12:00+ cues
 * and shiftCues would add another 12:00. Rewind every slice to t=0.
 */
export function rebaseFmp4Timeline(bytes: Uint8Array, durationSec?: number): Uint8Array {
	const tfdts = collectTfdt(bytes);
	if (tfdts.length) {
		const base = tfdts[0].time;
		if (base > 0) {
			for (const item of tfdts) {
				writeTfdt(bytes, item.box, Math.max(0, item.time - base));
			}
		}
	}

	if (durationSec && durationSec > 0) {
		const top = iterateBoxes(bytes, 0, bytes.byteLength);
		const moov = top.find((box) => box.type === 'moov');
		const mdhd = moov ? findBox(bytes, moov.start + moov.headerSize, moov.start + moov.size, 'mdhd', true) : null;
		const info = mdhd ? parseMdhd(bytes, mdhd) : null;
		if (mdhd && info?.timescale) {
			writeMdhdDuration(bytes, mdhd, Math.max(1, Math.round(durationSec * info.timescale)));
		}
	}
	return bytes;
}

export function sliceFmp4ByTime(bytes: Uint8Array, layout: Fmp4Layout, startSec: number, endSec: number): Uint8Array {
	if (!layout.fragments.length) {
		return bytes;
	}
	const selected = layout.fragments.filter((fragment) => {
		const fragmentEnd = fragment.duration > 0 ? fragment.startTime + fragment.duration : fragment.startTime + 0.01;
		return fragment.startTime < endSec && fragmentEnd > startSec;
	});
	if (!selected.length) {
		return bytes.subarray(0, layout.initEnd);
	}
	const parts = [bytes.subarray(0, layout.initEnd)];
	for (const fragment of selected) {
		const end = Math.min(bytes.byteLength, fragment.start + fragment.size);
		if (fragment.start >= bytes.byteLength) continue;
		parts.push(bytes.subarray(fragment.start, end));
	}
	return rebaseFmp4Timeline(concatBytes(parts), Math.max(0, endSec - startSec));
}

export function shiftCues(cues: TranscriptCue[], offset: number): TranscriptCue[] {
	return cues.map((cue) => ({
		...cue,
		start: cue.start + offset,
		end: cue.end != null ? cue.end + offset : undefined,
	}));
}

export function cuesRelativeToChunk(cues: TranscriptCue[], chunkStart: number): TranscriptCue[] {
	if (!cues.length || !(chunkStart > 0)) return cues;
	const first = cues[0].start;
	if (chunkStart >= 60 && first >= chunkStart - 20) {
		return cues;
	}
	return shiftCues(cues, chunkStart);
}

export function mergeChunkedCues(parts: { start: number; end: number; cues: TranscriptCue[] }[]): TranscriptCue[] {
	const merged: TranscriptCue[] = [];
	for (let i = 0; i < parts.length; i++) {
		const shifted = cuesRelativeToChunk(parts[i].cues, parts[i].start);
		const cut = i === 0 ? Number.NEGATIVE_INFINITY : (parts[i].start + Math.min(parts[i - 1].end, parts[i].end)) / 2;
		while (merged.length && (merged[merged.length - 1].start >= cut)) {
			merged.pop();
		}
		for (const cue of shifted) {
			if (cue.start >= cut) merged.push(cue);
		}
	}
	return merged;
}

export function cueCoverageSeconds(cues: TranscriptCue[]): number {
	if (!cues.length) return 0;
	const last = cues[cues.length - 1];
	return Math.max(last.end || 0, last.start);
}
