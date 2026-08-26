import Defuddle from 'defuddle/full';
import { overlayParsedContent, prepareDocumentForClip } from '../cn/overlay';
import { setElementHTML } from './dom-utils';

// Parse document content for clipping. In reader mode, extracts from
// the article's original HTML to avoid reader UI artifacts.
export function parseForClip(doc: Document) {
	const readerArticle = doc.querySelector('.obsidian-reader-active .obsidian-reader-content article');
	if (readerArticle) {
		const readerDoc = doc.implementation.createHTMLDocument();
		const originalHtml = readerArticle.getAttribute('data-original-html');
		if (originalHtml) {
			setElementHTML(readerDoc.body, originalHtml);
		} else {
			readerDoc.body.replaceChildren(
				...Array.from(readerArticle.childNodes).map(n => readerDoc.importNode(n, true))
			);
		}
		prepareDocumentForClip(readerDoc);
		const parsed = new Defuddle(readerDoc, { url: '' }).parse();
		return overlayParsedContent(doc.URL, readerDoc, parsed);
	}
	prepareDocumentForClip(doc);
	const parsed = new Defuddle(doc, { url: doc.URL }).parse();
	return overlayParsedContent(doc.URL, doc, parsed);
}
