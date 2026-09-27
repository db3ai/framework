/**
 * URL citation attached to one assistant message.
 *
 * Character offsets refer to the provider-authored message before the application
 * replaces the annotated citation span with a standard Markdown link.
 */
export interface AgentCitation {
	/** Stable citation occurrence id derived from the provider output item. */
	id: string;

	/** Citation kind supported by the current agent UI. */
	type: 'url';

	/** Human-readable source title used as the Markdown link label. */
	title: string;

	/** Canonical HTTP or HTTPS source URL. */
	url: string;

	/** Inclusive character offset where the provider citation begins. */
	startIndex: number;

	/** Exclusive character offset where the provider citation ends. */
	endIndex: number;
}

const COMPLETE_PROVIDER_CITATION_PATTERN = /\uE200cite\uE202[^\uE201\r\n]*\uE201/;
const UNRESOLVED_PROVIDER_CITATION_PATTERN = /[ \t]*\uE200cite(?:\uE202[^\uE201\r\n]*)?(?:\uE201|$)/g;
const TRAILING_PARTIAL_PROVIDER_CITATION_PATTERN = /[ \t]*\uE200(?:c(?:i(?:t(?:e(?:\uE202[^\uE201\r\n]*)?)?)?)?)?$/;

/**
 * Converts provider-annotated citation spans into standard Markdown links.
 *
 * Citations sharing the same provider span are rendered together. Any opaque
 * private-use citation marker without a valid annotation is removed so it
 * never reaches the reader-facing Markdown renderer.
 *
 * @param markdown - Raw provider-authored assistant text.
 * @param citations - Valid URL annotations for this message.
 * @returns Markdown containing safe source links and no provider-only markers.
 */
export function agentMarkdownWithCitations(markdown: string, citations: AgentCitation[]): string {
	let output = markdown;
	const replacements = citationReplacements(markdown, normalizedAgentCitations(citations));

	for (const replacement of replacements) {
		output = `${output.slice(0, replacement.startIndex)}${replacement.markdown}${output.slice(replacement.endIndex)}`;
	}

	return withoutProviderCitationMarkers(output);
}

/**
 * Removes complete or trailing provider-private citation markers from Markdown.
 *
 * This is a fallback for malformed model-authored references such as
 * `turn0?`, which do not carry a URL annotation and cannot be resolved.
 *
 * @param markdown - Potentially annotated provider text.
 * @returns Markdown without opaque citation markers.
 */
export function withoutProviderCitationMarkers(markdown: string): string {
	return markdown
		.replace(UNRESOLVED_PROVIDER_CITATION_PATTERN, '')
		.replace(TRAILING_PARTIAL_PROVIDER_CITATION_PATTERN, '');
}

/**
 * Normalizes, orders, and deduplicates URL citation occurrences.
 *
 * @param citations - Citation values collected from provider events or storage.
 * @returns Stable valid citation occurrences in message order.
 */
export function normalizedAgentCitations(citations: AgentCitation[]): AgentCitation[] {
	const seen = new Set<string>();
	const normalized: AgentCitation[] = [];

	for (const citation of citations) {
		if (!isAgentCitation(citation)) continue;

		const key = agentCitationOccurrenceKey(citation);

		if (seen.has(key)) continue;

		seen.add(key);
		normalized.push({
			...citation,
			title: citation.title.trim().replace(/\s+/g, ' '),
			url: normalizedCitationUrl(citation.url) as string,
		});
	}

	return normalized.sort((left, right) => (
		left.startIndex - right.startIndex
		|| left.endIndex - right.endIndex
		|| left.url.localeCompare(right.url)
	));
}

/**
 * Checks whether an unknown value is a complete, safe URL citation.
 *
 * @param value - Potential persisted or streamed citation value.
 * @returns True when the value satisfies the public citation contract.
 */
export function isAgentCitation(value: unknown): value is AgentCitation {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

	const citation = value as Record<string, unknown>;

	return typeof citation.id === 'string'
		&& citation.id.length > 0
		&& citation.type === 'url'
		&& typeof citation.title === 'string'
		&& citation.title.trim().length > 0
		&& typeof citation.url === 'string'
		&& normalizedCitationUrl(citation.url) !== null
		&& Number.isInteger(citation.startIndex)
		&& Number(citation.startIndex) >= 0
		&& Number.isInteger(citation.endIndex)
		&& Number(citation.endIndex) > Number(citation.startIndex);
}

