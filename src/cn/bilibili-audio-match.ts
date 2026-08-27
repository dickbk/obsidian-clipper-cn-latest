/**
 * Bilibili DASH audio URLs typically look like:
 *   /upgcxcode/.../{cid}/{cid}-1-30280.m4s
 * The cid in the path is the identity of the stream. Duration is not enough:
 * related videos on a long-lived tab are often a similar length.
 */
export function cidFromDashAudioUrl(url: string): number | null {
	try {
		const path = new URL(url).pathname;
		const match = path.match(/\/(\d+)-1-\d+\.(?:m4s|m4a)$/i);
		if (!match) return null;
		const cid = Number(match[1]);
		return Number.isFinite(cid) && cid > 0 ? cid : null;
	} catch {
		return null;
	}
}

export function audioUrlBelongsToCid(audioUrl: string, cid?: number): boolean {
	if (!audioUrl) return false;
	if (!cid) return true;
	return audioUrlStrictlyMatchesCid(audioUrl, cid);
}

/** Reject unknown CDN shapes; only accept when the path clearly encodes this cid. */
export function audioUrlStrictlyMatchesCid(audioUrl: string, cid: number): boolean {
	if (!audioUrl || !cid) return false;
	const found = cidFromDashAudioUrl(audioUrl);
	if (found != null) return found === cid;
	try {
		const path = new URL(audioUrl).pathname;
		const cidStr = String(cid);
		return path.includes(`/${cidStr}/`) || path.includes(`/${cidStr}-`);
	} catch {
		return false;
	}
}

export function dashDurationMatches(actual: number, expected: number): boolean {
	if (!(expected > 30) || !(actual > 0)) return true;
	const ratio = actual / expected;
	return ratio >= 0.85 && ratio <= 1.2;
}

export function audioFileLabel(audioUrl: string): string {
	try {
		const name = new URL(audioUrl).pathname.split('/').pop() || '';
		return name.replace(/\?.*$/, '') || 'audio.m4s';
	} catch {
		return 'audio.m4s';
	}
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return '';
	}
}

/**
 * Prefer a different CDN host than the one the Reader player is streaming,
 * so Range-downloading a 70-minute track does not starve playback.
 */
export function preferAlternateCdnUrls(primary: string, backups: string[] = []): string[] {
	const primaryHost = hostOf(primary);
	const unique = [primary, ...backups].filter((item, index, list) => item && list.indexOf(item) === index);
	const otherHosts = unique.filter((url) => url !== primary && hostOf(url) && hostOf(url) !== primaryHost);
	const rest = unique.filter((url) => !otherHosts.includes(url));
	return [...otherHosts, ...rest];
}
