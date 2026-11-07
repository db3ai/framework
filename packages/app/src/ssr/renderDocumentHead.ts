import type { DocumentHead, DocumentHeadAttributes } from './contracts';

const HEAD_ATTRIBUTES = {
	meta: new Set(['charset', 'content', 'itemprop', 'name', 'property']),
	link: new Set(['as', 'crossorigin', 'fetchpriority', 'href', 'hreflang', 'integrity', 'media', 'referrerpolicy', 'rel', 'sizes', 'title', 'type']),
	script: new Set(['async', 'crossorigin', 'defer', 'fetchpriority', 'integrity', 'nonce', 'nomodule', 'referrerpolicy', 'src', 'type']),
} as const;

/**
 * Renders collected head metadata into HTML tags.
 *
 * @param head - Request-owned document metadata.
 * @returns Escaped HTML ready for the document head marker.
 */
export function renderDocumentHead(head: DocumentHead): string {
	const tags: string[] = [];

	if (head.title) {
		tags.push(`<title>${escapeHtml(head.title)}</title>`);
	}

	for (const attributes of head.meta) {
		tags.push(`<meta${renderAttributes(attributes, 'meta')}>`);
	}

	for (const attributes of head.link) {
		tags.push(`<link${renderAttributes(attributes, 'link')}>`);
	}

	for (const script of head.script) {
		tags.push(`<script${renderAttributes(script.attributes, 'script')}>${escapeScriptContent(script.content ?? '')}</script>`);
	}

	return tags.join('\n');
}

/**
 * Renders defined tag attributes with HTML-safe values.
 *
 * @param attributes - Attribute names and values for one head element.
 * @param tag - Element whose allowed attributes govern rendering.
 * @returns Leading-space-prefixed HTML attributes.
 */
function renderAttributes(attributes: DocumentHeadAttributes = {}, tag: keyof typeof HEAD_ATTRIBUTES): string {
	return Object.entries(attributes)
		.filter(([name]) => HEAD_ATTRIBUTES[tag].has(name.toLowerCase()))
		.filter(([, value]) => value !== undefined && value !== null && value !== false)
		.filter(([name, value]) => !['href', 'src'].includes(name.toLowerCase()) || (typeof value === 'string' && isSafeHeadUrl(value, tag === 'script')))
		.map(([name, value]) => value === true
			? ` ${name.toLowerCase()}`
			: ` ${name.toLowerCase()}="${escapeHtml(String(value))}"`)
		.join('');
}

/**
 * Restricts head URLs to HTTP(S), with scripts confined to the current origin.
 * @param value - URL supplied by a head attribute.
 * @param localOnly - Whether cross-origin URLs must be rejected.
 * @returns Whether the URL is safe to emit.
 */
function isSafeHeadUrl(value: string, localOnly: boolean): boolean {
	if (!value || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
	try {
		const base = 'https://document.invalid';
		const target = new URL(value, base);
		return ['http:', 'https:'].includes(target.protocol) && (!localOnly || target.origin === base);
	} catch {
		return false;
	}
}

/**
 * Escapes a value for an HTML text or quoted-attribute context.
 *
 * @param value - Untrusted text value.
 * @returns HTML-safe text.
 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Prevents trusted inline content from closing its containing script element.
 *
 * @param value - Trusted inline script or JSON-LD content.
 * @returns Script content safe from premature element termination.
 */
function escapeScriptContent(value: string): string {
	return value
		.replace(/<\/script/gi, '<\\/script')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}