/**
 * Builds the identity used to deduplicate one citation occurrence.
 *
 * @param citation - Valid URL citation occurrence.
 * @returns Stable occurrence key independent of provider event ids.
 */
export function agentCitationOccurrenceKey(citation: AgentCitation): string {
	return `${citation.startIndex}:${citation.endIndex}:${citation.url}`;
}

/**
 * Replacement applied to one provider citation span.
 */
interface CitationReplacement {
	/** Inclusive start offset in the original provider message. */
	startIndex: number;

	/** Exclusive end offset in the original provider message. */
	endIndex: number;

	/** Standard Markdown links that replace the provider span. */
	markdown: string;
}

/**
 * Groups valid annotations into non-overlapping reverse-order replacements.
 *
 * @param markdown - Original provider-authored text.
 * @param citations - Normalized citations ordered by message position.
 * @returns Safe replacements ordered from the end of the message backwards.
 */
function citationReplacements(markdown: string, citations: AgentCitation[]): CitationReplacement[] {
	const citationsByRange = new Map<string, AgentCitation[]>();

	for (const citation of citations) {
		if (citation.endIndex > markdown.length) continue;

		const rangeKey = `${citation.startIndex}:${citation.endIndex}`;
		const rangeCitations = citationsByRange.get(rangeKey) ?? [];

		rangeCitations.push(citation);
		citationsByRange.set(rangeKey, rangeCitations);
	}

	return [...citationsByRange.values()]
		.map(rangeCitations => citationReplacement(markdown, rangeCitations))
		.filter((replacement): replacement is CitationReplacement => replacement !== null)
		.sort((left, right) => right.startIndex - left.startIndex);
}

/**
 * Builds one Markdown replacement for citations attached to the same span.
 *
 * @param markdown - Original provider-authored text.
 * @param citations - Citations sharing a start and end offset.
 * @returns Replacement when the annotated span is safe to replace.
 */
function citationReplacement(markdown: string, citations: AgentCitation[]): CitationReplacement | null {
	const first = citations[0];

	if (!first) return null;

	const annotatedText = markdown.slice(first.startIndex, first.endIndex);

	if (!replaceableCitationSpan(annotatedText)) return null;

	const seenUrls = new Set<string>();
	const links = citations.flatMap(citation => {
		if (seenUrls.has(citation.url)) return [];

		seenUrls.add(citation.url);

		return [citationMarkdownLink(citation)];
	});

	return links.length > 0
		? {
			startIndex: first.startIndex,
			endIndex: first.endIndex,
			markdown: links.join(' · '),
		}
		: null;
}

/**
 * Checks whether an annotated text span can safely become a source link.
 *
 * Provider citations normally cover an opaque private-use marker. A compact
 * visible label is also accepted for compatible providers, while multiline or
 * unexpectedly large spans are left untouched.
 *
 * @param value - Text selected by provider citation offsets.
 * @returns True when replacing the span cannot consume surrounding prose.
 */
function replaceableCitationSpan(value: string): boolean {
	if (!value || value.includes('\n') || value.includes('\r')) return false;
	if (value.length > 300) return false;

	return COMPLETE_PROVIDER_CITATION_PATTERN.test(value) || value.trim().length > 0;
}

/**
 * Creates one safe standard Markdown link from a normalized citation.
 *
 * @param citation - Citation supplying the source title and URL.
 * @returns Markdown link suitable for the existing sanitized renderer.
 */
function citationMarkdownLink(citation: AgentCitation): string {
	const label = citation.title
		.replace(/\\/g, '\\\\')
		.replace(/\[/g, '\\[')
		.replace(/\]/g, '\\]');
	const url = normalizedCitationUrl(citation.url) as string;
	const destination = url.replace(/\(/g, '%28').replace(/\)/g, '%29');

	return `[${label}](${destination})`;
}

/**
 * Canonicalizes an HTTP citation URL and rejects unsafe protocols.
 *
 * @param value - Provider or persisted citation URL.
 * @returns Canonical HTTP(S) URL, or null when it is unsafe or invalid.
 */
function normalizedCitationUrl(value: string): string | null {
	try {
		const url = new URL(value);

		return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
	} catch {
		return null;
	}
}
