/**
 * Collapses runs of whitespace into a single space and trims the result.
 *
 * @example
 * ```ts
 * normalizeWhitespace('  SEO\\n  content   plan  ');
 * // 'SEO content plan'
 * ```
 */
export function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, ' ').trim();
}

/**
 * Builds a case-insensitive comparison key for human-entered strings.
 *
 * @example
 * ```ts
 * normalizedKey('  Flex   AI  ');
 * // 'flex ai'
 * ```
 */
export function normalizedKey(input: string): string {
	return normalizeWhitespace(input).toLowerCase();
}

/**
 * Converts an identifier or slug into display-friendly title text.
 *
 * @example
 * ```ts
 * startCase('targetAudiencePhrases');
 * // 'Target Audience Phrases'
 * ```
 */
export function startCase(input: string): string {
	return input
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Converts a display string or identifier into snake_case.
 *
 * @example
 * ```ts
 * snakeCase('Target Audience Phrases');
 * // 'target_audience_phrases'
 * ```
 */
export function snakeCase(input: string): string {
	return input
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/[^A-Za-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

/**
 * Converts a model or class name into lower-case prose for messages.
 *
 * @example
 * ```ts
 * displayNameFromIdentifier('PasswordResetToken');
 * // 'password reset token'
 * ```
 */
export function displayNameFromIdentifier(input: string): string {
	return startCase(input).toLowerCase();
}

/**
 * Removes blank edge lines and trims each line of a multi-line comment.
 *
 * @example
 * ```ts
 * normalizeDatabaseComment('  First line\\r\\n  Second line  ');
 * // 'First line\\nSecond line'
 * ```
 */
export function normalizeDatabaseComment(input: unknown): string | null {
	if (typeof input !== 'string') return null;

	const comment = input
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.map(line => line.trim())
		.join('\n')
		.trim();

	return comment || null;
}

/**
 * Returns a string capped at the requested length, trimming trailing whitespace.
 *
 * @example
 * ```ts
 * truncateText('organic growth workflow', 14);
 * // 'organic growth'
 * ```
 */
export function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;

	return value.slice(0, maxLength).trim();
}

/**
 * Returns a string capped at the requested length, appending an ellipsis when truncated.
 *
 * @example
 * ```ts
 * truncateWithEllipsis('organic growth workflow', 14);
 * // 'organic growth...'
 * ```
 */
export function truncateWithEllipsis(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;

	return `${value.slice(0, maxLength).trim()}...`;
}

/**
 * Escapes text for safe placement inside HTML text or attribute values.
 *
 * @example
 * ```ts
 * escapeHtml('Reset "A&B" <now>');
 * // 'Reset &quot;A&amp;B&quot; &lt;now&gt;'
 * ```
 */
export function escapeHtml(input: string): string {
	return input
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Trims strings, removes empty entries, and caps the list length.
 *
 * @example
 * ```ts
 * limitedStrings([' SEO ', '', 'AI'], 1);
 * // ['SEO']
 * ```
 */
export function limitedStrings(values: readonly string[], limit = 7): string[] {
	return values
		.map(value => value.trim())
		.filter(Boolean)
		.slice(0, limit);
}

/**
 * Counts whitespace-separated words in a string, returning zero for nullish text.
 *
 * @example
 * ```ts
 * wordCount('organic growth workflow');
 * // 3
 * ```
 */
export function wordCount(value: string | null | undefined): number {
	if (!value) return 0;

	return value.split(/\s+/).filter(Boolean).length;
}

/**
 * Removes a surrounding Markdown JSON code fence from a string.
 *
 * @example
 * ```ts
 * stripJsonCodeFence('```json\\n{"ok":true}\\n```');
 * // '{"ok":true}'
 * ```
 */
export function stripJsonCodeFence(input: string): string {
	return input
		.replace(/^```(?:json)?/i, '')
		.replace(/```$/i, '')
		.trim();
}
