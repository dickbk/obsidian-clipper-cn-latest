import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import {
	isBilibiliVideoUrl,
	isMostlyMusicTranscript,
	isUsablePlatformTranscript,
	transcriptCacheKey,
	transcriptMatchesTitleHints,
} from './transcript-html';
import { getTranscriptSettings } from './transcript-cache';
import { resolveBilibiliVideoMeta } from './bilibili-video-meta';
import { FUNASR_MISSING_KEY_ERROR } from './funasr';
import { connectTranscriptKeepAlive, disconnectTranscriptKeepAlive } from './transcript-keepalive';

interface TranscriptProgressMessage {
	action: string;
	cacheKey?: string;
	status?: string;
	stage?: string;
	error?: string;
	result?: { html: string; text: string };
}

let applyTranscript: ((text: string) => Promise<void> | void) | null = null;
let getTabId: (() => number | undefined) | null = null;
let currentUrl = '';
let currentCacheKey: string | null = null;
let listenerInstalled = false;
let syncInFlight = false;
let autoStartedForKey: string | null = null;
let clearedStaleForKey: string | null = null;

function panel(): HTMLElement | null {
	return document.getElementById('cn-transcript-generator');
}

function copyEl(): HTMLElement | null {
	return document.getElementById('cn-transcript-generator-copy');
}

function statusEl(): HTMLElement | null {
	return document.getElementById('cn-transcript-generator-status');
}

function buttonEl(): HTMLButtonElement | null {
	return document.getElementById('cn-transcript-generate-btn') as HTMLButtonElement | null;
}

function setStatus(text: string, isError = false): void {
	const el = statusEl();
	if (!el) return;
	el.hidden = !text;
	el.textContent = text;
	el.classList.toggle('is-error', isError);
}

function setBusy(busy: boolean): void {
	const button = buttonEl();
	if (!button) return;
	button.disabled = busy;
	button.textContent = busy
		? getMessage('transcriptGenerating')
		: getMessage('transcriptGenerate');
}

function showGeneratorPanel(): void {
	const panelEl = panel();
	if (panelEl) panelEl.style.display = '';
}

async function clearStaleTranscript(): Promise<void> {
	await applyTranscript?.('');
}

async function startGenerate(force = true): Promise<void> {
	if (!currentUrl || !currentCacheKey) return;
	showGeneratorPanel();
	setBusy(true);
	setStatus(getMessage('transcriptStageQueued'));
	connectTranscriptKeepAlive();
	const response = await browser.runtime.sendMessage({
		action: 'cnGenerateTranscript',
		url: currentUrl,
		tabId: getTabId?.(),
		cacheKey: currentCacheKey,
		force,
	}) as { success?: boolean; error?: string };
	if (!response?.success) {
		disconnectTranscriptKeepAlive();
		setBusy(false);
		setStatus(response?.error || getMessage('transcriptGenerateFailed'), true);
	}
}

function handleProgress(request: TranscriptProgressMessage): void {
	if (request.action !== 'cnTranscriptProgress') return;
	if (!currentCacheKey || request.cacheKey !== currentCacheKey) return;

	if (request.status === 'completed' && request.result?.text) {
		disconnectTranscriptKeepAlive();
		clearedStaleForKey = null;
		setBusy(false);
		setStatus(getMessage('transcriptGenerated'));
		const panelEl = panel();
		if (panelEl) panelEl.style.display = 'none';
		void applyTranscript?.(request.result.text);
		return;
	}

	if (request.status === 'failed') {
		disconnectTranscriptKeepAlive();
		showGeneratorPanel();
		setBusy(false);
		autoStartedForKey = null;
		clearedStaleForKey = null;
		setStatus(request.error || getMessage('transcriptGenerateFailed'), true);
		return;
	}

	// Reader (or another surface) started a regenerate — drop the stale note transcript
	// once, then follow the same progress instead of leaving the wrong {{transcript}} visible.
	showGeneratorPanel();
	setBusy(true);
	if (request.stage) setStatus(request.stage);
	if (clearedStaleForKey !== request.cacheKey) {
		clearedStaleForKey = request.cacheKey || null;
		void clearStaleTranscript();
	}
}

/**
 * Only trust platform CC after duration-aware checks.
 * Stale ASR text left in {{transcript}} (no matching cache) must not hide the panel
 * or block Reader/popup from converging on the same FunASR result.
 */
