import type { Runtime } from 'webextension-polyfill';
import { downloadBinaryByRange } from './audio-download';
import { transcribeWithFunAsr, FUNASR_MISSING_KEY_ERROR } from './funasr';
import { audioFileLabel, audioUrlBelongsToCid, audioUrlStrictlyMatchesCid, cidFromDashAudioUrl, dashDurationMatches, preferAlternateCdnUrls } from './bilibili-audio-match';
import { fetchBilibiliPlayurlAudioInPage, type PageAudioLookupResult } from './bilibili-page-audio';
import { resolveBilibiliVideoMeta, type BilibiliVideoMeta } from './bilibili-video-meta';
import { buildWbiPlayurl } from './bilibili-wbi';
import { createLogger } from './logger';
import {
	buildGeneratedTranscript,
	bilibiliUrlFromCacheKey,
	formatTranscriptTimestamp,
	parseBilibiliVideoId,
	transcriptCacheKey,
	transcriptMatchesTitleHints,
} from './transcript-html';
import {
	cueCoverageSeconds,
	mergeChunkedCues,
	parseFmp4Layout,
	planTimeChunks,
	rebaseFmp4Timeline,
	sliceFmp4ByTime,
} from './mp4-audio';
import {
	cacheBelongsToVideo,
	clearCachedTranscript,
	clearTranscriptTask,
	getCachedTranscript,
	getTranscriptSettings,
	getTranscriptTask,
	isTranscriptTaskInProgress,
	setCachedTranscript,
	setTranscriptTask,
	TranscriptTask,
} from './transcript-cache';

const logger = createLogger('Transcript');
const AUDIO_REFERER_RULE_ID = 9004;
const API_REFERER_RULE_ID = 9006;
const MAX_AUDIO_BYTES = 180 * 1024 * 1024;
const runningTasks = new Set<string>();

interface AudioSource {
	audioUrl: string;
	backupUrls: string[];
	fileName: string;
	expectedDuration?: number;
	bvid?: string;
	cid?: number;
}

const audioSnapshots = new Map<string, AudioSource>();

interface GenerateRequest {
	action: string;
	url?: string;
	cacheKey?: string;
	tabId?: number;
	force?: boolean;
}

function formatMb(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1);
}

function normalizeDuration(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return n > 100000 ? n / 1000 : n;
}

function asUrlList(value: unknown): string[] {
	if (typeof value === 'string' && value) return [value];
	if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item);
	return [];
}

function pickDashAudio(audios: any[]): { audioUrl: string; backupUrls: string[] } | null {
	if (!Array.isArray(audios) || audios.length === 0) return null;
	const sorted = [...audios].sort((a, b) => (Number(a?.bandwidth) || 0) - (Number(b?.bandwidth) || 0));
	const chosen = sorted[0];
	const audioUrl = chosen?.baseUrl || chosen?.base_url || asUrlList(chosen?.backupUrl)[0] || asUrlList(chosen?.backup_url)[0];
	if (!audioUrl) return null;
	// Only same-stream CDN mirrors — never mix other quality tracks as "backups".
	const backupUrls = asUrlList(chosen?.backupUrl || chosen?.backup_url)
		.filter((item) => item && item !== audioUrl);
	return { audioUrl, backupUrls };
}

