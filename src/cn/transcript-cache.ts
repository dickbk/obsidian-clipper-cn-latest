import browser from '../utils/browser-polyfill';

export const TRANSCRIPT_SETTINGS_KEY = 'cn_transcript_settings';
export const TRANSCRIPT_CACHE_KEY = 'cn_transcript_cache';
export const TRANSCRIPT_TASKS_KEY = 'cn_transcript_tasks';

export const BCUT_QUOTA_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export interface TranscriptSettings {
	enabled: boolean;
	/** Qwen AI Platform / DashScope API Key for Fun-ASR. */
	dashscopeApiKey?: string;
	quotaExhaustedAt?: number;
}

export interface CachedTranscript {
	html: string;
	text: string;
	createdAt: number;
	source: 'funasr' | 'bcut';
	coverageSec?: number;
	expectedDurationSec?: number;
	/** DASH cid used when this ASR result was produced; reject on mismatch. */
	audioCid?: number;
	bvid?: string;
	audioFile?: string;
}

export interface TranscriptTask {
	cacheKey: string;
	url: string;
	tabId?: number;
	status: 'queued' | 'downloading' | 'transcribing' | 'completed' | 'failed';
	stage: string;
	error?: string;
	result?: CachedTranscript;
}

const MAX_CACHE_ENTRIES = 40;

export async function getTranscriptSettings(): Promise<TranscriptSettings> {
	const data = await browser.storage.local.get(TRANSCRIPT_SETTINGS_KEY);
	const stored = data[TRANSCRIPT_SETTINGS_KEY] as Partial<TranscriptSettings> | undefined;
	return {
		enabled: stored?.enabled !== false,
		dashscopeApiKey: String(stored?.dashscopeApiKey || '').trim() || undefined,
		quotaExhaustedAt: Number(stored?.quotaExhaustedAt) || undefined,
	};
}

export function isBcutQuotaCooling(settings: TranscriptSettings, now = Date.now()): boolean {
	const exhaustedAt = Number(settings.quotaExhaustedAt) || 0;
	return exhaustedAt > 0 && now - exhaustedAt < BCUT_QUOTA_COOLDOWN_MS;
}

export async function setTranscriptSettings(settings: TranscriptSettings): Promise<void> {
	await browser.storage.local.set({ [TRANSCRIPT_SETTINGS_KEY]: settings });
}

export async function markBcutQuotaExhausted(): Promise<void> {
	const settings = await getTranscriptSettings();
	await setTranscriptSettings({ ...settings, quotaExhaustedAt: Date.now() });
}

export async function clearBcutQuotaExhausted(): Promise<void> {
	const settings = await getTranscriptSettings();
	if (!settings.quotaExhaustedAt) return;
	await setTranscriptSettings({ ...settings, quotaExhaustedAt: undefined });
}

export async function getCachedTranscript(cacheKey: string): Promise<CachedTranscript | null> {
	const data = await browser.storage.local.get(TRANSCRIPT_CACHE_KEY);
	const cache = (data[TRANSCRIPT_CACHE_KEY] || {}) as Record<string, CachedTranscript>;
	return cache[cacheKey] || null;
}

export {
	cacheBelongsToVideo,
	isCachedTranscriptComplete,
	type TranscriptVideoIdentity,
} from './transcript-cache-logic';

export async function clearCachedTranscript(cacheKey: string): Promise<void> {
	const data = await browser.storage.local.get(TRANSCRIPT_CACHE_KEY);
	const cache = { ...((data[TRANSCRIPT_CACHE_KEY] || {}) as Record<string, CachedTranscript>) };
	delete cache[cacheKey];
	await browser.storage.local.set({ [TRANSCRIPT_CACHE_KEY]: cache });
}

export async function clearTranscriptTask(cacheKey: string): Promise<void> {
	const data = await browser.storage.local.get(TRANSCRIPT_TASKS_KEY);
	const tasks = { ...((data[TRANSCRIPT_TASKS_KEY] || {}) as Record<string, TranscriptTask>) };
	delete tasks[cacheKey];
	await browser.storage.local.set({ [TRANSCRIPT_TASKS_KEY]: tasks });
}

export function isTranscriptTaskInProgress(task: TranscriptTask | null | undefined): boolean {
	return Boolean(
		task &&
		(task.status === 'queued' || task.status === 'downloading' || task.status === 'transcribing')
	);
}

export async function setCachedTranscript(cacheKey: string, value: CachedTranscript): Promise<void> {
	const data = await browser.storage.local.get(TRANSCRIPT_CACHE_KEY);
	const cache = { ...((data[TRANSCRIPT_CACHE_KEY] || {}) as Record<string, CachedTranscript>) };
	cache[cacheKey] = value;
	const entries = Object.entries(cache).sort((a, b) => b[1].createdAt - a[1].createdAt);
	const trimmed = Object.fromEntries(entries.slice(0, MAX_CACHE_ENTRIES));
	await browser.storage.local.set({ [TRANSCRIPT_CACHE_KEY]: trimmed });
}

export async function getTranscriptTask(cacheKey: string): Promise<TranscriptTask | null> {
	const data = await browser.storage.local.get(TRANSCRIPT_TASKS_KEY);
	const tasks = (data[TRANSCRIPT_TASKS_KEY] || {}) as Record<string, TranscriptTask>;
	return tasks[cacheKey] || null;
}

export async function setTranscriptTask(task: TranscriptTask): Promise<void> {
	const data = await browser.storage.local.get(TRANSCRIPT_TASKS_KEY);
	const tasks = { ...((data[TRANSCRIPT_TASKS_KEY] || {}) as Record<string, TranscriptTask>) };
	tasks[task.cacheKey] = task;
	await browser.storage.local.set({ [TRANSCRIPT_TASKS_KEY]: tasks });
}
