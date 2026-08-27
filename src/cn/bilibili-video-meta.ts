import { isBilibiliVideoUrl, parseBilibiliVideoId } from './transcript-html';

export interface BilibiliVideoMeta {
	bvid: string;
	aid?: number;
	cid: number;
	page: number;
	expectedDuration: number;
	title?: string;
}

export interface BilibiliEmbedExtra {
	t?: number;
	autoplay?: boolean;
}

function normalizeDuration(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n > 100000 ? n / 1000 : n;
}

export async function resolveBilibiliVideoMeta(url: string): Promise<BilibiliVideoMeta | null> {
	const parsed = parseBilibiliVideoId(url);
	if (!parsed?.bvid && !parsed?.aid) return null;

	const viewUrl = new URL('https://api.bilibili.com/x/web-interface/view');
	if (parsed.bvid) viewUrl.searchParams.set('bvid', parsed.bvid);
	if (parsed.aid) viewUrl.searchParams.set('aid', String(parsed.aid));
	const viewResponse = await fetch(viewUrl.toString(), {
		credentials: 'omit',
		cache: 'no-store',
	});
	const viewJson = await viewResponse.json();
	if (viewJson?.code !== 0) return null;
	const pages = Array.isArray(viewJson?.data?.pages) ? viewJson.data.pages : [];
	const matched = pages.find((item: { page?: number }) => item.page === parsed.page) || pages[parsed.page - 1];
	const cid = Number(matched?.cid || viewJson?.data?.cid);
	const bvid = viewJson?.data?.bvid || parsed.bvid;
	const aid = Number(viewJson?.data?.aid || 0);
	if (!cid || !bvid) return null;
	if (parsed.bvid && bvid !== parsed.bvid) return null;
	return {
		bvid,
		aid: aid || undefined,
		cid,
		page: parsed.page,
		expectedDuration: normalizeDuration(matched?.duration || viewJson?.data?.duration),
		title: String(viewJson?.data?.title || '').trim() || undefined,
	};
}

function sendRuntimeMessage(payload: Record<string, unknown>): Promise<any> {
	const runtime = (globalThis as any).browser?.runtime || (globalThis as any).chrome?.runtime;
	if (!runtime?.sendMessage) {
		return Promise.reject(new Error('no extension runtime'));
	}
	try {
		const result = runtime.sendMessage(payload);
		if (result && typeof result.then === 'function') {
			return result;
		}
	} catch {
		// Use callback form below.
	}
	return new Promise((resolve, reject) => {
		try {
			runtime.sendMessage(payload, (response: unknown) => {
				const lastError = (globalThis as any).chrome?.runtime?.lastError;
				if (lastError) reject(new Error(lastError.message));
				else resolve(response);
			});
		} catch (error) {
			reject(error);
		}
	});
}

async function resolveBilibiliVideoMetaSafe(url: string): Promise<BilibiliVideoMeta | null> {
	try {
		const response = await sendRuntimeMessage({
			action: 'cnResolveBilibiliMeta',
			url,
		}) as { success?: boolean; meta?: BilibiliVideoMeta };
		if (response?.meta?.cid && response.meta.bvid) {
			return response.meta;
		}
	} catch {
		// Fall through to a direct lookup.
	}
	try {
		return await resolveBilibiliVideoMeta(url);
	} catch {
		return null;
	}
}

export function buildBilibiliEmbedUrl(meta: BilibiliVideoMeta, extra?: BilibiliEmbedExtra): string {
	const src = new URL('https://player.bilibili.com/player.html');
	src.searchParams.set('isOutside', 'true');
	if (meta.aid) src.searchParams.set('aid', String(meta.aid));
	src.searchParams.set('bvid', meta.bvid);
	src.searchParams.set('cid', String(meta.cid));
	src.searchParams.set('p', String(meta.page || 1));
	src.searchParams.set('high_quality', '1');
	src.searchParams.set('danmaku', '0');
	if (extra?.t && extra.t > 0) src.searchParams.set('t', String(Math.floor(extra.t)));
	if (extra?.autoplay) src.searchParams.set('autoplay', '1');
	return src.toString();
}

function extraFromEmbedSrc(src: string): BilibiliEmbedExtra {
	const extra: BilibiliEmbedExtra = {};
	try {
		const current = new URL(src.replace(/&amp;/g, '&'));
		const t = Number(current.searchParams.get('t') || 0);
		if (t > 0) extra.t = t;
		if (current.searchParams.get('autoplay') === '1') extra.autoplay = true;
	} catch {
		// Ignore malformed existing embed URLs.
	}
	return extra;
}

export function buildBilibiliEmbedIframeHtml(meta: BilibiliVideoMeta, extra?: BilibiliEmbedExtra): string {
	const src = buildBilibiliEmbedUrl(meta, extra).replace(/&/g, '&amp;');
	return [
		'<iframe width="560" height="315"',
		` src="${src}"`,
		' title="Bilibili video player"',
		' frameborder="0"',
		' allowfullscreen=""',
		' allow="fullscreen"',
		'></iframe>',
	].join('');
}

export function rewriteBilibiliEmbedHtml(html: string, meta: BilibiliVideoMeta): string {
	return html.replace(
		/<iframe\b[^>]*player\.bilibili\.com\/player\.html[\s\S]*?<\/iframe>|<iframe\b[^>]*player\.bilibili\.com\/player\.html[^>]*\/?>/gi,
		(match) => {
			const srcMatch = match.match(/src=["']([^"']+)["']/i);
			return buildBilibiliEmbedIframeHtml(meta, srcMatch ? extraFromEmbedSrc(srcMatch[1]) : undefined);
		}
	);
}

export async function rewriteBilibiliEmbedInParsedContent<T extends { content?: string }>(
	url: string,
	parsed: T
): Promise<T> {
	if (!isBilibiliVideoUrl(url) || !parsed.content) return parsed;
	if (!parsed.content.includes('player.bilibili.com')) return parsed;
	const meta = await resolveBilibiliVideoMetaSafe(url);
	if (!meta) return parsed;
	parsed.content = rewriteBilibiliEmbedHtml(parsed.content, meta);
	return parsed;
}

export function isolateBilibiliEmbedIframe(
	old: HTMLIFrameElement,
	src: string,
	meta?: BilibiliVideoMeta
): HTMLIFrameElement {
	old.removeAttribute('sandbox');
	old.removeAttribute('credentialless');
	old.removeAttribute('referrerpolicy');
	(old as HTMLIFrameElement & { credentialless?: boolean }).credentialless = false;
	if (meta?.bvid) old.dataset.cnBvid = meta.bvid;
	if (meta?.cid) old.dataset.cnCid = String(meta.cid);
	if (meta?.aid) old.dataset.cnAid = String(meta.aid);
	if (old.src !== src) {
		old.src = src;
	}
	return old;
}

export async function bindBilibiliEmbedIframe(
	iframe: HTMLIFrameElement,
	pageUrl: string,
	extra?: BilibiliEmbedExtra
): Promise<void> {
	const meta = await resolveBilibiliVideoMetaSafe(pageUrl);
	if (!meta) return;
	isolateBilibiliEmbedIframe(iframe, buildBilibiliEmbedUrl(meta, extra), meta);
}
