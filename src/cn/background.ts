import type { Runtime } from 'webextension-polyfill';
import { BILIBILI_ASYNC_ACTIONS, handleBilibiliBackgroundMessage, installBilibiliEmbedListeners } from './bilibili-embed';
import { FEISHU_ASYNC_ACTIONS, handleFeishuBackgroundMessage } from './feishu-background';
import { handleTranscriptBackgroundMessage, installTranscriptListeners, TRANSCRIPT_ASYNC_ACTIONS } from './transcript-background';

export function installCnBackgroundListeners(): void {
	installBilibiliEmbedListeners();
	installTranscriptListeners();
}

export function handleCnBackgroundMessage(
	request: any,
	sender: Runtime.MessageSender,
	sendResponse: (response?: any) => void
): boolean {
	if (handleBilibiliBackgroundMessage(request, sender, sendResponse)) {
		return true;
	}
	if (handleTranscriptBackgroundMessage(request, sender, sendResponse)) {
		return true;
	}
	if (handleFeishuBackgroundMessage(request, sender, sendResponse)) {
		return true;
	}
	return false;
}

export const CN_ASYNC_ACTIONS: readonly string[] = [
	...BILIBILI_ASYNC_ACTIONS,
	...FEISHU_ASYNC_ACTIONS,
	...TRANSCRIPT_ASYNC_ACTIONS,
];
