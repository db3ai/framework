import type { DocumentHead, DocumentHeadAttributes } from './contracts';

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
		tags.push(`<meta${renderAttributes(attributes)}>`);
	}

	for (const attributes of head.link) {
		tags.push(`<link${renderAttributes(attributes)}>`);
	}

	for (const script of head.script) {
		tags.push(`<script${renderAttributes(script.attributes)}>${escapeScriptContent(script.content ?? '')}</script>`);
	}

	return tags.join('\n');
}

/**
 * Renders defined tag attributes with HTML-safe values.
 *
 * @param attributes - Attribute names and values for one head element.
 * @returns Leading-space-prefixed HTML attributes.
 */
function renderAttributes(attributes: DocumentHeadAttributes = {}): string {
	return Object.entries(attributes)
		.filter(([, value]) => value !== undefined && value !== null && value !== false)
		.map(([name, value]) => value === true
			? ` ${name}`
			: ` ${name}="${escapeHtml(String(value))}"`)
		.join('');
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
