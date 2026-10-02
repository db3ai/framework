/** One safely rendered prose or inline-code segment; never interpreted as HTML. */
export interface InlineDocumentationPart {
	/** Whether this segment was explicitly enclosed in Markdown backticks. */
	code: boolean;
	/** Literal content rendered through Vue's normal text escaping. */
	text: string;
}

/**
 * Splits single-backtick code spans from documentation prose.
 *
 * This deliberately does not parse HTML or general Markdown. Unmatched
 * backticks remain readable text, and code samples still use the code viewer.
 *
 * @param text - Authored paragraph, summary or short explanation.
 * @returns Ordered, literal text segments safe for server and client rendering.
 */
export function inlineDocumentation(text: string): InlineDocumentationPart[] {
	const parts: InlineDocumentationPart[] = [];
	let offset = 0;
	for (const match of text.matchAll(/`([^`\n]+)`/g)) {
		if (match.index > offset) parts.push({ code: false, text: text.slice(offset, match.index) });
		parts.push({ code: true, text: match[1]! });
		offset = match.index + match[0].length;
	}
	if (offset < text.length) parts.push({ code: false, text: text.slice(offset) });
	return parts;
}
