import {
	normalizedKey,
	normalizeWhitespace,
} from '@db3.ai/pure/strings';

/**
 * Removes exact duplicate strings while keeping the first occurrence order.
 *
 * @example
 * ```ts
 * uniqueStrings(['alpha', 'beta', 'alpha']);
 * // ['alpha', 'beta']
 * ```
 */
export function uniqueStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];

	for (const value of values) {
		if (seen.has(value)) continue;

		seen.add(value);
		unique.push(value);
	}

	return unique;
}

/**
 * Normalizes whitespace and removes case-insensitive duplicate strings.
 *
 * @example
 * ```ts
 * uniqueNormalizedStrings([' SEO  Agency ', 'seo agency', 'AI']);
 * // ['SEO Agency', 'AI']
 * ```
 */
export function uniqueNormalizedStrings(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];

	for (const value of values) {
		const normalized = normalizeWhitespace(value);
		const key = normalizedKey(normalized);

		if (!normalized || seen.has(key)) continue;

		seen.add(key);
		unique.push(normalized);
	}

	return unique;
}

export interface SelectedStringsResult {
	values: string[];
	invalid: string[];
}

export type SelectedOrAllStringsResult = SelectedStringsResult;

/**
 * Selects requested values from a saved option list and reports unknown values.
 *
 * @example
 * ```ts
 * selectedStrings([' seo agency '], ['SEO Agency', 'Developers']);
 * // { values: ['SEO Agency'], invalid: [] }
 * ```
 */
export function selectedStrings(
	selected: readonly string[],
	available: readonly string[] | null | undefined,
): SelectedStringsResult {
	const options = uniqueNormalizedStrings(available ?? []);
	const selectedValues = uniqueNormalizedStrings(selected);
	const allowed = new Map(options.map(value => [normalizedKey(value), value]));
	const invalid = selectedValues.filter(value => !allowed.has(normalizedKey(value)));

	return {
		values: selectedValues.map(value => allowed.get(normalizedKey(value)) ?? value),
		invalid,
	};
}

/**
 * Selects requested values from a saved option list, or returns all saved options when no selection is supplied.
 *
 * @example
 * ```ts
 * selectedOrAllStrings([' seo agency '], ['SEO Agency', 'Developers']);
 * // { values: ['SEO Agency'], invalid: [] }
 * ```
 */
export function selectedOrAllStrings(
	selected: readonly string[] | undefined,
	available: readonly string[] | null | undefined,
): SelectedStringsResult {
	if (selected === undefined) {
		return {
			values: uniqueNormalizedStrings(available ?? []),
			invalid: [],
		};
	}

	return selectedStrings(selected, available);
}
