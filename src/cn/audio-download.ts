const RANGE_CHUNK_BYTES = 2 * 1024 * 1024;
const PROBE_BYTES = 256 * 1024;
const MAX_RANGE_RETRIES = 3;

export interface DownloadProgress {
	received: number;
	total: number;
}

export function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
	if (!header) return null;
	const match = header.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
	if (!match) return null;
	const total = match[3] === '*' ? 0 : Number(match[3]);
	return {
		start: Number(match[1]),
		end: Number(match[2]),
		total,
	};
}

async function fetchWithRetry(url: string, init: RequestInit, retries = MAX_RANGE_RETRIES): Promise<Response> {
	let lastError: Error | null = null;
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url, init);
			if (response.status === 408 || response.status === 429 || response.status >= 500) {
				lastError = new Error(`HTTP ${response.status}`);
				await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
				continue;
			}
			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
		}
	}
	throw lastError || new Error('下载音轨失败');
}

export async function downloadBinaryByRange(
	url: string,
	options?: {
		onProgress?: (progress: DownloadProgress) => void;
		maxBytes?: number;
		/**
		 * Optional check on the final response URL after redirects.
		 * Return an error message to abort, or null to accept.
		 */
		validateFinalUrl?: (finalUrl: string) => string | null;
	}
): Promise<ArrayBuffer> {
	const probeEnd = PROBE_BYTES - 1;
	const probe = await fetchWithRetry(url, {
		cache: 'no-store',
		credentials: 'omit',
		headers: { Range: `bytes=0-${probeEnd}` },
	});
	if (!probe.ok && probe.status !== 206) {
		throw new Error(`下载音轨失败：HTTP ${probe.status}`);
	}

	// Stick to the post-redirect CDN URL for every subsequent Range request.
	// Re-hitting the original signed URL can land on a different mirror/file.
	const finalUrl = probe.url || url;
	const invalid = options?.validateFinalUrl?.(finalUrl);
	if (invalid) {
		throw new Error(invalid);
	}

	const probeBytes = new Uint8Array(await probe.arrayBuffer());
	const ranged = parseContentRange(probe.headers.get('Content-Range'));
	const contentLength = Number(probe.headers.get('Content-Length') || 0);

	if (probe.status === 200 && (!ranged || ranged.total <= probeBytes.byteLength)) {
		options?.onProgress?.({ received: probeBytes.byteLength, total: probeBytes.byteLength });
		if (options?.maxBytes && probeBytes.byteLength > options.maxBytes) {
			throw new Error('音轨过大，无法在扩展内上传识别');
		}
		return probeBytes.buffer;
	}

	const total = ranged?.total || (contentLength > probeBytes.byteLength ? contentLength : 0);
	if (!total) {
		options?.onProgress?.({ received: probeBytes.byteLength, total: probeBytes.byteLength });
		return probeBytes.buffer;
	}
	if (options?.maxBytes && total > options.maxBytes) {
		throw new Error('音轨过大，无法在扩展内上传识别');
	}

	const output = new Uint8Array(total);
	output.set(probeBytes.subarray(0, Math.min(probeBytes.byteLength, total)), 0);
	let received = Math.min(probeBytes.byteLength, total);
	options?.onProgress?.({ received, total });

	while (received < total) {
		const start = received;
		const end = Math.min(total, start + RANGE_CHUNK_BYTES) - 1;
		const response = await fetchWithRetry(finalUrl, {
			cache: 'no-store',
			credentials: 'omit',
			headers: { Range: `bytes=${start}-${end}` },
		});
		if (!response.ok && response.status !== 206) {
			throw new Error(`下载音轨失败：HTTP ${response.status}（${start}-${end}）`);
		}
		// If a mirror replies with a full body instead of a range, abort —
		// writing it at `start` would splice the wrong audio into the file.
		if (response.status === 200) {
			throw new Error('CDN 未按 Range 返回分片，已中止以免拼错音轨');
		}
		const responseUrl = response.url || finalUrl;
		const rangeInvalid = options?.validateFinalUrl?.(responseUrl);
		if (rangeInvalid) {
			throw new Error(rangeInvalid);
		}
		const chunk = new Uint8Array(await response.arrayBuffer());
		if (!chunk.byteLength) {
			throw new Error('下载音轨中断，CDN 返回了空分片');
		}
		output.set(chunk.subarray(0, Math.min(chunk.byteLength, total - start)), start);
		received = Math.min(total, start + chunk.byteLength);
		options?.onProgress?.({ received, total });
	}

	return output.buffer;
}