async function enableRequestHeaderRule(
	ruleId: number,
	urlFilter: string,
	headers: Array<{ header: string; value: string }>
): Promise<void> {
	if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.updateSessionRules) {
		return;
	}
	const addRule = async (items: Array<{ header: string; value: string }>) => {
		await chrome.declarativeNetRequest.updateSessionRules({
			removeRuleIds: [ruleId],
			addRules: [{
				id: ruleId,
				priority: 2,
				action: {
					type: 'modifyHeaders' as any,
					requestHeaders: items.map((item) => ({
						header: item.header,
						operation: 'set' as any,
						value: item.value,
					})),
				},
				condition: {
					urlFilter,
					resourceTypes: ['xmlhttprequest', 'other', 'media'] as any,
					// Apply to extension fetches; leave Bilibili page/iframe playurl alone.
					excludedInitiatorDomains: [
						'www.bilibili.com',
						'bilibili.com',
						'm.bilibili.com',
						'player.bilibili.com',
					],
				},
			}],
		});
	};
	try {
		await addRule(headers);
	} catch (error) {
		const withoutOrigin = headers.filter((item) => item.header.toLowerCase() !== 'origin');
		logger.debug('Header rule failed', { ruleId, error: String(error) });
		if (withoutOrigin.length && withoutOrigin.length !== headers.length) {
			try {
				await addRule(withoutOrigin);
			} catch (retryError) {
				logger.debug('Header rule retry failed', { ruleId, error: String(retryError) });
			}
		}
	}
}

async function enableBilibiliAudioRules(audioUrl?: string): Promise<void> {
	try {
		await enableRequestHeaderRule(API_REFERER_RULE_ID, '||api.bilibili.com/', [
			{ header: 'Origin', value: 'https://www.bilibili.com' },
			{ header: 'Referer', value: 'https://www.bilibili.com/' },
		]);
		if (!audioUrl) return;
		try {
			const host = new URL(audioUrl).hostname;
			await enableRequestHeaderRule(AUDIO_REFERER_RULE_ID, `||${host}/`, [
				{ header: 'Referer', value: 'https://www.bilibili.com/' },
			]);
		} catch {
			await enableRequestHeaderRule(AUDIO_REFERER_RULE_ID, '||bilivideo.com/', [
				{ header: 'Referer', value: 'https://www.bilibili.com/' },
			]);
		}
	} catch (error) {
		logger.debug('Bilibili audio header rules failed', { error: String(error) });
	}
}

async function readPlayurl(bvid: string, cid: number): Promise<{ audio: ReturnType<typeof pickDashAudio>; duration: number }> {
	const unsigned = new URL('https://api.bilibili.com/x/player/playurl');
	unsigned.searchParams.set('bvid', bvid);
	unsigned.searchParams.set('cid', String(cid));
	unsigned.searchParams.set('fnval', '16');
	unsigned.searchParams.set('fnver', '0');
	unsigned.searchParams.set('fourk', '1');
	const urls: string[] = [];
	try {
		urls.push(await buildWbiPlayurl(bvid, cid));
	} catch (error) {
		logger.debug('WBI playurl sign failed', { error: String(error) });
	}
	urls.push(unsigned.toString());

	let lastDuration = 0;
	for (const playUrl of urls) {
		try {
			const playResponse = await fetch(playUrl, {
				credentials: 'omit',
				cache: 'no-store',
			});
			const playJson = await playResponse.json();
			const audio = pickDashAudio(playJson?.data?.dash?.audio || playJson?.result?.dash?.audio || []);
			lastDuration = normalizeDuration(playJson?.data?.dash?.duration || playJson?.data?.timelength);
			if (audio) {
				return { audio, duration: lastDuration };
			}
		} catch (error) {
			logger.debug('Playurl request failed', { error: String(error) });
		}
	}
	return { audio: null, duration: lastDuration };
}

function sourceFromPlay(meta: BilibiliVideoMeta, play: { audio: ReturnType<typeof pickDashAudio>; duration: number }): AudioSource | null {
	if (!play.audio) return null;
	if (!dashDurationMatches(play.duration, meta.expectedDuration)) {
		return null;
	}
	if (!audioUrlStrictlyMatchesCid(play.audio.audioUrl, meta.cid)) {
		return null;
	}
	return {
		audioUrl: play.audio.audioUrl,
		backupUrls: play.audio.backupUrls.filter((item) => audioUrlBelongsToCid(item, meta.cid)),
		fileName: `${meta.bvid}.m4a`,
		expectedDuration: meta.expectedDuration || play.duration,
		bvid: meta.bvid,
		cid: meta.cid,
	};
}

