export interface CachedTranscriptIdentity {
	coverageSec?: number;
	expectedDurationSec?: number;
	audioCid?: number;
	bvid?: string;
	text?: string;
}

export interface TranscriptVideoIdentity {
	cid?: number;
	bvid?: string;
	expectedDuration?: number;
	title?: string;
}

export function isCachedTranscriptComplete(
	cached: CachedTranscriptIdentity,
	expectedDurationSec?: number
): boolean {
	const expected = expectedDurationSec || cached.expectedDurationSec || 0;
	if (cached.coverageSec == null) return false;
	if (expected <= 0) return true;
	const threshold = expected < 90 ? 0.5 : 0.85;
	return cached.coverageSec >= expected * threshold;
}

/**
 * Reject ASR caches that belong to another video (or predate cid/bvid tagging).
 * Missing identity fields are NOT accepted when the page meta is known — that was
 * how Reader mode re-applied wrong results while the popup kept platform CC.
 */
export function cacheBelongsToVideo(
	cached: CachedTranscriptIdentity | null | undefined,
	meta?: TranscriptVideoIdentity | null,
	titleMatch?: (transcript: string, title: string) => boolean
): boolean {
	if (!cached) return false;
	if (!isCachedTranscriptComplete(cached, meta?.expectedDuration)) return false;
	if (!meta?.cid && !meta?.bvid) return true;
	if (meta.cid) {
		if (!cached.audioCid || cached.audioCid !== meta.cid) return false;
	}
	if (meta.bvid) {
		if (!cached.bvid || cached.bvid !== meta.bvid) return false;
	}
	if (meta.title && cached.text && titleMatch && !titleMatch(cached.text, meta.title)) {
		return false;
	}
	return true;
}
