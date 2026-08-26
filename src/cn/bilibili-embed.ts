import type { Runtime } from 'webextension-polyfill';
import browser from 'webextension-polyfill';

// Official 1.7.1 already uses 9001 (YouTube embed) and 9002 (YouTube innertube).
const BILIBILI_EMBED_RULE_ID = 9003;

async function enableBilibiliEmbedRule(tabId: number): Promise<void> {
	await chrome.declarativeNetRequest.updateSessionRules({
		removeRuleIds: [BILIBILI_EMBED_RULE_ID],
		addRules: [{
			id: BILIBILI_EMBED_RULE_ID,
			priority: 1,
			action: {
				type: 'modifyHeaders' as any,
				requestHeaders: [{
					header: 'Referer',
					operation: 'set' as any,
					value: 'https://www.bilibili.com/'
				}]
			},
			condition: {
				urlFilter: '||player.bilibili.com/',
				resourceTypes: ['sub_frame' as any],
				tabIds: [tabId]
			}
		}]
	});
}

async function disableBilibiliEmbedRule(): Promise<void> {
	await chrome.declarativeNetRequest.updateSessionRules({
		removeRuleIds: [BILIBILI_EMBED_RULE_ID]
	});
}

export function installBilibiliEmbedListeners(): void {
	if (typeof browser === 'undefined' || !browser.webRequest?.onBeforeSendHeaders) {
		return;
	}

	try {
		browser.webRequest.onBeforeSendHeaders.addListener(
			(details) => {
				const headers = (details.requestHeaders || []).filter(
					h => h.name.toLowerCase() !== 'referer'
				);
				headers.push({ name: 'Referer', value: 'https://www.bilibili.com/' });
				return { requestHeaders: headers };
			},
			{
				urls: ['*://player.bilibili.com/*'],
				types: ['sub_frame' as browser.WebRequest.ResourceType]
			},
			['blocking', 'requestHeaders']
		);
	} catch {
		// webRequest not available (Chrome MV3 uses declarativeNetRequest instead)
	}
}

export function handleBilibiliBackgroundMessage(
	request: { action: string },
	sender: Runtime.MessageSender,
	sendResponse: (response?: any) => void
): boolean {
	if (request.action === 'enableBilibiliEmbedRule') {
		const tabId = sender.tab?.id;
		if (tabId) {
			enableBilibiliEmbedRule(tabId).then(() => {
				sendResponse({ success: true });
			}).catch(() => {
				sendResponse({ success: true });
			});
		} else {
			sendResponse({ success: true });
		}
		return true;
	}

	if (request.action === 'disableBilibiliEmbedRule') {
		disableBilibiliEmbedRule().then(() => {
			sendResponse({ success: true });
		}).catch(() => {
			sendResponse({ success: true });
		});
		return true;
	}

	return false;
}

export const BILIBILI_ASYNC_ACTIONS = [
	'enableBilibiliEmbedRule',
	'disableBilibiliEmbedRule',
] as const;

export function isBilibiliHost(host: string): boolean {
	return host.includes('bilibili.com');
}

export async function enableBilibiliReaderEmbed(): Promise<void> {
	await browser.runtime.sendMessage({ action: 'enableBilibiliEmbedRule' }).catch(() => {});
}

export async function disableBilibiliReaderEmbed(): Promise<void> {
	await browser.runtime.sendMessage({ action: 'disableBilibiliEmbedRule' }).catch(() => {});
}
