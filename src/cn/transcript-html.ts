export interface TranscriptCue {
	start: number;
	end?: number;
	text: string;
}

export interface OverlayTranscriptFields {
	content?: string;
	wordCount?: number;
	variables?: { [key: string]: string };
}

export const TRANSCRIPT_FALLBACK_CLASS = 'cn-transcript-fallback';
export const TRANSCRIPT_GENERATE_BTN_CLASS = 'cn-transcript-generate-btn';

export function isBilibiliVideoUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname.includes('bilibili.com')
			&& /^\/video\/(BV[\w]+|av\d+)/i.test(parsed.pathname);
	} catch {
		return false;
	}
}

export function parseBilibiliVideoId(url: string): { bvid: string | null; aid: number | null; page: number } | null {
	try {
		const parsed = new URL(url);
		const match = parsed.pathname.match(/^\/video\/(BV[\w]+|av\d+)/i);
		if (!match) return null;
		const raw = match[1];
		const page = Number.parseInt(parsed.searchParams.get('p') || '1', 10);
		return {
			bvid: /^BV/i.test(raw) ? raw : null,
			aid: /^av/i.test(raw) ? Number.parseInt(raw.slice(2), 10) : null,
			page: Number.isFinite(page) && page > 0 ? page : 1,
		};
	} catch {
		return null;
	}
}

/** Bump when ASR audio identity / FunASR input format changes so stale wrong-track caches drop. */
export const TRANSCRIPT_CACHE_VERSION = 'v17';

export function transcriptCacheKey(url: string): string | null {
	const parsed = parseBilibiliVideoId(url);
	if (!parsed) return null;
	const id = parsed.bvid || (parsed.aid ? `av${parsed.aid}` : '');
	if (!id) return null;
	return `bilibili:${id}:p${parsed.page}:${TRANSCRIPT_CACHE_VERSION}`;
}

/** Recover a canonical watch URL from a cache key when Reader/doc.URL is unreliable. */
export function bilibiliUrlFromCacheKey(cacheKey: string): string | null {
	const match = cacheKey.match(/^bilibili:(BV[\w]+|av\d+):p(\d+):v\d+$/i);
	if (!match) return null;
	return `https://www.bilibili.com/video/${match[1]}/?p=${match[2]}`;
}

/** Raw platform/Defuddle transcript text, if any. */
export function platformTranscriptText(parsed: OverlayTranscriptFields): string {
	const fromVar = parsed.variables?.transcript?.trim() || '';
	if (fromVar) return fromVar;
	const content = parsed.content || '';
	if (!/class="(?:bilibili|youtube) transcript"/.test(content) || !content.includes('transcript-segment')) {
		return '';
	}
	return content
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * AI captions that are only "♪ 音乐 ♪" (or similarly empty) must not block ASR.
 * BV1s43t6UEaW is a 70-minute interview whose platform CC is often just intro music.
 */
export function isMostlyMusicTranscript(text: string): boolean {
	const stripped = text
		.replace(/[♪🎵🎶]/g, ' ')
		.replace(/音乐/g, ' ')
		.replace(/\*\*\d{1,2}:\d{2}(?::\d{2})?\*\*/g, ' ')
		.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
		.replace(/transcript/gi, ' ')
		.replace(/[·•.\-_/|,\s]+/g, '');
	return stripped.length < 24;
}

export function maxTranscriptTimestampSec(text: string): number {
	let max = 0;
	const re = /\*{0,2}(\d{1,2}):(\d{2})(?::(\d{2}))?\*{0,2}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		const hasHours = match[3] != null;
		const hours = hasHours ? Number(match[1]) : 0;
		const minutes = hasHours ? Number(match[2]) : Number(match[1]);
		const seconds = hasHours ? Number(match[3]) : Number(match[2]);
		const total = hours * 3600 + minutes * 60 + seconds;
		if (Number.isFinite(total)) max = Math.max(max, total);
	}
	return max;
}

export function hasPlatformTranscript(parsed: OverlayTranscriptFields): boolean {
	return Boolean(platformTranscriptText(parsed));
}

/** Prefer real speech CC; reject music-only / near-empty stubs. */
export function isUsablePlatformTranscript(
	parsed: OverlayTranscriptFields,
	expectedDurationSec?: number
): boolean {
	const text = platformTranscriptText(parsed);
	if (!text) return false;
	if (isMostlyMusicTranscript(text)) return false;
	if (expectedDurationSec && expectedDurationSec > 120) {
		const coverage = maxTranscriptTimestampSec(text);
		if (coverage < Math.min(90, expectedDurationSec * 0.08)) {
			return false;
		}
	}
	return true;
}

