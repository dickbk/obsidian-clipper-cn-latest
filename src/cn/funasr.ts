import { TranscriptCue } from './transcript-html';

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
export const FUNASR_MODEL = 'fun-asr';
export const FUNASR_MISSING_KEY_ERROR =
	'未配置千问 AI 平台 API Key。请打开扩展设置 → 字幕生成，填入 API Key（https://platform.qianwenai.com 或 https://dashscope.console.aliyun.com/apiKey）。';

export interface FunAsrSentence {
	begin_time?: number;
	end_time?: number;
	text?: string;
}

export interface FunAsrTranscript {
	sentences?: FunAsrSentence[];
	text?: string;
}

export interface FunAsrResultJson {
	transcripts?: FunAsrTranscript[];
	properties?: {
		original_duration_in_milliseconds?: number;
	};
}

export function parseFunAsrResult(payload: FunAsrResultJson | string): {
	cues: TranscriptCue[];
	originalDurationSec: number;
} {
	const data: FunAsrResultJson = typeof payload === 'string' ? JSON.parse(payload) : payload;
	const cues: TranscriptCue[] = [];
	for (const transcript of data.transcripts || []) {
		for (const sentence of transcript.sentences || []) {
			const text = String(sentence.text || '').trim();
			if (!text) continue;
			cues.push({
				start: Number(sentence.begin_time || 0) / 1000,
				end: Number(sentence.end_time || 0) / 1000,
				text,
			});
		}
	}
	const originalDurationSec = Number(data.properties?.original_duration_in_milliseconds || 0) / 1000;
	return { cues, originalDurationSec };
}

function describeDashScopeError(status: number, bodyText: string): string {
	if (status === 401 || status === 403) {
		return '千问 AI 平台鉴权失败。请检查设置里的 API Key 是否正确、是否有 Fun-ASR 权限。';
	}
	if (status === 429) {
		return '千问 AI 平台请求过于频繁（HTTP 429）。请稍后再试。';
	}
	const trimmed = bodyText.replace(/\s+/g, ' ').trim().slice(0, 240);
	return `FunASR HTTP ${status}${trimmed ? `：${trimmed}` : ''}`;
}

async function readJson(response: Response): Promise<any> {
	const text = await response.text();
	let payload: any = null;
	try {
		payload = text ? JSON.parse(text) : null;
	} catch {
		payload = null;
	}
	if (!response.ok) {
		throw new Error(describeDashScopeError(response.status, text || JSON.stringify(payload || {})));
	}
	if (payload?.code && String(payload.code) !== 'Success') {
		throw new Error(`FunASR 错误：${payload.message || payload.code}`);
	}
	return payload;
}

interface UploadPolicy {
	policy: string;
	signature: string;
	upload_dir: string;
	upload_host: string;
	oss_access_key_id: string;
	x_oss_object_acl: string;
	x_oss_forbid_overwrite: string;
	max_file_size_mb?: string;
}

async function getUploadPolicy(apiKey: string): Promise<UploadPolicy> {
	const url = new URL(`${DASHSCOPE_BASE}/uploads`);
	url.searchParams.set('action', 'getPolicy');
	url.searchParams.set('model', FUNASR_MODEL);
	const response = await fetch(url.toString(), {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
		},
		cache: 'no-store',
	});
	const payload = await readJson(response);
	const data = payload?.data as UploadPolicy | undefined;
	if (!data?.upload_host || !data.policy || !data.signature || !data.upload_dir) {
		throw new Error('FunASR 上传凭证不完整，请稍后重试。');
	}
	return data;
}

async function uploadAudioToTempOss(
	apiKey: string,
	audio: ArrayBuffer,
	fileName: string
): Promise<string> {
	const policy = await getUploadPolicy(apiKey);
	const maxMb = Number(policy.max_file_size_mb || 0);
	if (maxMb > 0 && audio.byteLength > maxMb * 1024 * 1024) {
		throw new Error(`音频约 ${(audio.byteLength / (1024 * 1024)).toFixed(1)}MB，超过 FunASR 临时上传上限 ${maxMb}MB。`);
	}

	const safeName = fileName.replace(/[^\w.\-]+/g, '_') || 'audio.mp4';
	const unique = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
	const key = `${policy.upload_dir.replace(/\/$/, '')}/${unique}_${safeName}`;
	const form = new FormData();
	form.append('OSSAccessKeyId', policy.oss_access_key_id);
	form.append('Signature', policy.signature);
	form.append('policy', policy.policy);
	form.append('x-oss-object-acl', policy.x_oss_object_acl);
	form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
	form.append('key', key);
	form.append('success_action_status', '200');
	form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mp4' }), safeName);

	const uploadResponse = await fetch(policy.upload_host, {
		method: 'POST',
		body: form,
		cache: 'no-store',
	});
	if (!uploadResponse.ok) {
		const body = await uploadResponse.text().catch(() => '');
		throw new Error(describeDashScopeError(uploadResponse.status, body || 'OSS 上传失败'));
	}
	return `oss://${key}`;
}

