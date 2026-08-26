const LAZY_IMAGE_SOURCE_ATTRIBUTES = [
	'data-src',
	'data-original',
	'data-lazy-src',
	'data-actualsrc',
	'data-url',
];

const LAZY_IMAGE_SRCSET_ATTRIBUTES = [
	'data-srcset',
	'data-lazy-srcset',
];

function isPlaceholderImageSource(value: string | null): boolean {
	if (!value?.trim()) {
		return true;
	}

	const trimmed = value.trim();
	return trimmed.startsWith('data:image/')
		|| trimmed === 'about:blank'
		|| /(^|\/)(transparent|blank|placeholder|spacer)\.(gif|png|jpe?g|webp)([?#].*)?$/i.test(trimmed);
}

export function normalizeImageSources(doc: Pick<Document, 'querySelectorAll'>): void {
	doc.querySelectorAll('img').forEach(img => {
		if (isPlaceholderImageSource(img.getAttribute('src'))) {
			const lazySrc = LAZY_IMAGE_SOURCE_ATTRIBUTES
				.map(attr => img.getAttribute(attr)?.trim())
				.find(Boolean);

			if (lazySrc) {
				img.setAttribute('src', lazySrc);
			}
		}

		if (!img.getAttribute('srcset')) {
			const lazySrcset = LAZY_IMAGE_SRCSET_ATTRIBUTES
				.map(attr => img.getAttribute(attr)?.trim())
				.find(Boolean);

			if (lazySrcset) {
				img.setAttribute('srcset', lazySrcset);
			}
		}
	});
}
