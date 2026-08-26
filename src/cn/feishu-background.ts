import type { Runtime } from 'webextension-polyfill';
import browser from 'webextension-polyfill';
import { createLogger } from './logger';

const logger = createLogger('Feishu');

let feishuTokenCache: { token: string; expiresAt: number } | null = null;

type FeishuMessageRequest = {
	action: string;
	url?: string;
	options?: { method?: string; body?: string; headers?: Record<string, string> };
	apiBase?: string;
	tokenToCode?: Record<string, string>;
	fileToken?: string;
};

function isAllowedFeishuFetchUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		return parsedUrl.protocol === 'https:'
			&& (parsedUrl.hostname === 'open.feishu.cn' || parsedUrl.hostname === 'open.larksuite.com');
	} catch {
		return false;
	}
}

async function getFeishuTenantToken(): Promise<string> {
	if (feishuTokenCache && Date.now() < feishuTokenCache.expiresAt) {
		logger.debug('Using cached tenant token');
		return feishuTokenCache.token;
	}

	const data = await browser.storage.local.get('feishu_settings');
	const settings = data.feishu_settings as { appId?: string; appSecret?: string } | undefined;
	if (!settings?.appId || !settings?.appSecret) {
		const msg = 'Feishu credentials not configured. Go to Obsidian Clipper settings → General → Feishu / Lark to enter your App ID and App Secret.';
		logger.warn(msg);
		throw new Error(msg);
	}

	logger.debug('Fetching new tenant token', { appId: settings.appId });

	const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json; charset=utf-8' },
		body: JSON.stringify({ app_id: settings.appId, app_secret: settings.appSecret }),
	});

	if (!response.ok) {
		logger.error('Feishu token request failed', { status: response.status });
		throw new Error(`Feishu token request failed: HTTP ${response.status}. Check your App ID and App Secret.`);
	}

	const result = await response.json();
	if (result.code !== 0 || !result.tenant_access_token) {
		logger.error('Feishu token API error', { code: result.code, msg: result.msg });
		throw new Error(`Feishu token error: ${result.msg || 'unknown'}(code ${result.code}). Verify your App ID and App Secret are correct.`);
	}

	const expiresIn = (result.expire || 7200) * 1000;
	feishuTokenCache = {
		token: result.tenant_access_token,
		expiresAt: Date.now() + expiresIn - 5 * 60 * 1000,
	};

	logger.info('Tenant token acquired', { expiresInMs: expiresIn });
	return feishuTokenCache.token;
}

async function fetchFeishuApi(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<any> {
	if (!isAllowedFeishuFetchUrl(url)) {
		logger.error('Blocked non-Feishu URL', { url });
		throw new Error('Blocked Feishu fetch URL');
	}

	const token = await getFeishuTenantToken();
	const method = options?.method || 'GET';
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json; charset=utf-8',
		...options?.headers,
	};

	logger.debug('Feishu API request', { method, url });

	const fetchOptions: RequestInit = { method, headers, cache: 'no-store' };
	if (options?.body && method !== 'GET') {
		fetchOptions.body = options.body;
	}

	const response = await fetch(url, fetchOptions);
	if (!response.ok) {
		logger.error('Feishu API HTTP error', { status: response.status, url });
		throw new Error(`Feishu API HTTP ${response.status}: ${url}`);
	}

	const result = await response.json();

	if (result.code && result.code !== 0) {
		logger.error('Feishu API business error', { code: result.code, msg: result.msg, url });
		throw new Error(`Feishu API error ${result.code}: ${result.msg || 'unknown'} (${url})`);
	}

	return result;
}

