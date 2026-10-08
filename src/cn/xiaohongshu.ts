import type { Runtime } from 'webextension-polyfill';
import browser from '../utils/browser-polyfill';
import { getXiaohongshuNoteId } from './xiaohongshu-url';

const IMAGE_ORIGIN = 'https://sns-img-qc.xhscdn.com/';
const RUNTIME_NOTE_ACTION = 'getXiaohongshuRuntimeNote';
// Reachability of these CDN nodes varies by network; try them after the note's own hosts.
const FALLBACK_VIDEO_ORIGINS = [
	'https://sns-video-zl.xhscdn.com',
	'https://sns-video-bd.xhscdn.com',
	'https://sns-video-hw.xhscdn.com',
];

interface XhsImage {
	fileId?: string;
	urlDefault?: string;
}

interface XhsStreamItem {
	masterUrl?: string;
	backupUrls?: string[];
}

interface XhsNote {
	noteId?: string;
	type?: string;
	title?: string;
	desc?: string;
	user?: { nickname?: string };
	imageList?: XhsImage[];
	video?: { capa?: { duration?: number }; media?: { stream?: Record<string, XhsStreamItem[] | null> } };
}

interface XhsComment {
	id?: string;
	content?: string;
	userInfo?: { nickname?: string; aiAgent?: boolean };
	targetComment?: { id?: string };
	subComments?: XhsComment[];
}

export interface XiaohongshuNoteContent {
	content: string;
	title?: string;
	author?: string;
}

export { getXiaohongshuNoteId };

