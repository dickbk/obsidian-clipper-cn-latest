import { extractFeishuStructuredContent, isFeishuDocUrl } from './feishu-extractor';
import { normalizeImageSources } from './image-normalize';
import { createLogger } from './logger';
import { extractWeChatArticleContent } from './wechat';

const logger = createLogger('Overlay');

export interface OverlayClipFields {
	content?: string;
	title?: string;
	author?: string;
	site?: string;
	wordCount?: number;
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
	return parsed;
}

export async function overlayParsedContentAsync<T extends OverlayClipFields>(
	url: string,
	pageDoc: Document,
	parsed: T
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

	return overlayParsedContent(url, pageDoc, parsed);
}
