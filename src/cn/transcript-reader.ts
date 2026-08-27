import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import { wireTranscript } from '../utils/reader-transcript';
import {
	TRANSCRIPT_FALLBACK_CLASS,
	TRANSCRIPT_GENERATE_BTN_CLASS,
} from './transcript-html';
import { getTranscriptSettings } from './transcript-cache';
import { FUNASR_MISSING_KEY_ERROR } from './funasr';
import { connectTranscriptKeepAlive, disconnectTranscriptKeepAlive } from './transcript-keepalive';

interface ScrollHelper {
	getStickyOffset: () => number;
	scrollTo: (targetY: number) => void;
	programmaticScroll: () => boolean;
}

interface TranscriptSettings {
	pinPlayer: boolean;
	autoScroll: boolean;
	highlightActiveLine: boolean;
}

interface TranscriptProgressMessage {
	action: string;
	cacheKey?: string;
	status?: string;
	stage?: string;
	error?: string;
	result?: { html: string; text: string };
}

let activeFallback: {
	doc: Document;
	article: HTMLElement;
	cacheKey: string;
	applyGenerated: (html: string) => void;
} | null = null;
let listenerInstalled = false;

function setFallbackCopy(root: HTMLElement): void {
	const copy = root.querySelector('.cn-transcript-fallback-copy') as HTMLElement | null;
	const note = root.querySelector('.cn-transcript-fallback-note') as HTMLElement | null;
	const button = root.querySelector(`.${TRANSCRIPT_GENERATE_BTN_CLASS}`) as HTMLButtonElement | null;
	if (copy) copy.textContent = getMessage('transcriptReaderCopy');
	if (note) note.textContent = getMessage('transcriptReaderNote');
	if (button) button.textContent = getMessage('transcriptGenerate');
}

function setFallbackStatus(root: HTMLElement, text: string, isError = false): void {
	const status = root.querySelector('.cn-transcript-fallback-status') as HTMLElement | null;
	const button = root.querySelector(`.${TRANSCRIPT_GENERATE_BTN_CLASS}`) as HTMLButtonElement | null;
	if (status) {
		status.hidden = !text;
		status.textContent = text;
		status.classList.toggle('is-error', isError);
	}
	if (button) {
		button.disabled = Boolean(text) && !isError;
		if (!isError && text) {
			button.textContent = getMessage('transcriptGenerating');
		} else {
			button.textContent = getMessage('transcriptGenerate');
		}
	}
}

function applyGeneratedHtml(
	doc: Document,
	article: HTMLElement,
	html: string,
	afterApply: () => void
): void {
	const fallback = article.querySelector(`.${TRANSCRIPT_FALLBACK_CLASS}`) as HTMLElement | null;
	const parsed = new DOMParser().parseFromString(html, 'text/html');
	const nodes = Array.from(parsed.body.childNodes).map((node) => doc.importNode(node, true));
	if (fallback) {
		fallback.replaceWith(...nodes);
	} else {
		article.querySelector('.cn-transcript-regen')?.remove();
		const old = article.querySelector('.bilibili.transcript, .youtube.transcript');
		if (old) old.replaceWith(...nodes);
		else article.append(...nodes);
	}
	afterApply();
}

function ensureRegenerateControl(
	doc: Document,
	article: HTMLElement,
	pageUrl: string,
	cacheKey: string,
	onApplied: () => void
): void {
	article.querySelector('.cn-transcript-regen')?.remove();
	const bar = doc.createElement('aside');
	bar.className = 'cn-transcript-regen';
	bar.setAttribute('data-cn-transcript-key', cacheKey);
	bar.setAttribute('data-cn-transcript-url', pageUrl);
	const button = doc.createElement('button');
	button.type = 'button';
	button.className = TRANSCRIPT_GENERATE_BTN_CLASS;
	button.textContent = getMessage('transcriptGenerate');
	const status = doc.createElement('p');
	status.className = 'cn-transcript-fallback-status';
	status.hidden = true;
	button.addEventListener('click', () => {
		status.hidden = false;
		status.textContent = getMessage('transcriptStageQueued');
		status.classList.remove('is-error');
		button.disabled = true;
		button.textContent = getMessage('transcriptGenerating');
		connectTranscriptKeepAlive();
		void browser.runtime.sendMessage({
			action: 'cnGenerateTranscript',
			url: pageUrl,
			cacheKey,
			force: true,
		});
	});
	bar.append(button, status);
	article.appendChild(bar);

	activeFallback = {
		doc,
		article,
		cacheKey,
		applyGenerated: (html: string) => {
			applyGeneratedHtml(doc, article, html, () => {
				onApplied();
				ensureRegenerateControl(doc, article, pageUrl, cacheKey, onApplied);
			});
		},
	};
}