async function submitTranscription(apiKey: string, fileUrl: string, languageHints: string[]): Promise<string> {
	const response = await fetch(`${DASHSCOPE_BASE}/services/audio/asr/transcription`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json',
			'X-DashScope-Async': 'enable',
			'X-DashScope-OssResourceResolve': 'enable',
		},
		body: JSON.stringify({
			model: FUNASR_MODEL,
			input: { file_urls: [fileUrl] },
			parameters: {
				channel_id: [0],
				language_hints: languageHints.length ? languageHints : ['zh'],
			},
		}),
		cache: 'no-store',
	});
	const payload = await readJson(response);
	const taskId = payload?.output?.task_id;
	if (!taskId) {
		throw new Error('FunASR 未返回 task_id');
	}
	return String(taskId);
}

async function fetchTranscriptionResult(transcriptionUrl: string): Promise<{
	cues: TranscriptCue[];
	originalDurationSec: number;
}> {
	const response = await fetch(transcriptionUrl, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`下载 FunASR 结果失败（HTTP ${response.status}）`);
	}
	const json = await response.json() as FunAsrResultJson;
	return parseFunAsrResult(json);
}

export async function transcribeWithFunAsr(
	audio: ArrayBuffer,
	fileName: string,
	options: {
		apiKey: string;
		languageHints?: string[];
		pollIntervalMs?: number;
		maxPollMs?: number;
		expectedDurationSec?: number;
		onStage?: (stage: string) => void | Promise<void>;
	}
): Promise<{ cues: TranscriptCue[]; originalDurationSec: number }> {
	const apiKey = options.apiKey.trim();
	if (!apiKey) {
		throw new Error(FUNASR_MISSING_KEY_ERROR);
	}

	await options.onStage?.('正在上传音频到阿里云临时存储');
	const fileUrl = await uploadAudioToTempOss(apiKey, audio, fileName);

	await options.onStage?.('已提交 FunASR 识别任务');
	const taskId = await submitTranscription(apiKey, fileUrl, options.languageHints || ['zh']);

	const pollIntervalMs = options.pollIntervalMs ?? 5000;
	const maxPollMs = options.maxPollMs ?? 2 * 60 * 60 * 1000;
	const started = Date.now();
	let consecutiveErrors = 0;

	while (Date.now() - started < maxPollMs) {
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		const elapsedSec = Math.round((Date.now() - started) / 1000);
		try {
			const response = await fetch(`${DASHSCOPE_BASE}/tasks/${encodeURIComponent(taskId)}`, {
				method: 'GET',
				headers: { Authorization: `Bearer ${apiKey}` },
				cache: 'no-store',
			});
			const payload = await readJson(response);
			consecutiveErrors = 0;
			const status = String(payload?.output?.task_status || '');
			if (status === 'SUCCEEDED') {
				const results = Array.isArray(payload?.output?.results) ? payload.output.results : [];
				const first = results[0] || {};
				if (first.subtask_status === 'FAILED' || first.code) {
					throw new Error(`FunASR 识别失败：${first.message || first.code || '未知错误'}`);
				}
				const transcriptionUrl = first.transcription_url;
				if (!transcriptionUrl) {
					throw new Error('FunASR 成功但未返回 transcription_url');
				}
				await options.onStage?.('正在下载识别结果');
				const parsed = await fetchTranscriptionResult(String(transcriptionUrl));
				const expected = options.expectedDurationSec || 0;
				if (expected > 30 && parsed.originalDurationSec > 0) {
					const ratio = parsed.originalDurationSec / expected;
					if (ratio < 0.7 || ratio > 1.35) {
						throw new Error(
							`FunASR 识别到的音频时长约 ${Math.round(parsed.originalDurationSec)}s，与期望 ${Math.round(expected)}s 不符，可能下错了音轨。请刷新页面后重试。`
						);
					}
				}
				return parsed;
			}
			if (status === 'FAILED') {
				throw new Error(`FunASR 识别失败：${payload?.output?.message || '未知错误'}`);
			}
			if (status === 'PENDING' || status === 'RUNNING') {
				await options.onStage?.(`FunASR 识别中…已等待 ${elapsedSec}s`);
				continue;
			}
			throw new Error(`FunASR 未知任务状态：${status || 'empty'}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/FunASR 识别失败|未知任务状态|transcription_url|鉴权失败|音频时长/.test(message)) {
				throw error;
			}
			consecutiveErrors += 1;
			if (consecutiveErrors >= 10) {
				throw new Error(`FunASR 连续查询失败：${message}`);
			}
			await options.onStage?.(`查询失败，重试中（${consecutiveErrors}/10）`);
		}
	}

	throw new Error(`FunASR 轮询超时（task_id=${taskId}）`);
}