async function fetchFeishuImageAsBase64(fileToken: string): Promise<{ dataUrl: string }> {
	const url = `https://open.feishu.cn/open-apis/drive/v1/medias/${fileToken}/download`;
	if (!isAllowedFeishuFetchUrl(url)) {
		throw new Error('Blocked Feishu image URL');
	}

	const token = await getFeishuTenantToken();
	const response = await fetch(url, {
		method: 'GET',
		headers: { Authorization: `Bearer ${token}` },
		cache: 'no-store',
	});

	if (!response.ok) {
		throw new Error(`Feishu image fetch failed: HTTP ${response.status}`);
	}

	const mimeType = response.headers.get('Content-Type') || 'image/png';
	const buffer = await response.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	const base64 = btoa(binary);
	return { dataUrl: `data:${mimeType};base64,${base64}` };
}

function replyWithError(sendResponse: (response?: any) => void, error: unknown): void {
	sendResponse({
		success: false,
		error: error instanceof Error ? error.message : String(error)
	});
}

export function handleFeishuBackgroundMessage(
	request: FeishuMessageRequest,
	sender: Runtime.MessageSender,
	sendResponse: (response?: any) => void
): boolean {
	if (request.action === 'fetchFeishuApi' && request.url) {
		fetchFeishuApi(request.url, request.options).then((data) => {
			sendResponse({ success: true, data });
		}).catch((error) => replyWithError(sendResponse, error));
		return true;
	}

	if (request.action === 'getFeishuApiHost') {
		const tabId = sender.tab?.id;
		if (!tabId) {
			sendResponse({ success: false, apiHost: '' });
			return true;
		}
		chrome.scripting.executeScript({
			target: { tabId },
			world: 'MAIN',
			func: () => ((window as any).local?.apiHost as string) || '',
		}).then((results) => {
			const apiHost = (results?.[0]?.result as string) || '';
			sendResponse({ success: true, apiHost });
		}).catch(() => {
			sendResponse({ success: true, apiHost: '' });
		});
		return true;
	}

	if (request.action === 'fetchFeishuImagesViaMainWorld') {
		const tabId = sender.tab?.id;
		if (!tabId) {
			sendResponse({ success: false, error: 'No tab ID' });
			return true;
		}
		const apiBase = request.apiBase;
		const tokenToCode = request.tokenToCode;
		if (!apiBase || !tokenToCode) {
			sendResponse({ success: false, error: 'Missing apiBase or tokenToCode' });
			return true;
		}
		chrome.scripting.executeScript({
			target: { tabId },
			world: 'MAIN',
			func: (apiBase: string, tokenToCode: Record<string, string>) => {
				const results: Record<string, string> = {};
				const tokens = Object.keys(tokenToCode);

				const fetchDataUrl = function(url: string): Promise<string | undefined> {
					return fetch(url).then(function(res: Response) {
						if (!res.ok) return undefined;
						const contentType = res.headers.get('Content-Type') || '';
						if (contentType.indexOf('application/json') !== -1 || contentType.indexOf('text/') !== -1) {
							return undefined;
						}
						const mimeType = contentType.split(';')[0].trim() || 'image/png';
						return res.blob().then(function(blob: Blob) {
							const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
							return new Promise<string | undefined>(function(resolve) {
								const reader = new FileReader();
								reader.onloadend = function() {
									resolve(typeof reader.result === 'string' ? reader.result : undefined);
								};
								reader.onerror = function() {
									resolve(undefined);
								};
								reader.readAsDataURL(typedBlob);
							});
						});
					}).catch(function() {
						return undefined;
					});
				};

				const runtimeImageBlocks: Array<{ token: string; block: any }> = [];
				try {
					const rootBlock = (window as any).PageMain?.blockManager?.rootBlockModel;
					const seen = new Set<any>();
					const walk = function(block: any) {
						if (!block || seen.has(block) || seen.size > 500) return;
						seen.add(block);
						const imageToken = block?.snapshot?.image?.token;
						if (imageToken && block?.imageManager?.fetch) {
							runtimeImageBlocks.push({ token: imageToken, block });
						}
						const children = Array.isArray(block.children) ? block.children : [];
						for (let i = 0; i < children.length; i++) walk(children[i]);
					};
					walk(rootBlock);
				} catch {
					// Fall through to copy_out fallback.
				}

				const runWithConcurrency = function<T>(
					items: T[],
					limit: number,
					worker: (item: T) => Promise<void>
				): Promise<void> {
					let nextIndex = 0;
					const workerCount = Math.min(limit, items.length);
					const runNext = function(): Promise<void> {
						if (nextIndex >= items.length) return Promise.resolve();
						const item = items[nextIndex++];
						return worker(item).then(runNext);
					};
					const workers: Array<Promise<void>> = [];
					for (let i = 0; i < workerCount; i++) {
						workers.push(runNext());
					}
					return Promise.all(workers).then(function() {});
				};

				const fetchRuntimeImage = function(item: { token: string; block: any }): Promise<void> {
					return new Promise<void>(function(resolve) {
						try {
							item.block.imageManager.fetch(
								{ token: item.token, isHD: true, fuzzy: false },
								{},
								function(sources: any) {
									const sourceUrl = sources?.originSrc || sources?.src || '';
									if (!sourceUrl) {
										resolve();
										return;
									}
									fetchDataUrl(sourceUrl).then(function(dataUrl) {
										if (dataUrl) results[item.token] = dataUrl;
										resolve();
									});
								}
							).catch(function() {
								resolve();
							});
						} catch {
							resolve();
						}
					});
				};

				return runWithConcurrency(
					runtimeImageBlocks.filter(function(item) { return tokens.indexOf(item.token) !== -1; }),
					4,
					fetchRuntimeImage
				)
					.then(function() {
						if (Object.keys(results).length > 0) {
							return { success: true as const, results };
						}

						const csrfMatch = /(?:^|;)\s*_csrf_token=([^;]+)/.exec(document.cookie);
						const csrf = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';
						return fetch(apiBase + '/api/docx/resources/copy_out', {
							method: 'POST',
							headers: { 'X-Csrftoken': csrf },
							body: JSON.stringify({ tokens: tokenToCode }),
						})
						.then(function(res: Response) { return res.json(); })
						.then(function(data: any): Promise<{ success: true; results: Record<string, string> }> | { success: true; results: Record<string, string> } {
							if (data.code !== 0) {
								throw new Error('copy_out code=' + data.code);
							}
							return runWithConcurrency(tokens, 4, function(token) {
								const code = tokenToCode[token];
								return fetchDataUrl(
									apiBase + '/api/box/stream/download/asynccode/?code=' + encodeURIComponent(code)
								).then(function(dataUrl) {
									if (dataUrl) results[token] = dataUrl;
								});
							})
							.then(function() {
								return { success: true as const, results };
							});
						})
						.catch(function(err: unknown) {
							return { success: false as const, error: String(err) };
						});
					});
			},
			args: [apiBase, tokenToCode],
		}).then((scriptResults) => {
			const result = scriptResults?.[0]?.result as { success: boolean; error?: string; results?: Record<string, string> } | undefined;
			sendResponse(result ?? { success: false, error: 'No script result' });
		}).catch((err) => {
			sendResponse({ success: false, error: String(err) });
		});
		return true;
	}

	if (request.action === 'fetchFeishuImage') {
		const fileToken = request.fileToken;
		if (!fileToken) {
			sendResponse({ success: false, error: 'Missing fileToken' });
			return true;
		}
		fetchFeishuImageAsBase64(fileToken).then((result) => {
			sendResponse({ success: true, dataUrl: result.dataUrl });
		}).catch((error) => replyWithError(sendResponse, error));
		return true;
	}

	return false;
}

export const FEISHU_ASYNC_ACTIONS = [
	'fetchFeishuApi',
	'fetchFeishuImage',
	'getFeishuApiHost',
	'fetchFeishuImagesViaMainWorld',
] as const;
