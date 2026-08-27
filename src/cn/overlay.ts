import { extractFeishuStructuredContent, isFeishuDocUrl } from './feishu-extractor';
import { normalizeImageSources } from './image-normalize';
import { createLogger } from './logger';
import { rewriteBilibiliEmbedInParsedContent } from './bilibili-video-meta';
import { overlayBilibiliTranscript } from './transcript-overlay';
import { stripTranscriptFallback } from './transcript-html';
import { extractWeChatArticleContent } from './wechat';

const logger = createLogger('Overlay');

export interface OverlayClipFields {
	content?: string;
	title?: string;
	author?: string;
	site?: string;
	wordCount?: number;
	variables?: { [key: string]: string };
}

export function prepareDocumentForClip(doc: Pick<Document, 'querySelectorAll'>): void {
	normalizeImageSources(doc);
}

export function overlayParsedContent<T extends OverlayClipFields>(
	url: string,
	htmlDoc: Document,
	parsed: T
): T {
	const wechatContent = extractWeChatArticleContent(url, htmlDoc);
	if (wechatContent) {
		parsed.content = wechatContent;
	}
	if (parsed.content) {
		parsed.content = stripTranscriptFallback(parsed.content);
	}
	return parsed;
}

export async function overlayParsedContentAsync<T extends OverlayClipFields>(
	url: string,
	pageDoc: Document,
	parsed: T,
	options?: { forReader?: boolean }
): Promise<T> {
	if (isFeishuDocUrl(url)) {
		try {
			const feishu = await extractFeishuStructuredContent(pageDoc, url);
			if (feishu) {
				parsed.content = feishu.content;
				parsed.title = feishu.title || parsed.title;
				parsed.author = feishu.author || parsed.author;
				parsed.site = 'Feishu';
				parsed.wordCount = feishu.wordCount;
			}
		} catch (error) {
			logger.warn('Feishu overlay failed', { error: String(error) });
		}
	}

	overlayParsedContent(url, pageDoc, parsed);
	await rewriteBilibiliEmbedInParsedContent(url, parsed);
	await overlayBilibiliTranscript(url, parsed, { forReader: options?.forReader });
	return parsed;
}