const TITLE_STOPWORDS = new Set([
	'完整版', '对话', '分钟', '解密', '访谈', '专访', '直播', '回放', '官方',
	'视频', '合集', '剪辑', '字幕', '中字', '全程', '纪录', '记录', '成为',
	'理解', '质疑', '最低调', '超级', '独角兽', '科技', '联创', '系列',
	'今天', '我们', '一个', '什么', '怎么', '这个', '那个', '以及', '还有',
]);

/**
 * Pull distinctive tokens from a Bilibili title so we can reject ASR results
 * that clearly belong to another video (VIVO review on a 苏度 interview, etc.).
 */
export function extractTitleHints(title: string): string[] {
	const raw = String(title || '');
	const hints = new Set<string>();
	for (const match of raw.match(/[\u4e00-\u9fff]{2,8}/g) || []) {
		if (!TITLE_STOPWORDS.has(match) && match.length >= 2) {
			hints.add(match);
		}
		for (let len = 2; len <= Math.min(4, match.length); len++) {
			for (let i = 0; i + len <= match.length; i++) {
				const part = match.slice(i, i + len);
				if (!TITLE_STOPWORDS.has(part)) hints.add(part);
			}
		}
	}
	for (const match of raw.match(/[A-Za-z][A-Za-z0-9+\-]{1,20}/g) || []) {
		const token = match.toLowerCase();
		if (token.length >= 2 && !['ceo', 'ai', 'app', 'pro'].includes(token)) {
			hints.add(token);
		}
	}
	return [...hints].sort((a, b) => b.length - a.length).slice(0, 24);
}

/**
 * If the title yields distinctive hints, at least one should appear early in the
 * transcript. Missing all of them almost always means we transcribed the wrong track.
 */
export function transcriptMatchesTitleHints(transcript: string, title: string): boolean {
	const hints = extractTitleHints(title);
	if (!hints.length) return true;
	const head = String(transcript || '')
		.replace(/\*\*/g, '')
		.slice(0, 1500)
		.toLowerCase();
	if (!head.trim()) return false;
	return hints.some((hint) => head.includes(hint.toLowerCase()));
}

export function stripPlatformTranscript(content: string): string {
	return content.replace(
		/<div class="(?:bilibili|youtube) transcript"[\s\S]*?<\/div>/gi,
		''
	).trim();
}

export function formatTranscriptTimestamp(seconds: number): string {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) {
		return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}
	return `${m}:${String(s).padStart(2, '0')}`;
}

export function escapeTranscriptHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function buildGeneratedTranscript(site: 'bilibili' | 'youtube', cues: TranscriptCue[]): { html: string; text: string } {
	const htmlParts: string[] = [];
	const textParts: string[] = [];

	for (const cue of cues) {
		const timestamp = formatTranscriptTimestamp(cue.start);
		htmlParts.push(
			`<p class="transcript-segment"><strong><span class="timestamp" data-timestamp="${cue.start}">${timestamp}</span></strong> · ${escapeTranscriptHtml(cue.text)}</p>`
		);
		textParts.push(`**${timestamp}** · ${cue.text}`);
	}

	return {
		html: `<div class="${site} transcript">\n<h2>Transcript</h2>\n${htmlParts.join('\n')}\n</div>`,
		text: textParts.join('\n'),
	};
}

export function buildTranscriptFallbackHtml(cacheKey: string, pageUrl?: string): string {
	const urlAttr = pageUrl
		? ` data-cn-transcript-url="${escapeTranscriptHtml(pageUrl)}"`
		: '';
	return [
		`<aside class="${TRANSCRIPT_FALLBACK_CLASS}" data-cn-transcript-key="${escapeTranscriptHtml(cacheKey)}"${urlAttr}>`,
		'<h2>Transcript</h2>',
		'<p class="cn-transcript-fallback-copy"></p>',
		'<p class="cn-transcript-fallback-note"></p>',
		`<button type="button" class="${TRANSCRIPT_GENERATE_BTN_CLASS}"></button>`,
		'<p class="cn-transcript-fallback-status" hidden></p>',
		'</aside>',
	].join('');
}

export function stripTranscriptFallback(content: string): string {
	return content.replace(
		new RegExp(`<aside class="${TRANSCRIPT_FALLBACK_CLASS}"[\\s\\S]*?</aside>`, 'g'),
		''
	).trim();
}

export function applyGeneratedTranscript<T extends OverlayTranscriptFields>(parsed: T, html: string, text: string): T {
	const stripped = stripTranscriptFallback(parsed.content || '');
	const withoutOldTranscript = stripPlatformTranscript(stripped);
	parsed.content = withoutOldTranscript ? `${withoutOldTranscript}\n${html}` : html;
	parsed.variables = { ...parsed.variables, transcript: text };
	return parsed;
}