function readInitialState(doc: Document): any | null {
	const script = Array.from(doc.querySelectorAll('script')).find(s =>
		(s.textContent || '').includes('window.__INITIAL_STATE__')
	);
	if (!script) {
		return null;
	}
	const json = (script.textContent || '')
		.replace(/^[\s\S]*?window\.__INITIAL_STATE__\s*=\s*/, '')
		.replace(/;?\s*$/, '')
		.replace(/\bundefined\b/g, 'null');
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function stableImageUrl(image: XhsImage): string | null {
	let fileId = image.fileId;
	if (!fileId && image.urlDefault) {
		try {
			// Signed form: /<timestamp>/<signature>/<fileId>!<style>
			const path = new URL(image.urlDefault).pathname.split('/').slice(3).join('/');
			fileId = path.split('!')[0];
		} catch {
			return image.urlDefault;
		}
	}
	return fileId ? IMAGE_ORIGIN + fileId : null;
}

// Unsigned https URLs (signed query strings expire): the note's own hosts first, then fallbacks.
function videoUrlCandidates(note: XhsNote): string[] {
	const streams = note.video?.media?.stream;
	const item = Object.values(streams || {}).find(items => items?.[0]?.masterUrl || items?.[0]?.backupUrls?.length)?.[0];
	if (!item) {
		return [];
	}
	const urls: string[] = [];
	const paths: string[] = [];
	for (const raw of [item.masterUrl, ...(item.backupUrls || [])]) {
		if (!raw) continue;
		try {
			const parsed = new URL(raw);
			urls.push(`https://${parsed.host}${parsed.pathname}`);
			paths.push(parsed.pathname);
		} catch {
			urls.push(raw);
		}
	}
	if (paths[0]) {
		urls.push(...FALLBACK_VIDEO_ORIGINS.map(origin => origin + paths[0]));
	}
	return Array.from(new Set(urls));
}

function stableVideoUrl(note: XhsNote): string | null {
	return videoUrlCandidates(note)[0] || null;
}

function descToHtml(desc: string): string {
	return textToParagraphs(desc.replace(/#([^#\[\]\n]+)\[话题\]#/g, '#$1'));
}

// Feed cards seed noteDetailMap without `desc`; the detail fetch adds it.
function isCompleteNote(note: XhsNote | null | undefined): note is XhsNote {
	return !!note && typeof note.desc === 'string';
}

export function extractXiaohongshuNote(url: string, doc: Document): XiaohongshuNoteContent | null {
	const noteId = getXiaohongshuNoteId(url);
	if (!noteId) {
		return null;
	}
	const entry = readInitialState(doc)?.note?.noteDetailMap?.[noteId];
	return isCompleteNote(entry?.note) ? buildNoteContent(entry.note, entry.comments?.list) : null;
}

export async function extractXiaohongshuNoteAsync(url: string, doc: Document): Promise<XiaohongshuNoteContent | null> {
	const noteId = getXiaohongshuNoteId(url);
	if (!noteId) {
		return null;
	}
	try {
		const response = await browser.runtime.sendMessage({ action: RUNTIME_NOTE_ACTION, noteId }) as
			{ success?: boolean; note?: XhsNote | null; comments?: XhsComment[] } | undefined;
		if (response?.success && isCompleteNote(response.note)) {
			return buildNoteContent(response.note, response.comments);
		}
	} catch {
		// Fall through to the server-rendered state.
	}
	return extractXiaohongshuNote(url, doc);
}

export function handleXiaohongshuBackgroundMessage(
	request: any,
	sender: Runtime.MessageSender,
	sendResponse: (response?: any) => void
): boolean {
	if (request.action !== RUNTIME_NOTE_ACTION) {
		return false;
	}
	const tabId = sender.tab?.id;
	if (!tabId) {
		sendResponse({ success: false, note: null });
		return true;
	}
	readXiaohongshuRuntimeNote(tabId, request.noteId).then(result => {
		sendResponse({ success: true, note: result?.note ?? null, comments: result?.comments ?? [] });
	}).catch(() => {
		sendResponse({ success: false, note: null });
	});
	return true;
}

export async function readXiaohongshuRuntimeNote(
	tabId: number,
	noteId: string
): Promise<{ note: XhsNote; comments: XhsComment[] } | null> {
	if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
		return null;
	}
	const results = await chrome.scripting.executeScript({
		target: { tabId },
		world: 'MAIN',
		args: [noteId],
		// Injected as source into the page: no async/await, because the es6 build
		// rewrites them into an __awaiter helper that does not exist in MAIN world.
		func: (noteId: string) => new Promise(resolve => {
			let attempts = 0;
			const poll = () => {
				const entry = (window as any).__INITIAL_STATE__?.note?.noteDetailMap?.[noteId];
				if (entry?.note && typeof entry.note.desc === 'string') {
					resolve(JSON.parse(JSON.stringify({ note: entry.note, comments: entry.comments?.list || [] })));
				} else if (++attempts >= 30) {
					resolve(null);
				} else {
					setTimeout(poll, 100);
				}
			};
			poll();
		}),
	});
	return (results?.[0]?.result as { note: XhsNote; comments: XhsComment[] } | null) ?? null;
}

export function getXiaohongshuVideoSource(note: XhsNote): { urls: string[]; durationSec: number } | null {
	if (note.type !== 'video') {
		return null;
	}
	const urls = videoUrlCandidates(note);
	return urls.length ? { urls, durationSec: Number(note.video?.capa?.duration) || 0 } : null;
}

export const XIAOHONGSHU_ASYNC_ACTIONS = [RUNTIME_NOTE_ACTION] as const;

function textToParagraphs(text: string): string {
	return text
		.split(/\n+/)
		.filter(line => line.trim())
		.map(line => `<p>${escapeHtml(line)}</p>`)
		.join('');
}

function aiCommentsToHtml(comments: XhsComment[] | undefined): string {
	const items: string[] = [];
	for (const top of comments || []) {
		const thread = [top, ...(top.subComments || [])];
		for (const comment of thread) {
			if (!comment.userInfo?.aiAgent || !comment.content) {
				continue;
			}
			const question = comment === top
				? null
				: thread.find(c => c.id && c.id === comment.targetComment?.id) || top;
			const asked = question?.content
				? `<blockquote><p>${escapeHtml(question.userInfo?.nickname || '')}：${escapeHtml(question.content)}</p></blockquote>`
				: '';
			const name = escapeHtml(comment.userInfo.nickname || 'AI');
			items.push(`${asked}<p><strong>${name}：</strong></p>${textToParagraphs(comment.content)}`);
		}
	}
	return items.length ? `<h2>官方解读（点点）</h2>${items.join('<hr>')}` : '';
}

function buildNoteContent(note: XhsNote, comments?: XhsComment[]): XiaohongshuNoteContent {
	const images = (note.imageList || [])
		.map(stableImageUrl)
		.filter((src): src is string => !!src);
	const parts: string[] = [];

	if (note.type === 'video') {
		const videoUrl = stableVideoUrl(note);
		if (videoUrl) {
			const poster = images[0] ? ` poster="${escapeHtml(images[0])}"` : '';
			parts.push(`<p><video controls src="${escapeHtml(videoUrl)}"${poster}></video></p>`);
		}
	}
	if (note.desc) {
		parts.push(descToHtml(note.desc));
	}
	if (note.type !== 'video') {
		parts.push(...images.map(src => `<p><img src="${escapeHtml(src)}"></p>`));
	}
	parts.push(aiCommentsToHtml(comments));

	return {
		content: `<article>${parts.join('')}</article>`,
		title: note.title || undefined,
		author: note.user?.nickname || undefined,
	};
}