export function wireTranscriptFallback(
	doc: Document,
	article: HTMLElement,
	options: {
		settings: TranscriptSettings;
		scroll: ScrollHelper;
		onSettingChange?: (key: keyof TranscriptSettings, value: boolean) => void;
		storeOriginalHtml: (article: HTMLElement) => void;
	}
): void {
	const fallback = article.querySelector(`.${TRANSCRIPT_FALLBACK_CLASS}`) as HTMLElement | null;
	if (!fallback) {
		activeFallback = null;
		return;
	}

	const cacheKey = fallback.getAttribute('data-cn-transcript-key') || '';
	const pageUrl = fallback.getAttribute('data-cn-transcript-url') || doc.URL;
	setFallbackCopy(fallback);

	const applyGenerated = (html: string) => {
		applyGeneratedHtml(doc, article, html, () => {
			options.storeOriginalHtml(article);
			wireTranscript(doc, article, options.settings, options.scroll, options.onSettingChange);
			ensureRegenerateControl(doc, article, pageUrl, cacheKey, () => {
				options.storeOriginalHtml(article);
				wireTranscript(doc, article, options.settings, options.scroll, options.onSettingChange);
			});
		});
	};

	activeFallback = { doc, article, cacheKey, applyGenerated };

	const button = fallback.querySelector(`.${TRANSCRIPT_GENERATE_BTN_CLASS}`) as HTMLButtonElement | null;
	button?.addEventListener('click', () => {
		setFallbackStatus(fallback, getMessage('transcriptStageQueued'));
		connectTranscriptKeepAlive();
		void browser.runtime.sendMessage({
			action: 'cnGenerateTranscript',
			url: pageUrl,
			cacheKey,
			force: true,
		});
	});

	if (!listenerInstalled) {
		listenerInstalled = true;
		browser.runtime.onMessage.addListener((message: unknown): undefined => {
			const request = message as TranscriptProgressMessage;
			if (request.action !== 'cnTranscriptProgress') return undefined;
			if (!activeFallback || request.cacheKey !== activeFallback.cacheKey) return undefined;
			const root = (
				activeFallback.article.querySelector(`.${TRANSCRIPT_FALLBACK_CLASS}`)
				|| activeFallback.article.querySelector('.cn-transcript-regen')
			) as HTMLElement | null;

			if (request.status === 'completed' && request.result?.html) {
				disconnectTranscriptKeepAlive();
				activeFallback.applyGenerated(request.result.html);
				return undefined;
			}
			if (request.status === 'failed') {
				disconnectTranscriptKeepAlive();
				if (root) setFallbackStatus(root, request.error || getMessage('transcriptGenerateFailed'), true);
				return undefined;
			}
			if (request.stage && root) {
				setFallbackStatus(root, request.stage);
			}
			return undefined;
		});
	}

	void (async () => {
		const settings = await getTranscriptSettings();
		const status = await browser.runtime.sendMessage({
			action: 'cnGetTranscriptStatus',
			cacheKey,
			url: pageUrl,
		}) as {
			cached?: { html: string };
			task?: { status?: string; stage?: string; error?: string; result?: { html: string } };
		};

		const taskStatus = status?.task?.status;
		const inProgress = taskStatus === 'queued'
			|| taskStatus === 'downloading'
			|| taskStatus === 'transcribing';

		// In-progress regenerate always wins over any stale completed cache/task.
		if (inProgress) {
			setFallbackStatus(fallback, status?.task?.stage || getMessage('transcriptGenerating'));
			connectTranscriptKeepAlive();
			return;
		}
		if (status?.cached?.html) {
			applyGenerated(status.cached.html);
			return;
		}
		if (status?.task?.result?.html && status.task.status === 'completed') {
			applyGenerated(status.task.result.html);
			return;
		}
		if (status?.task?.status === 'failed') {
			setFallbackStatus(fallback, status.task.error || getMessage('transcriptGenerateFailed'), true);
			return;
		}
		if (!settings.dashscopeApiKey?.trim()) {
			setFallbackStatus(fallback, FUNASR_MISSING_KEY_ERROR, true);
			return;
		}
		if (settings.enabled) {
			setFallbackStatus(fallback, getMessage('transcriptStageQueued'));
			connectTranscriptKeepAlive();
			void browser.runtime.sendMessage({
				action: 'cnGenerateTranscript',
				url: pageUrl,
				cacheKey,
				// Join/create the same fresh run as popup; never revive a stale completed task.
				force: true,
			});
		}
	})();
}
