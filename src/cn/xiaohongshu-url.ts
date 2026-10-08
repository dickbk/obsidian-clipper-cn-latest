export function getXiaohongshuNoteId(url: string): string | null {
	try {
		const u = new URL(url);
		if (!/(^|\.)xiaohongshu\.com$/.test(u.hostname)) {
			return null;
		}
		const match = u.pathname.match(/^\/(?:explore|discovery\/item)\/([0-9a-f]{24})/i);
		return match ? match[1] : null;
	} catch {
		return null;
	}
}
