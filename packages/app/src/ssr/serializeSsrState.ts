/**
 * Serialises hydration state without allowing it to terminate an inline script.
 *
 * The output is suitable for an `application/json` script element. Applications
 * should parse the element's text content instead of evaluating JavaScript.
 *
 * @param state - JSON-compatible state produced by the application renderer.
 * @returns Safely escaped JSON text.
 */
export function serializeSsrState(state: unknown): string {
	const json = JSON.stringify(state) ?? 'null';

	return json
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
}
