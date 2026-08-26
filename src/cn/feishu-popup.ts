import { getMessage } from '../utils/i18n';
import { isFeishuDocUrl } from './feishu-extractor';

const FEISHU_IMAGE_WAIT_MS = 1500;
let noteContentImageWaitTimer: number | undefined;

function getNoteContentField(): HTMLTextAreaElement | null {
	return document.getElementById('note-content-field') as HTMLTextAreaElement | null;
}

function clearNoteContentImageWaitTimer(): void {
	if (noteContentImageWaitTimer !== undefined) {
		window.clearTimeout(noteContentImageWaitTimer);
		noteContentImageWaitTimer = undefined;
	}
}

export function handleFeishuImageClippingStarted(request: { imageCount?: number; url?: string }): void {
	const imageCount = Number(request.imageCount || 0);
	const noteContentField = getNoteContentField();
	if (imageCount <= 0 || !noteContentField) return;
	if (request.url && !isFeishuDocUrl(request.url)) return;

	clearNoteContentImageWaitTimer();
	noteContentImageWaitTimer = window.setTimeout(() => {
		noteContentField.placeholder = getMessage('clippingManyImages');
	}, FEISHU_IMAGE_WAIT_MS);
}
