import { selectedStrings, uniqueNormalizedStrings } from '@db3.ai/pure/collections';

/**
 * Validates tag selection against application-owned options before accepting it.
 *
 * selectedStrings() reports unknown values but retains them in its values array.
 * The application must reject invalid entries before persisting the selection.
 * @param selected - Raw string options already type-checked at the request boundary.
 * @returns Normalized, allowed tags with stable first-occurrence ordering.
 */
export function selectNoteTags(selected: readonly string[]): string[] {
	const options = uniqueNormalizedStrings([' Client ', 'Internal', 'client']);
	const result = selectedStrings(selected, options);
	if (result.invalid.length > 0) throw new Error('Choose a supported note tag.');
	return result.values;
}
