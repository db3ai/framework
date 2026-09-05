import { uniqueNormalizedStrings } from '@db3.ai/pure/collections';
import { isRecord } from '@db3.ai/pure/records';
import {
	stripJsonCodeFence,
	truncateText,
} from '@db3.ai/pure/strings';

export interface TextResponsePayload {
	output_text?: unknown;
	output?: unknown;
	error?: {
		message?: unknown;
	};
}

/**
 * Formats unique strings as a Markdown unordered-list block for prompt input.
 *
 * @example
 * ```ts
 * stringListPromptBlock('Audiences', ['Founders', 'Founders']);
 * // 'Audiences:\\n- Founders'
 * ```
 */
export function stringListPromptBlock(
	title: string,
	values: readonly string[] | null | undefined,
): string {
	const items = uniqueNormalizedStrings(values ?? []);

	if (items.length === 0) return '';

	return `${title}:\n${items.map(item => `- ${item}`).join('\n')}`;
}

/**
 * Reads a text error message from a response-like payload.
 *
 * @example
 * ```ts
 * responseErrorMessage({ error: { message: 'Rate limited' } });
 * // 'Rate limited'
 * ```
 */
export function responseErrorMessage(payload: TextResponsePayload | null): string | null {
	const message = payload?.error?.message;

	return typeof message === 'string' && message.trim() ? message.trim() : null;
}

/**
 * Reads direct or nested output text from a response-like payload.
 *
 * @example
 * ```ts
 * responseOutputText({ output_text: ' Done ' });
 * // 'Done'
 * ```
 */
export function responseOutputText(payload: TextResponsePayload | null): string | null {
	if (!payload) return null;
	if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();

	const text = outputItemsText(payload.output);

	return text || null;
}

/**
 * Parses a JSON array of strings or a line/comma-separated list into strings.
 *
 * @example
 * ```ts
 * parseStringList('["seo", "content"]');
 * // ['seo', 'content']
 * ```
 */
export function parseStringList(text: string): string[] {
	const jsonText = stripJsonCodeFence(text);

	try {
		const parsed = JSON.parse(jsonText) as unknown;

		if (Array.isArray(parsed)) {
			return parsed
				.flatMap(item => typeof item === 'string' ? [item.trim()] : [])
				.filter(Boolean);
		}
	} catch {
		// Fall back to line parsing below.
	}

	return jsonText
		.split(/\r?\n|,/)
		.map(line => line.replace(/^[-*\d.\s"]+|["\s]+$/g, '').trim())
		.filter(Boolean);
}

/**
 * Parses JSON text after removing an optional Markdown JSON code fence.
 *
 * @example
 * ```ts
 * parseJsonObjectText('```json\\n{"ok":true}\\n```');
 * // { ok: true }
 * ```
 */
export function parseJsonObjectText(text: string): unknown {
	return JSON.parse(stripJsonCodeFence(text)) as unknown;
}

/**
 * Extracts nested `output_text` content items from an array response shape.
 *
 * @example
 * ```ts
 * outputItemsText([{ content: [{ type: 'output_text', text: 'Hello' }] }]);
 * // 'Hello'
 * ```
 */
export function outputItemsText(output: unknown): string {
	if (!Array.isArray(output)) return '';

	return output
		.flatMap((item) => {
			if (!isRecord(item) || !Array.isArray(item.content)) return [];

			return item.content.flatMap((content) => {
				if (!isRecord(content)) return [];
				if (content.type !== 'output_text') return [];

				return typeof content.text === 'string' ? [content.text] : [];
			});
		})
		.join('\n')
		.trim();
}

export { truncateText };
