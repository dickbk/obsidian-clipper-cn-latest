export interface PageAudioLookupResult {
	audioUrl: string;
	backupUrls: string[];
	duration: number;
	bvid?: string;
	cid?: number;
}

/**
 * Injected into the Bilibili page MAIN world via chrome.scripting.executeScript.
 * Do not use async/await, object spread, or optional chaining in this function:
 * TypeScript target es6 would emit helpers like __awaiter that do not exist in
 * the page, and Chrome reports that as an extension error on background.js:1.
 *
 * Related-video prefetch frequently overwrites window.__playinfo__ with another
 * DASH playlist while leaving __INITIAL_STATE__ on the watch page. Never accept
 * playinfo audio unless its CDN path cid matches the expected cid.
 */
export function lookupBilibiliAudioInPage(pageBvid: string, pageNo?: number): Promise<PageAudioLookupResult | null> {
	function asUrls(value: unknown): string[] {
		if (typeof value === 'string' && value) {
			return [value];
		}
		if (!Array.isArray(value)) {
			return [];
		}
		const out: string[] = [];
		for (let i = 0; i < value.length; i++) {
			if (typeof value[i] === 'string' && value[i]) {
				out.push(value[i]);
			}
		}
		return out;
	}

	function cidFromAudioUrl(url: string): number {
		try {
			const path = new URL(url).pathname;
			const match = path.match(/\/(\d+)-1-\d+\.(?:m4s|m4a)$/i);
			if (!match) {
				return 0;
			}
			const cid = Number(match[1]);
			return cid > 0 ? cid : 0;
		} catch (_error) {
			return 0;
		}
	}

	function audioBelongsToCid(url: string, cid: number): boolean {
		if (!url || !cid) {
			return false;
		}
		const found = cidFromAudioUrl(url);
		if (found) {
			return found === cid;
		}
		try {
			const path = new URL(url).pathname;
			const cidStr = String(cid);
			return path.indexOf('/' + cidStr + '/') >= 0 || path.indexOf('/' + cidStr + '-') >= 0;
		} catch (_error) {
			return false;
		}
	}

	function pick(audios: unknown, cid: number): { audioUrl: string; backupUrls: string[] } | null {
		if (!Array.isArray(audios) || audios.length === 0) {
			return null;
		}
		const sorted = audios.slice().sort(function (a: any, b: any) {
			return (Number(a && a.bandwidth) || 0) - (Number(b && b.bandwidth) || 0);
		});
		let chosen: any = null;
		for (let i = 0; i < sorted.length; i++) {
			const item: any = sorted[i];
			const candidate =
				(item && (item.baseUrl || item.base_url)) ||
				asUrls(item && item.backupUrl)[0] ||
				asUrls(item && item.backup_url)[0];
			if (candidate && audioBelongsToCid(candidate, cid)) {
				chosen = item;
				break;
			}
		}
		if (!chosen) {
			return null;
		}
		const audioUrl =
			(chosen && (chosen.baseUrl || chosen.base_url)) ||
			asUrls(chosen && chosen.backupUrl)[0] ||
			asUrls(chosen && chosen.backup_url)[0];
		if (!audioUrl || !audioBelongsToCid(audioUrl, cid)) {
			return null;
		}
		const backupUrls: string[] = [];
		const primaryBackups = asUrls((chosen && chosen.backupUrl) || (chosen && chosen.backup_url));
		for (let i = 0; i < primaryBackups.length; i++) {
			if (primaryBackups[i] !== audioUrl && audioBelongsToCid(primaryBackups[i], cid)) {
				backupUrls.push(primaryBackups[i]);
			}
		}
		for (let i = 0; i < sorted.length; i++) {
			const item: any = sorted[i];
			const base = item && (item.baseUrl || item.base_url);
			if (typeof base === 'string' && base && base !== audioUrl && audioBelongsToCid(base, cid)) {
				backupUrls.push(base);
			}
			const extra = asUrls((item && item.backupUrl) || (item && item.backup_url));
			for (let j = 0; j < extra.length; j++) {
				if (extra[j] && extra[j] !== audioUrl && audioBelongsToCid(extra[j], cid)) {
					backupUrls.push(extra[j]);
				}
			}
		}
		return { audioUrl: audioUrl, backupUrls: backupUrls };
	}

	function durationOf(playData: any, fallback: number): number {
		const raw = Number((playData && playData.dash && playData.dash.duration) || (playData && playData.timelength) || fallback || 0);
		if (!(raw > 0)) {
			return fallback || 0;
		}
		return raw > 100000 ? raw / 1000 : raw;
	}

	function fromPlayData(playData: any, meta: { bvid: string; cid: number; duration: number }): PageAudioLookupResult | null {
		if (!playData || !meta.cid) {
			return null;
		}
		const picked = pick(playData.dash && playData.dash.audio, meta.cid);
		if (!picked) {
			return null;
		}
		return {
			audioUrl: picked.audioUrl,
			backupUrls: picked.backupUrls,
			duration: meta.duration || durationOf(playData, 0),
			bvid: meta.bvid,
			cid: meta.cid
		};
	}

	function fetchJson(url: string): Promise<any> {
		return fetch(url, { credentials: 'include', cache: 'no-store' }).then(function (response) {
			return response.json();
		});
	}

	function cidFromPages(pages: any, requestedPage: number, fallbackCid: unknown): number {
		const list = pages || [];
		let matched: any = null;
		for (let i = 0; i < list.length; i++) {
			if (Number(list[i] && list[i].page) === requestedPage) {
				matched = list[i];
				break;
			}
		}
		if (!matched) {
			matched = list[requestedPage - 1] || list[0] || {};
		}
		return Number((matched && matched.cid) || fallbackCid || 0);
	}

	function durationFromPages(pages: any, requestedPage: number, fallbackDuration: unknown): number {
		const list = pages || [];
		let matched: any = null;
		for (let i = 0; i < list.length; i++) {
			if (Number(list[i] && list[i].page) === requestedPage) {
				matched = list[i];
				break;
			}
		}
		if (!matched) {
			matched = list[requestedPage - 1] || list[0] || {};
		}
		return Number((matched && matched.duration) || fallbackDuration || 0);
	}

	function loadPlayurl(meta: { bvid: string; cid: number; duration: number }): Promise<PageAudioLookupResult | null> {
		if (!meta.bvid || !meta.cid) {
			return Promise.resolve(null);
		}
		const playUrl =
			'https://api.bilibili.com/x/player/playurl?bvid=' +
			encodeURIComponent(meta.bvid) +
			'&cid=' +
			meta.cid +
			'&fnval=16&fnver=0&fourk=1';
		return fetchJson(playUrl).then(function (playJson: any) {
			const playData = playJson && (playJson.data || playJson.result);
			return fromPlayData(playData, meta);
		});
	}

	const requestedPage = Number(pageNo) > 0 ? Number(pageNo) : 1;
	if (!pageBvid) {
		return Promise.resolve(null);
	}

	// Never read window.__playinfo__: related-video prefetch overwrites it while
	// the watch page still shows the correct BV. Always call playurl for this BV.
	return fetchJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(pageBvid))
		.then(function (viewJson: any) {
			if (!viewJson || viewJson.code !== 0 || !viewJson.data) {
				return null;
			}
			const data = viewJson.data;
			const bvid = data.bvid || pageBvid;
			if (bvid && pageBvid && bvid !== pageBvid) {
				return null;
			}
			const nextMeta = {
				bvid: bvid,
				cid: cidFromPages(data.pages, requestedPage, data.cid),
				duration: durationFromPages(data.pages, requestedPage, data.duration)
			};
			return loadPlayurl(nextMeta);
		})
		.catch(function () {
			return null;
		});
}

