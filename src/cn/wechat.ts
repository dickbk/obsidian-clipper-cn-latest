import { normalizeImageSources } from './image-normalize';

export function isWeChatArticleUrl(url: string): boolean {
	try {
		return new URL(url).hostname === 'mp.weixin.qq.com';
	} catch {
		return false;
	}
}

export function extractWeChatArticleContent(url: string, doc: Document): string | null {
	if (!isWeChatArticleUrl(url)) {
		return null;
	}

	const article = doc.querySelector('#js_content');
	if (!article) {
		return null;
	}

	const articleClone = article.cloneNode(true) as HTMLElement;
	normalizeImageSources(articleClone as unknown as Document);
	articleClone.querySelectorAll('script, style').forEach(el => el.remove());
	return articleClone.outerHTML;
}
