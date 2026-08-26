import { describe, expect, test } from 'vitest';
import { parseHTML } from 'linkedom';
import { extractWeChatArticleContent, isWeChatArticleUrl } from './wechat';

describe('WeChat overlay', () => {
	test('detects official-account article URLs', () => {
		expect(isWeChatArticleUrl('https://mp.weixin.qq.com/s/abc')).toBe(true);
		expect(isWeChatArticleUrl('https://www.example.com/s/abc')).toBe(false);
	});

	test('extracts #js_content and promotes lazy image sources', () => {
		const { document } = parseHTML(`
			<html>
				<body>
					<div id="js_content">
						<p>正文</p>
						<img src="" data-src="https://mmbiz.qpic.cn/lazy.png" />
					</div>
				</body>
			</html>
		`);

		const html = extractWeChatArticleContent(
			'https://mp.weixin.qq.com/s/test',
			document as unknown as Document
		);

		expect(html).toContain('正文');
		expect(html).toContain('https://mmbiz.qpic.cn/lazy.png');
	});
});