async function hasUsablePopupTranscript(
	url: string,
	variables: { [key: string]: string }
): Promise<boolean> {
	const text = variables['{{transcript}}']?.trim() || '';
	if (!text) return false;
	if (isMostlyMusicTranscript(text)) return false;
	const meta = await resolveBilibiliVideoMeta(url).catch(() => null);
	if (!isUsablePlatformTranscript(
		{ variables: { transcript: text } },
		meta?.expectedDuration
	)) {
		return false;
	}
	if (meta?.title && !transcriptMatchesTitleHints(text, meta.title)) {
		return false;
	}
	return true;
}

async function cachedTextMatchesVideo(url: string, text: string): Promise<boolean> {
	const meta = await resolveBilibiliVideoMeta(url).catch(() => null);
	if (!meta?.title) return true;
	return transcriptMatchesTitleHints(text, meta.title);
}

export function initializeTranscriptGeneratorControls(options: {
	getTabId: () => number | undefined;
	applyTranscript: (text: string) => Promise<void> | void;
}): void {
	getTabId = options.getTabId;
	applyTranscript = options.applyTranscript;

	const copy = copyEl();
	const button = buttonEl();
	if (copy) copy.textContent = getMessage('transcriptGeneratorCopy');
	if (button) {
		button.textContent = getMessage('transcriptGenerate');
		button.addEventListener('click', () => {
			void startGenerate(true);
		});
	}

	if (!listenerInstalled) {
		listenerInstalled = true;
		browser.runtime.onMessage.addListener((message: unknown): undefined => {
			handleProgress(message as TranscriptProgressMessage);
			return undefined;
		});
	}
}

export async function syncTranscriptGeneratorPanel(
	url: string,
	variables: { [key: string]: string }
): Promise<void> {
	if (syncInFlight) return;
	syncInFlight = true;
	try {
		const panelEl = panel();
		if (!panelEl) return;

		currentUrl = url;
		currentCacheKey = transcriptCacheKey(url);
		const settings = await getTranscriptSettings();
		if (!settings.enabled || !isBilibiliVideoUrl(url) || !currentCacheKey) {
			panelEl.style.display = 'none';
			return;
		}

		panelEl.style.display = '';
		const copy = copyEl();
		if (copy) copy.textContent = getMessage('transcriptGeneratorCopy');

		const status = await browser.runtime.sendMessage({
			action: 'cnGetTranscriptStatus',
			cacheKey: currentCacheKey,
			url,
		}) as {
			success?: boolean;
			cached?: { text: string };
			task?: { status?: string; stage?: string; error?: string; result?: { text: string } };
		};

		const taskStatus = status?.task?.status;
		const inProgress = taskStatus === 'queued'
			|| taskStatus === 'downloading'
			|| taskStatus === 'transcribing';

		// In-progress regenerate wins over any stale completed cache/task.
		if (inProgress) {
			setBusy(true);
			setStatus(status?.task?.stage || getMessage('transcriptGenerating'));
			connectTranscriptKeepAlive();
			if (clearedStaleForKey !== currentCacheKey) {
				clearedStaleForKey = currentCacheKey;
				await clearStaleTranscript();
			}
			return;
		}

		// Identity-matched cache is the single source of truth for popup + Reader.
		if (status?.cached?.text && await cachedTextMatchesVideo(url, status.cached.text)) {
			panelEl.style.display = 'none';
			await applyTranscript?.(status.cached.text);
			return;
		}

		if (
			status?.task?.status === 'completed'
			&& status.task.result?.text
			&& await cachedTextMatchesVideo(url, status.task.result.text)
		) {
			panelEl.style.display = 'none';
			await applyTranscript?.(status.task.result.text);
			return;
		}

		const hasPlatform = await hasUsablePopupTranscript(url, variables);
		if (hasPlatform) {
			panelEl.style.display = 'none';
			return;
		}

		// Stale ASR leftovers in {{transcript}} must not show in the note.
		if (variables['{{transcript}}']?.trim()) {
			variables['{{transcript}}'] = '';
			await applyTranscript?.('');
		}

		if (status?.task?.status === 'failed') {
			setBusy(false);
			setStatus(status.task.error || getMessage('transcriptGenerateFailed'), true);
			return;
		}

		if (!settings.dashscopeApiKey?.trim()) {
			setBusy(false);
			setStatus(FUNASR_MISSING_KEY_ERROR, true);
			return;
		}

		// Auto-start once per cache key so reopen/sync does not stack tasks.
		if (autoStartedForKey === currentCacheKey) {
			setBusy(false);
			setStatus('');
			return;
		}
		autoStartedForKey = currentCacheKey;
		setBusy(true);
		setStatus(getMessage('transcriptStageQueued'));
		// force=true clears identity-tagged-but-wrong ASR caches from earlier builds.
		void startGenerate(true);
	} finally {
		syncInFlight = false;
	}
}
