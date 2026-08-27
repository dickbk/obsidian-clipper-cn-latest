import { md5 } from './md5';

const MIXIN_KEY_TAB = [
	46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
	33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
	61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
	36, 20, 34, 44, 52,
];

let cachedKeys: { imgKey: string; subKey: string; expires: number } | null = null;

function keyFromUrl(url: string): string {
	const file = url.split('/').pop() || '';
	return file.split('.')[0] || '';
}

function mixinKey(orig: string): string {
	return MIXIN_KEY_TAB.map((index) => orig[index] || '').join('').slice(0, 32);
}

export function encodeWbiQuery(
	params: Record<string, string | number>,
	imgKey: string,
	subKey: string,
	wts: number
): string {
	const mixed = mixinKey(imgKey + subKey);
	const signed: Record<string, string> = {};
	for (const [key, value] of Object.entries(params)) {
		signed[key] = String(value);
	}
	signed.wts = String(wts);
	const query = Object.keys(signed)
		.sort()
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(signed[key]).replace(/[!'()*]/g, '')}`)
		.join('&');
	return `${query}&w_rid=${md5(query + mixed)}`;
}

async function loadWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
	if (cachedKeys && cachedKeys.expires > Date.now()) {
		return cachedKeys;
	}
	const response = await fetch('https://api.bilibili.com/x/web-interface/nav', {
		credentials: 'omit',
		cache: 'no-store',
	});
	const json = await response.json();
	const imgKey = keyFromUrl(String(json?.data?.wbi_img?.img_url || ''));
	const subKey = keyFromUrl(String(json?.data?.wbi_img?.sub_url || ''));
	if (!imgKey || !subKey) {
		throw new Error('无法获取 B 站 WBI 密钥');
	}
	cachedKeys = { imgKey, subKey, expires: Date.now() + 10 * 60 * 1000 };
	return cachedKeys;
}

export async function buildWbiPlayurl(bvid: string, cid: number): Promise<string> {
	const { imgKey, subKey } = await loadWbiKeys();
	const query = encodeWbiQuery(
		{ bvid, cid, fnval: 16, fnver: 0, fourk: 1 },
		imgKey,
		subKey,
		Math.round(Date.now() / 1000)
	);
	return `https://api.bilibili.com/x/player/wbi/playurl?${query}`;
}