function sourceMatchesMeta(source: AudioSource | null | undefined, meta: BilibiliVideoMeta | null): boolean {
	if (!source?.audioUrl || !meta?.cid || !meta.bvid) return false;
	if (source.bvid && source.bvid !== meta.bvid) return false;
	if (source.cid && source.cid !== meta.cid) return false;
	if (!audioUrlStrictlyMatchesCid(source.audioUrl, meta.cid)) return false;
	if (source.expectedDuration && !dashDurationMatches(source.expectedDuration, meta.expectedDuration)) {
		return false;
	}
	return true;
}

async function resolveAudioFromApis(url: string): Promise<AudioSource | null> {
	const meta = await resolveBilibiliVideoMeta(url);
	if (!meta) return null;
	const play = await readPlayurl(meta.bvid, meta.cid);
	return sourceFromPlay(meta, play);
}

async function resolveAudioFromPagePlayurl(
	tabId: number,
	meta: BilibiliVideoMeta
): Promise<AudioSource | null> {
	if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
		return null;
	}
	try {
		const results = await chrome.scripting.executeScript({
			target: { tabId, allFrames: false },
			world: 'MAIN',
			func: fetchBilibiliPlayurlAudioInPage,
			args: [meta.bvid, meta.cid, meta.expectedDuration],
		});
		const pageResult = (results?.[0]?.result || null) as PageAudioLookupResult | null;
		if (!pageResult?.audioUrl) return null;
		if (!audioUrlStrictlyMatchesCid(pageResult.audioUrl, meta.cid)) return null;
		if (!dashDurationMatches(pageResult.duration, meta.expectedDuration)) return null;
		return {
			audioUrl: pageResult.audioUrl,
			backupUrls: (pageResult.backupUrls || []).filter((item) => audioUrlBelongsToCid(item, meta.cid)),
			fileName: `${meta.bvid}.m4a`,
			expectedDuration: meta.expectedDuration || pageResult.duration,
			bvid: meta.bvid,
			cid: meta.cid,
		};
	} catch (error) {
		logger.debug('Page playurl inject failed', { error: String(error) });
		return null;
	}
}

async function resolveAudioFromTab(tabId: number | undefined, url: string): Promise<AudioSource | null> {
	const meta = await resolveBilibiliVideoMeta(url);
	if (!meta) return null;
	// Prefer in-page playurl (user cookies) for the exact bvid+cid. Never read __playinfo__.
	if (tabId != null) {
		const fromPage = await resolveAudioFromPagePlayurl(tabId, meta);
		if (fromPage) return fromPage;
	}
	const play = await readPlayurl(meta.bvid, meta.cid);
	return sourceFromPlay(meta, play);
}

function rememberAudioSnapshot(url: string, source: AudioSource | null): AudioSource | null {
	const cacheKey = transcriptCacheKey(url);
	if (!cacheKey || !source?.audioUrl) return source;
	audioSnapshots.set(cacheKey, source);
	return source;
}

async function snapshotAudioFromTab(tabId: number, url: string): Promise<AudioSource | null> {
	const source = await resolveAudioFromTab(tabId, url);
	return rememberAudioSnapshot(url, source);
}

function progressPayload(task: TranscriptTask) {
	return {
		action: 'cnTranscriptProgress',
		cacheKey: task.cacheKey,
		status: task.status,
		stage: task.stage,
		error: task.error,
		result: task.result,
	};
}

async function broadcast(task: TranscriptTask): Promise<void> {
	await setTranscriptTask(task);
	const payload = progressPayload(task);
	try {
		await chrome.runtime.sendMessage(payload);
	} catch {
		// No popup/reader listener yet.
	}
	if (task.tabId) {
		try {
			await chrome.tabs.sendMessage(task.tabId, payload);
		} catch {
			// Tab has no content script, or reader was closed.
		}
	}
}

