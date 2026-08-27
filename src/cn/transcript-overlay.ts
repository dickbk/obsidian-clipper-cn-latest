import {
	applyGeneratedTranscript,
	buildTranscriptFallbackHtml,
	isUsablePlatformTranscript,
	isBilibiliVideoUrl,
	OverlayTranscriptFields,
	stripPlatformTranscript,
	stripTranscriptFallback,
	transcriptCacheKey,
	transcriptMatchesTitleHints,
} from './transcript-html';
import {
	cacheBelongsToVideo,
	getCachedTranscript,
	getTranscriptSettings,
} from './transcript-cache';
import { resolveBilibiliVideoMeta } from './bilibili-video-meta';

function clearUnusablePlatformTranscript<T extends OverlayTranscriptFields>(parsed: T): T {
	if (parsed.content) {
		parsed.content = stripPlatformTranscript(parsed.content);
	}
	if (parsed.variables?.transcript) {
		parsed.variables = { ...parsed.variables, transcript: '' };
	}
	return parsed;
}

/**
 * Same transcript source for popup clip and Reader mode.
 * Music-only / stub platform CC is stripped; only identity-matched ASR cache is applied.
 * Reader always gets a fallback shell so it can show cache / progress / regenerate —
 * never a silent cache-only apply that looks like "no download".
 */
export async function overlayBilibiliTranscript<T extends OverlayTranscriptFields>(
	url: string,
	parsed: T,
	options?: { forReader?: boolean }
): Promise<T> {
	if (!isBilibiliVideoUrl(url)) {
		return parsed;
	}

	const meta = await resolveBilibiliVideoMeta(url).catch(() => null);
	const expectedDuration = meta?.expectedDuration || 0;

	// Music-only / stub AI captions must not hide the generate path or a good cache.
	if (!isUsablePlatformTranscript(parsed, expectedDuration)) {
		clearUnusablePlatformTranscript(parsed);
	} else if (!options?.forReader) {
		return parsed;
	} else {
		// Reader still prefers platform CC when usable; no ASR fallback needed.
		return parsed;
	}

	const cacheKey = transcriptCacheKey(url);
	if (!cacheKey) {
		return parsed;
	}

	const settings = await getTranscriptSettings();

	if (options?.forReader && settings.enabled) {
		// Always inject fallback in Reader. wireTranscriptFallback applies matching
		// cache (or starts FunASR) and keeps a regenerate button visible.
		parsed.content = `${stripTranscriptFallback(parsed.content || '')}\n${buildTranscriptFallbackHtml(cacheKey, url)}`.trim();
		return parsed;
	}

	const cached = await getCachedTranscript(cacheKey);
	if (cacheBelongsToVideo(cached, meta, transcriptMatchesTitleHints)) {
		return applyGeneratedTranscript(parsed, cached!.html, cached!.text);
	}

	return parsed;
}