/**
 * Injected helper: fetch dash audio for an already-resolved bvid+cid using the
 * page's cookies (credentials:include). Never reads __playinfo__.
 */
export function fetchBilibiliPlayurlAudioInPage(
	bvid: string,
	cid: number,
	expectedDuration?: number
): Promise<PageAudioLookupResult | null> {
	function asUrls(value: unknown): string[] {
		if (typeof value === 'string' && value) {
			return [value];
		}
		if (!Array.isArray(value)) {
			return [];
		}
		const out: string[] = [];
		for (let i = 0; i < value.length; i++) {
			if (typeof value[i] === 'string' && value[i]) {
				out.push(value[i]);
			}
		}
		return out;
	}

	function cidFromAudioUrl(url: string): number {
		try {
			const path = new URL(url).pathname;
			const match = path.match(/\/(\d+)-1-\d+\.(?:m4s|m4a)$/i);
			if (!match) {
				return 0;
			}
			const found = Number(match[1]);
			return found > 0 ? found : 0;
		} catch (_error) {
			return 0;
		}
	}

	function pick(audios: unknown, expectedCid: number): { audioUrl: string; backupUrls: string[] } | null {
		if (!Array.isArray(audios) || audios.length === 0 || !expectedCid) {
			return null;
		}
		const sorted = audios.slice().sort(function (a: any, b: any) {
			return (Number(a && a.bandwidth) || 0) - (Number(b && b.bandwidth) || 0);
		});
		for (let i = 0; i < sorted.length; i++) {
			const item: any = sorted[i];
			const candidate =
				(item && (item.baseUrl || item.base_url)) ||
				asUrls(item && item.backupUrl)[0] ||
				asUrls(item && item.backup_url)[0];
			if (!candidate || cidFromAudioUrl(candidate) !== expectedCid) {
				continue;
			}
			const backupUrls: string[] = [];
			const primaryBackups = asUrls((item && item.backupUrl) || (item && item.backup_url));
			for (let j = 0; j < primaryBackups.length; j++) {
				if (primaryBackups[j] !== candidate && cidFromAudioUrl(primaryBackups[j]) === expectedCid) {
					backupUrls.push(primaryBackups[j]);
				}
			}
			return { audioUrl: candidate, backupUrls: backupUrls };
		}
		return null;
	}

	if (!bvid || !cid) {
		return Promise.resolve(null);
	}
	const playUrl =
		'https://api.bilibili.com/x/player/playurl?bvid=' +
		encodeURIComponent(bvid) +
		'&cid=' +
		cid +
		'&fnval=16&fnver=0&fourk=1';
	return fetch(playUrl, { credentials: 'include', cache: 'no-store' })
		.then(function (response) {
			return response.json();
		})
		.then(function (playJson: any) {
			const playData = playJson && (playJson.data || playJson.result);
			if (!playData) {
				return null;
			}
			const picked = pick(playData.dash && playData.dash.audio, cid);
			if (!picked) {
				return null;
			}
			const raw = Number((playData.dash && playData.dash.duration) || playData.timelength || expectedDuration || 0);
			const duration = raw > 100000 ? raw / 1000 : raw;
			return {
				audioUrl: picked.audioUrl,
				backupUrls: picked.backupUrls,
				duration: duration || Number(expectedDuration) || 0,
				bvid: bvid,
				cid: cid
			};
		})
		.catch(function () {
			return null;
		});
}

export const BILIBILI_AUDIO_SNAPSHOT_KEY = '__obsidianClipperBilibiliAudio';
