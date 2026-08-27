function rhex(n: number): string {
	const hex = '0123456789abcdef';
	let out = '';
	for (let i = 0; i < 4; i++) {
		out += hex.charAt((n >> (i * 8 + 4)) & 0x0f) + hex.charAt((n >> (i * 8)) & 0x0f);
	}
	return out;
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
	a = (a + q + x + t) | 0;
	return (((a << s) | (a >>> (32 - s))) + b) | 0;
}

export function md5(str: string): string {
	const bytes = new TextEncoder().encode(str);
	const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) * 64);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(padded.length - 8, bytes.length * 8, true);

	let a = 1732584193;
	let b = -271733879;
	let c = -1732584194;
	let d = 271733878;

	for (let i = 0; i < padded.length; i += 64) {
		const aa = a;
		const bb = b;
		const cc = c;
		const dd = d;
		const x: number[] = [];
		for (let j = 0; j < 16; j++) {
			x[j] = view.getUint32(i + j * 4, true);
		}

		const ff = (a0: number, b0: number, c0: number, d0: number, x0: number, s: number, t: number) =>
			cmn((b0 & c0) | (~b0 & d0), a0, b0, x0, s, t);
		const gg = (a0: number, b0: number, c0: number, d0: number, x0: number, s: number, t: number) =>
			cmn((b0 & d0) | (c0 & ~d0), a0, b0, x0, s, t);
		const hh = (a0: number, b0: number, c0: number, d0: number, x0: number, s: number, t: number) =>
			cmn(b0 ^ c0 ^ d0, a0, b0, x0, s, t);
		const ii = (a0: number, b0: number, c0: number, d0: number, x0: number, s: number, t: number) =>
			cmn(c0 ^ (b0 | ~d0), a0, b0, x0, s, t);

		a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586);
		c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
		a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426);
		c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
		a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417);
		c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
		a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101);
		c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);

		a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632);
		c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
		a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083);
		c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
		a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690);
		c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
		a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784);
		c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);

		a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463);
		c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
		a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353);
		c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
		a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222);
		c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
		a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835);
		c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);

		a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415);
		c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
		a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606);
		c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
		a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744);
		c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
		a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379);
		c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);

		a = (a + aa) | 0;
		b = (b + bb) | 0;
		c = (c + cc) | 0;
		d = (d + dd) | 0;
	}

	return rhex(a) + rhex(b) + rhex(c) + rhex(d);
}