function keepAliveWhile<T>(work: Promise<T>): Promise<T> {
	const timer = setInterval(() => {
		try {
			chrome.runtime.getPlatformInfo(() => undefined);
		} catch {
			// Ignore keep-alive failures.
		}
	}, 20000);
	return work.finally(() => clearInterval(timer));
}

async function downloadCompleteAudio(
	source: AudioSource,
	onProgress: (received: number, total: number) => Promise<void>
): Promise<{ audio: ArrayBuffer; duration: number }> {
	// Primary URL first (known-good cid). Alternates are fallbacks only.
	const urls = [source.audioUrl, ...preferAlternateCdnUrls(source.audioUrl, source.backupUrls)]
		.filter((item, index, list) => item && list.indexOf(item) === index);
	let lastError: Error | null = null;

	for (const audioUrl of urls) {
		try {
			await enableBilibiliAudioRules(audioUrl);
			const audio = await downloadBinaryByRange(audioUrl, {
				maxBytes: MAX_AUDIO_BYTES,
				validateFinalUrl: (finalUrl) => {
					if (!audioUrlStrictlyMatchesCid(finalUrl, source.cid || 0)) {
						const got = cidFromDashAudioUrl(finalUrl) || '?';
						return `CDN 重定向后的音轨 cid=${got}，与当前视频 cid=${source.cid} 不一致`;
					}
					return null;
				},
				onProgress: (progress) => {
					void onProgress(progress.received, progress.total);
				},
			});
			const layout = parseFmp4Layout(new Uint8Array(audio));
			const duration = layout?.duration || 0;
			if (layout?.fragments.length) {
				const last = layout.fragments[layout.fragments.length - 1];
				const needed = last.start + last.size;
				if (needed > audio.byteLength + 2048) {
					lastError = new Error(`音轨不完整：文件 ${formatMb(audio.byteLength)}MB，索引需要 ${formatMb(needed)}MB。请刷新页面后重试。`);
					continue;
				}
			}
			if (source.expectedDuration && duration > 0 && duration < source.expectedDuration * 0.9) {
				lastError = new Error(`音轨不完整：音频约 ${formatTranscriptTimestamp(duration)}，视频约 ${formatTranscriptTimestamp(source.expectedDuration)}。请刷新页面后重试。`);
				continue;
			}
			if (source.expectedDuration && duration === 0) {
				const minBytes = source.expectedDuration * 4000;
				if (audio.byteLength < minBytes * 0.4) {
					lastError = new Error(`音轨不完整：只下到 ${formatMb(audio.byteLength)}MB，视频约 ${formatTranscriptTimestamp(source.expectedDuration)}。请刷新页面后重试。`);
					continue;
				}
			}
			return { audio, duration: duration || source.expectedDuration || 0 };
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}

	throw lastError || new Error('无法下载完整音轨');
}

async function transcribeFullAudio(
	audio: ArrayBuffer,
	fileName: string,
	apiKey: string,
	taskBase: Omit<TranscriptTask, 'status' | 'stage'>,
	expectedDurationSec: number
): Promise<{ cues: Awaited<ReturnType<typeof mergeChunkedCues>>; duration: number }> {
	const bytes = new Uint8Array(audio);
	const layout = parseFmp4Layout(bytes);
	const duration = layout?.duration || expectedDurationSec || 0;
	const baseName = fileName.replace(/\.\w+$/, '') || 'audio';

	// Long fragmented DASH m4s confuses FunASR when uploaded whole; slice like the
	// old BCut path so each piece is a short, timeline-rebased fMP4.
	const chunks = planTimeChunks(duration || expectedDurationSec || 0);
	if (!layout?.fragments.length || chunks.length <= 1) {
		const normalized = rebaseFmp4Timeline(new Uint8Array(audio), duration || expectedDurationSec);
		const buffer = normalized.buffer.slice(
			normalized.byteOffset,
			normalized.byteOffset + normalized.byteLength
		);
		const transcribed = await transcribeWithFunAsr(buffer, `${baseName}.mp4`, {
			apiKey,
			languageHints: ['zh'],
			expectedDurationSec: duration || expectedDurationSec,
			onStage: async (stage) => {
				await broadcast({ ...taskBase, status: 'transcribing', stage });
			},
		});
		return { cues: transcribed.cues, duration };
	}

	const parts: { start: number; end: number; cues: Awaited<ReturnType<typeof mergeChunkedCues>> }[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const slice = sliceFmp4ByTime(bytes, layout, chunk.start, chunk.end);
		const chunkDuration = Math.max(1, chunk.end - chunk.start);
		await broadcast({
			...taskBase,
			status: 'transcribing',
			stage: `FunASR 识别 ${i + 1}/${chunks.length}（${formatTranscriptTimestamp(chunk.start)}–${formatTranscriptTimestamp(chunk.end)}）`,
		});
		const transcribed = await transcribeWithFunAsr(
			slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
			`${baseName}_p${i + 1}.mp4`,
			{
				apiKey,
				languageHints: ['zh'],
				expectedDurationSec: chunkDuration,
				onStage: async (stage) => {
					await broadcast({
						...taskBase,
						status: 'transcribing',
						stage: `第 ${i + 1}/${chunks.length} 段：${stage}`,
					});
				},
			}
		);
		parts.push({ start: chunk.start, end: chunk.end, cues: transcribed.cues });
	}

	return { cues: mergeChunkedCues(parts), duration };
}

async function runGenerateTask(url: string, tabId?: number, force = false, cacheKeyHint?: string): Promise<void> {
	let resolvedUrl = url;
	if (!transcriptCacheKey(resolvedUrl) && cacheKeyHint) {
		const fromKey = bilibiliUrlFromCacheKey(cacheKeyHint);
		if (fromKey) resolvedUrl = fromKey;
	}
	const cacheKey = transcriptCacheKey(resolvedUrl);
	const taskBase = { cacheKey: cacheKey || resolvedUrl, url: resolvedUrl, tabId };
	if (!cacheKey) {
		await broadcast({
			...taskBase,
			status: 'failed',
			stage: '生成失败',
			error: '不是可识别的 B 站视频链接',
		});
		return;
	}
	try {
		if (force) {
			// Drop both cache and any prior "completed" task so Reader cannot
			// instantly re-apply a stale wrong transcript while we re-download.
			await clearCachedTranscript(cacheKey);
			await clearTranscriptTask(cacheKey);
			await broadcast({
				...taskBase,
				status: 'queued',
				stage: '开始处理…',
			});
		} else {
			const cached = await getCachedTranscript(cacheKey);
			const earlyMeta = await resolveBilibiliVideoMeta(resolvedUrl).catch(() => null);
			if (cacheBelongsToVideo(cached, earlyMeta, transcriptMatchesTitleHints)) {
				await broadcast({
					...taskBase,
					status: 'completed',
					stage: '字幕已生成',
					result: cached!,
				});
				return;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.debug('Transcript cache lookup failed', { cacheKey, error: message });
	}

	if (runningTasks.has(cacheKey)) {
		return;
	}
	runningTasks.add(cacheKey);
	try {
		const settings = await getTranscriptSettings();
		const apiKey = settings.dashscopeApiKey?.trim() || '';
		if (!apiKey) {
			throw new Error(FUNASR_MISSING_KEY_ERROR);
		}

		await broadcast({ ...taskBase, status: 'queued', stage: '开始处理…' });
		await enableBilibiliAudioRules();
		await broadcast({ ...taskBase, status: 'downloading', stage: '正在定位当前视频音轨' });

		const meta = await resolveBilibiliVideoMeta(resolvedUrl);
		// Prefer tab playurl (cookies) for this BV/cid; fall back to extension API.
		// Never reuse snapshots / page __playinfo__.
		audioSnapshots.delete(cacheKey);
		const source = tabId != null
			? await resolveAudioFromTab(tabId, resolvedUrl)
			: await resolveAudioFromApis(resolvedUrl);
		if (!source?.audioUrl) {
			throw new Error('无法通过接口获取当前视频音轨。请刷新 B 站视频页后重试。');
		}
		if (!meta || !sourceMatchesMeta(source, meta)) {
			const file = audioFileLabel(source.audioUrl);
			const gotCid = cidFromDashAudioUrl(source.audioUrl) || source.cid || '?';
			throw new Error(
				`音轨与当前视频不一致（期望 cid=${meta?.cid || '?'}，实际 ${file} / cid=${gotCid}）。请刷新页面后重试。`
			);
		}
		rememberAudioSnapshot(resolvedUrl, source);
		const parsedId = parseBilibiliVideoId(resolvedUrl);
		if (parsedId?.bvid && source.bvid && source.bvid !== parsedId.bvid) {
			throw new Error(`定位到的音轨属于 ${source.bvid}，不是当前视频 ${parsedId.bvid}。请刷新页面后重试。`);
		}

		const { audio, duration } = await downloadCompleteAudio(source, async (received, total) => {
			const id = source.bvid || parsedId?.bvid || '';
			const file = audioFileLabel(source.audioUrl);
			const suffix = source.expectedDuration
				? `，${id} cid=${source.cid} ${file} 约 ${formatTranscriptTimestamp(source.expectedDuration)}`
				: `，${id} cid=${source.cid} ${file}`.trim();
			await broadcast({
				...taskBase,
				status: 'downloading',
				stage: `正在下载音频 ${formatMb(received)} / ${formatMb(total || received)} MB${suffix}`,
			});
		});

		await broadcast({
			...taskBase,
			status: 'transcribing',
			stage: `正在上传 FunASR（${source.bvid} cid=${source.cid} ${audioFileLabel(source.audioUrl)}）`,
		});
		const transcribed = await transcribeFullAudio(
			audio,
			`${source.bvid}_cid${source.cid}.mp4`,
			apiKey,
			taskBase,
			source.expectedDuration || duration || meta.expectedDuration || 0
		);
		if (!transcribed.cues.length) {
			throw new Error('FunASR 没有返回可用字幕。这条视频可能几乎没有人声。');
		}

		const generated = buildGeneratedTranscript('bilibili', transcribed.cues);
		const expectedDuration = source.expectedDuration || transcribed.duration || duration;
		const coverageSec = cueCoverageSeconds(transcribed.cues);
		if (meta.title && !transcriptMatchesTitleHints(generated.text, meta.title)) {
			throw new Error(
				`识别结果与视频标题不符（${meta.title.slice(0, 40)}）。可能下错了音轨，请刷新 B 站页面后重试。`
			);
		}
		const result = {
			html: generated.html,
			text: generated.text,
			createdAt: Date.now(),
			source: 'funasr' as const,
			coverageSec,
			expectedDurationSec: expectedDuration,
			audioCid: meta.cid,
			bvid: meta.bvid,
			audioFile: audioFileLabel(source.audioUrl),
		};

		if (expectedDuration > 90 && coverageSec < expectedDuration * 0.85) {
			throw new Error(`识别结果不完整：字幕到 ${formatTranscriptTimestamp(coverageSec)}，视频约 ${formatTranscriptTimestamp(expectedDuration)}。请再点一次生成字幕。`);
		}

		await setCachedTranscript(cacheKey, result);
		await broadcast({
			...taskBase,
			status: 'completed',
			stage: '字幕已生成',
			result,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error('Transcript generation failed', { cacheKey, error: message });
		await broadcast({
			...taskBase,
			status: 'failed',
			stage: '生成失败',
			error: message,
		});
	} finally {
		runningTasks.delete(cacheKey);
	}
}

export function installTranscriptListeners(): void {
	if (typeof chrome === 'undefined' || !chrome.runtime?.onConnect) return;
	void enableBilibiliAudioRules();
	chrome.runtime.onConnect.addListener((port) => {
		if (port.name !== 'cn-transcript-keepalive') return;
		port.onDisconnect.addListener(() => undefined);
	});
}

export function handleTranscriptBackgroundMessage(
	request: GenerateRequest,
	sender: Runtime.MessageSender,
	sendResponse: (response?: any) => void
): boolean {
	if (request.action === 'cnGenerateTranscript') {
		const url = request.url || sender.tab?.url || '';
		const tabId = request.tabId || sender.tab?.id;
		const force = Boolean(request.force);
		const cacheKeyHint = request.cacheKey;
		const settingsPromise = getTranscriptSettings();
		settingsPromise.then((settings) => {
			if (!settings.enabled) {
				sendResponse({ success: false, error: '已关闭字幕生成' });
				return;
			}
			sendResponse({ success: true, started: true });
			void keepAliveWhile(runGenerateTask(url, tabId, force, cacheKeyHint)).catch((error) => {
				logger.debug('Transcript task rejected', { error: String(error) });
			});
		}).catch((error) => {
			sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
		});
		return true;
	}

	if (request.action === 'cnGetTranscriptStatus') {
		const cacheKey = request.cacheKey || (request.url ? transcriptCacheKey(request.url) : null);
		const url = request.url || '';
		if (!cacheKey) {
			sendResponse({ success: false, error: 'missing cacheKey' });
			return true;
		}
		Promise.all([
			getCachedTranscript(cacheKey),
			getTranscriptTask(cacheKey),
			url ? resolveBilibiliVideoMeta(url).catch(() => null) : Promise.resolve(null),
		]).then(([cached, task, meta]) => {
			const inProgress = isTranscriptTaskInProgress(task);
			const identity = meta || {
				expectedDuration: cached?.expectedDurationSec,
				cid: cached?.audioCid,
				bvid: cached?.bvid,
			};
			const usable = cacheBelongsToVideo(cached, identity, transcriptMatchesTitleHints);
			// When URL meta is known, require cid/bvid match. When meta fetch fails,
			// still require the cache itself to be tagged (reject legacy wrong-track entries).
			const legacySafe = Boolean(cached?.audioCid && cached?.bvid);
			// While regenerating, never hand Reader/popup a stale completed cache/result.
			const safeCached = inProgress
				? null
				: ((meta ? usable : (usable && legacySafe)) ? cached : null);
			let safeTask = task;
			if (inProgress && task) {
				safeTask = { ...task, result: undefined };
			} else if (
				task?.result?.text
				&& meta?.title
				&& !transcriptMatchesTitleHints(task.result.text, meta.title)
			) {
				safeTask = {
					...task,
					status: 'failed',
					error: '缓存字幕与当前视频标题不符，请重新生成',
					result: undefined,
				};
			}
			sendResponse({
				success: true,
				cacheKey,
				cached: safeCached,
				task: safeTask,
			});
		}).catch((error) => {
			sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
		});
		return true;
	}

	if (request.action === 'cnSnapshotBilibiliAudio') {
		const url = request.url || sender.tab?.url || '';
		const tabId = request.tabId || sender.tab?.id;
		if (!tabId) {
			sendResponse({ success: false, error: 'missing tabId' });
			return true;
		}
		snapshotAudioFromTab(tabId, url).then((source) => {
			sendResponse({ success: Boolean(source?.audioUrl), bvid: source?.bvid, cid: source?.cid });
		}).catch((error) => {
			sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
		});
		return true;
	}

	if (request.action === 'cnResolveBilibiliMeta') {
		resolveBilibiliVideoMeta(request.url || sender.tab?.url || '').then((meta) => {
			sendResponse({ success: Boolean(meta), meta });
		}).catch((error) => {
			sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) });
		});
		return true;
	}

	return false;
}

export const TRANSCRIPT_ASYNC_ACTIONS = [
	'cnGenerateTranscript',
	'cnGetTranscriptStatus',
	'cnSnapshotBilibiliAudio',
	'cnResolveBilibiliMeta',
] as const;
