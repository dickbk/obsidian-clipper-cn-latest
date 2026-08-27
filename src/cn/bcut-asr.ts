import { TranscriptCue } from './transcript-html';

const API_BASE_URL = 'https://member.bilibili.com/x/bcut/rubick-interface';
const SUPPORTED_AUDIO = new Set(['flac', 'aac', 'm4a', 'mp3', 'wav']);
const BCUT_BROWSER_HEADERS: Record<string, string> = {
	Accept: 'application/json, text/plain, */*',
	'Cache-Control': 'no-cache',
};

export interface BcutUtterance {
	start_time?: number;
	end_time?: number;
	transcript?: string;
}

export interface BcutRawResult {
	language?: string;
	utterances?: BcutUtterance[];
}

export function parseBcutResult(rawResult: string | BcutRawResult): TranscriptCue[] {
	const payload: BcutRawResult = typeof rawResult === 'string' ? JSON.parse(rawResult) : rawResult;
	const utterances = Array.isArray(payload.utterances) ? payload.utterances : [];
	return utterances
		.map((item) => ({
			start: Number(item.start_time || 0) / 1000,
			end: Number(item.end_time || 0) / 1000,
			text: String(item.transcript || '').trim(),
		}))
		.filter((cue) => cue.text.length > 0);
}

export const BCUT_QUOTA_ERROR =
	'必剪免费语音识别额度已用尽。70 分钟视频会按约 12 分钟一片上传，今天多次重试都会扣额度。请明天再试、换一个已登录 B 站的浏览器账号，或打开必剪/花生开通额度后再点生成。';

export function isBcutQuotaError(message: string | undefined): boolean {
	if (!message) return false;
	return /额度|用尽|花生|quota/i.test(message);
}

export function describeBcutApiError(payload: { code?: unknown; message?: unknown }): string {
	const message = String(payload?.message || '').trim();
	if (isBcutQuotaError(message)) {
		return BCUT_QUOTA_ERROR;
	}
	return `BCut API 错误：${message || payload?.code}`;
}

export function describeBcutHttpError(status: number): string {
	if (status === 412) {
		return '必剪接口被拦截（HTTP 412）。请重新加载扩展，并保持在 B 站视频页再试。';
	}
	if (status === 403 || status === 401) {
		return `必剪拒绝访问（HTTP ${status}）。请在浏览器中登录 B 站后再试。`;
	}
	if (status === 429) {
		return '必剪请求过于频繁（HTTP 429）。请稍后再试。';
	}
	return `BCut HTTP ${status}`;
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 409 || status === 412 || status === 425 || status === 429 || status >= 500;
}

function mergeHeaders(init?: HeadersInit): Record<string, string> {
	const headers: Record<string, string> = { ...BCUT_BROWSER_HEADERS };
	if (!init) return headers;
	if (init instanceof Headers) {
		init.forEach((value, key) => {
			headers[key] = value;
		});
		return headers;
	}
	if (Array.isArray(init)) {
		for (const [key, value] of init) {
			headers[key] = value;
		}
		return headers;
	}
	return { ...headers, ...init };
}

async function fetchWithRetry(url: string, init: RequestInit = {}, retries = 5): Promise<Response> {
	let lastError: Error | null = null;
	const requestInit: RequestInit = {
		credentials: 'include',
		cache: 'no-store',
		...init,
		headers: mergeHeaders(init.headers),
	};
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(url, requestInit);
			if (isRetryableStatus(response.status) && attempt < retries - 1) {
				lastError = new Error(describeBcutHttpError(response.status));
				await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
				continue;
			}
			return response;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt === retries - 1) throw lastError;
			await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
		}
	}
	throw lastError || new Error('BCut 请求失败');
}

async function readJson(response: Response): Promise<any> {
	if (!response.ok) {
		throw new Error(describeBcutHttpError(response.status));
	}
	const payload = await response.json();
	if (payload?.code !== 0) {
		throw new Error(describeBcutApiError(payload));
	}
	return payload.data;
}

function inferAudioFormat(fileName: string, mimeType?: string): string {
	const fromName = fileName.split('.').pop()?.toLowerCase() || '';
	if (SUPPORTED_AUDIO.has(fromName)) return fromName;
	if (mimeType?.includes('mp4') || mimeType?.includes('aac') || mimeType?.includes('m4a')) return 'm4a';
	if (mimeType?.includes('mpeg') || mimeType?.includes('mp3')) return 'mp3';
	if (mimeType?.includes('wav')) return 'wav';
	if (mimeType?.includes('flac')) return 'flac';
	return 'm4a';
}

export async function transcribeWithBcut(
	audio: ArrayBuffer,
	fileName: string,
	mimeType?: string,
	pollIntervalMs = 2000
): Promise<TranscriptCue[]> {
	const audioFormat = inferAudioFormat(fileName, mimeType);
	if (!SUPPORTED_AUDIO.has(audioFormat)) {
		throw new Error(`BCut 不支持 ${audioFormat} 音频格式`);
	}

	const sound = new Uint8Array(audio);
	const create = await readJson(await fetchWithRetry(`${API_BASE_URL}/resource/create`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			type: '2',
			name: fileName,
			size: String(sound.byteLength),
			resource_file_type: audioFormat,
			model_id: '7',
		}),
	}));

	const etags: string[] = [];
	const partSize = Number(create.per_size);
	const uploadUrls: string[] = create.upload_urls || [];
	for (let index = 0; index < uploadUrls.length; index++) {
		const start = index * partSize;
		const chunk = sound.subarray(start, start + partSize);
		const response = await fetchWithRetry(uploadUrls[index], {
			method: 'PUT',
			body: chunk,
		});
		if (!response.ok) {
			throw new Error(`BCut 上传失败：${describeBcutHttpError(response.status)}`);
		}
		etags.push((response.headers.get('Etag') || response.headers.get('ETag') || '').replace(/"/g, ''));
	}

	const complete = await readJson(await fetchWithRetry(`${API_BASE_URL}/resource/create/complete`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			in_boss_key: String(create.in_boss_key || ''),
			resource_id: String(create.resource_id || ''),
			etags: etags.join(','),
			upload_id: String(create.upload_id || ''),
			model_id: '7',
		}),
	}));

	const task = await readJson(await fetchWithRetry(`${API_BASE_URL}/task`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			resource: complete.download_url,
			model_id: '7',
		}),
	}));

	for (let i = 0; i < 900; i++) {
		const state = await readJson(await fetchWithRetry(
			`${API_BASE_URL}/task/result?model_id=7&task_id=${encodeURIComponent(task.task_id)}`
		));
		if (state.state === 4) {
			return parseBcutResult(state.result);
		}
		if (state.state === 3) {
			throw new Error(`BCut 识别失败：${state.remark || '未知错误'}`);
		}
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	throw new Error('BCut 识别超时');
}
