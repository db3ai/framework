import { Tiktoken } from 'js-tiktoken/lite';
import cl100kBase from 'js-tiktoken/ranks/cl100k_base';
import type { EmbeddingTextChunk, EmbeddingTextChunkOptions } from './contracts/EmbeddingTextChunk';

let tokenizer: Tiktoken | undefined;

/** Counts ordinary text, including literal special-token spellings, with cl100k_base. */
function tokens(text: string): number {
	tokenizer ??= new Tiktoken(cl100kBase);
	return tokenizer.encode(text, [], []).length;
}

/**
 * Keeps fitting documents whole and splits oversized Markdown at natural boundaries.
 * Each passage retains source offsets, bounded shared context, its heading hierarchy
 * and a small overlap. Uses cl100k_base, as used by text-embedding-3-small/large.
 * No provider requests or generated summaries are involved.
 *
 * @param text - Extracted text or Markdown; HTML extraction belongs to the caller.
 * @param options - Context and token budgets for the complete embedding input.
 * @returns Ordered passages whose source ranges cover all of the original text.
 * @example
 * const chunks = chunkEmbeddingText(page.text, { context: `Title: ${page.title}` });
 */
export function chunkEmbeddingText(text: string, options: EmbeddingTextChunkOptions = {}): EmbeddingTextChunk[] {
	const maximum = options.maxTokens ?? 8000;
	const overlap = options.overlapTokens ?? Math.min(128, Math.floor(maximum / 8));
	if (!Number.isInteger(maximum) || maximum < 64 || maximum > 8191) throw new Error('Embedding chunks require maxTokens between 64 and 8191.');
	if (!Number.isInteger(overlap) || overlap < 0 || overlap >= maximum / 2) throw new Error('Embedding overlap must be non-negative and smaller than half the input budget.');
	if (!text.trim()) return [];
	const contextBudget = Math.min(512, Math.floor(maximum / 8));
	const context = boundedPrefix(options.context?.trim() ?? '', contextBudget);
	const headings = markdownHeadings(text);
	const chunks: EmbeddingTextChunk[] = [];
	const fullInput = embeddingInput(context, null, text);
	if (tokens(fullInput) <= maximum) return [{ index: 0, text, heading: null, input: fullInput, start: 0, end: text.length, tokens: tokens(fullInput) }];
	let start = 0;
	let contentStart = 0;
	while (start < text.length) {
		const activeHeading = headings.filter(heading => heading.start <= contentStart).at(-1)?.title ?? null;
		const heading = activeHeading ? boundedPrefix(activeHeading, contextBudget) : null;
		const prefix = embeddingInput(context, heading, '');
		const available = maximum - tokens(prefix) - 8;
		let end = start + fittingPrefixLength(text.slice(start), available);
		if (end < text.length) end = naturalBoundary(text, start, end, headings.map(item => item.start));
		let input = embeddingInput(context, heading, text.slice(start, end));
		// BPE merges across the prefix boundary are verified against the final input.
		while (tokens(input) > maximum && end > start) {
			end = previousCharacter(text, end);
			input = embeddingInput(context, heading, text.slice(start, end));
		}
		if (end <= start) throw new Error('Embedding context leaves no room for source text.');
		chunks.push({ index: chunks.length, text: text.slice(start, end), heading, input, start, end, tokens: tokens(input) });
		if (end === text.length) break;
		contentStart = end;
		const previousText = text.slice(start, end);
		const overlapStart = overlap ? fittingSuffixStart(previousText, overlap) + start : end;
		// Prefer a whole final paragraph when it fits inside the overlap budget.
		const paragraphStart = text.lastIndexOf('\n\n', end - 3) + 2;
		start = paragraphStart >= overlapStart && paragraphStart < end && paragraphStart > start
			? paragraphStart : overlapStart > start ? overlapStart : end;
	}
	return chunks;
}

/** Builds a deterministic context prefix without rewriting source evidence. */
function embeddingInput(context: string, heading: string | null, text: string): string {
	return `${context ? `${context}\n` : ''}${heading ? `section: ${heading}\n` : ''}content:\n${text}`;
}

/** Finds a token-bounded prefix without cutting a Unicode code point. */
function fittingPrefixLength(text: string, maximum: number): number {
	if (tokens(text) <= maximum) return text.length;
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (tokens(text.slice(0, middle)) <= maximum) low = middle;
		else high = middle - 1;
	}
	if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) low -= 1;
	return low;
}

/** Bounds repeated context so even unusually long metadata leaves room for source text. */
function boundedPrefix(text: string, maximum: number): string {
	return text.slice(0, fittingPrefixLength(text, maximum)).trim();
}

/** Locates a bounded overlap suffix on Unicode code-point boundaries. */
function fittingSuffixStart(text: string, maximum: number): number {
	let low = 0;
	let high = text.length;
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (tokens(text.slice(middle)) <= maximum) high = middle;
		else low = middle + 1;
	}
	if (/[\uDC00-\uDFFF]/.test(text[low] ?? '')) low += 1;
	return low;
}

/** Moves backwards by one Unicode code point. */
function previousCharacter(text: string, end: number): number {
	return end > 1 && /[\uDC00-\uDFFF]/.test(text[end - 1]) ? end - 2 : end - 1;
}

/** Prefers a heading or paragraph boundary, then sentences and whitespace, without emitting tiny fragments. */
function naturalBoundary(text: string, start: number, end: number, headings: number[]): number {
	const minimum = start + Math.floor((end - start) / 2);
	const heading = headings.filter(position => position >= minimum && position <= end).at(-1);
	if (heading !== undefined) return heading;
	const candidate = text.slice(minimum, end);
	for (const pattern of [/\n\s*\n/g, /[.!?。！？][\s]+/g, /\s+/g]) {
		const match = [...candidate.matchAll(pattern)].at(-1);
		if (match) return minimum + match.index! + match[0].length;
	}
	return end;
}

/** Reads Markdown heading ancestry while ignoring headings inside fenced code blocks. */
function markdownHeadings(text: string): Array<{ start: number; title: string }> {
	const headings: Array<{ start: number; title: string }> = [];
	const hierarchy: string[] = [];
	let fence: string | null = null;
	for (const line of text.matchAll(/^.*(?:\n|$)/gm)) {
		const delimiter = line[0].match(/^\s*(`{3,}|~{3,})/)?.[1];
		if (delimiter) { fence = fence ? (delimiter[0] === fence[0] ? null : fence) : delimiter; continue; }
		if (fence) continue;
		const heading = line[0].match(/^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
		if (!heading) continue;
		hierarchy.length = heading[1].length;
		hierarchy[heading[1].length - 1] = heading[2];
		headings.push({ start: line.index!, title: hierarchy.filter(Boolean).join(' > ') });
	}
	return headings;
}
