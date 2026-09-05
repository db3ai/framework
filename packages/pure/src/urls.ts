/**
 * Parses an optional valid port from a string.
 *
 * @example
 * ```ts
 * optionalPort('5174');
 * // 5174
 * ```
 */
export function optionalPort(input: string | undefined): number | undefined {
	if (!input) return undefined;

	const parsed = Number(input);

	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return undefined;
	return parsed;
}

/**
 * Normalizes a website URL or domain to a bare hostname without a leading `www.`.
 *
 * @example
 * ```ts
 * normalizeDomainTarget('https://www.example.com/path');
 * // 'example.com'
 * ```
 */
export function normalizeDomainTarget(value: string): string | null {
	const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;

	try {
		const url = new URL(candidate);
		const target = url.hostname.toLowerCase().replace(/^www\./, '');

		if (!target.includes('.')) return null;
		return target;
	} catch {
		return null;
	}
}

/**
 * Normalizes an absolute URL or bare domain, removing hashes and repeated path
 * slashes.
 *
 * @example
 * ```ts
 * normalizeUrl('example.com//page#section');
 * // 'https://example.com/page'
 * ```
 */
export function normalizeUrl(value: string): string {
	const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value)
		? value
		: `https://${value}`;
	const url = new URL(candidate);

	url.hash = '';
	normalizeUrlPathSlashes(url);

	return url.toString();
}

/**
 * Safely normalizes a URL, resolving relative paths and collapsing repeated
 * path slashes.
 *
 * @example
 * ```ts
 * tryNormalizeUrl('/pricing//plans#top', 'https://example.com');
 * // 'https://example.com/pricing/plans'
 * ```
 */
export function tryNormalizeUrl(value: string, baseUrl?: string): string | null {
	try {
		const url = baseUrl
			? new URL(value, baseUrl)
			: new URL(normalizeUrl(value));

		url.hash = '';
		normalizeUrlPathSlashes(url);

		if (!['http:', 'https:'].includes(url.protocol)) return null;

		return url.toString();
	} catch {
		return null;
	}
}

/**
 * Collapses repeated literal slashes in a parsed URL path while preserving a
 * single trailing slash and leaving query string values untouched.
 *
 * @param {URL} url - The parsed URL to normalize in place.
 * @returns {void}
 */
function normalizeUrlPathSlashes(url: URL): void {
	url.pathname = url.pathname.replace(/\/{2,}/g, '/');
}
