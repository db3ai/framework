export const LANDING_PATH = '/';
export const FRAMEWORK_PATH = '/framework';
export const DOCUMENTATION_PATH_PREFIX = '/docs/';

/**
 * Route shapes owned by the public documentation application.
 */
export type DocumentationRoute =
	| { kind: 'framework'; pathname: string; articleId: ''; sectionId: string }
	| { kind: 'landing'; pathname: string; articleId: ''; sectionId: string }
	| { kind: 'article'; pathname: string; articleId: string; sectionId: string }
	| { kind: 'not-found'; pathname: string; articleId: ''; sectionId: string };

/**
 * Parses a complete or relative documentation URL into its public route shape.
 *
 * Article existence is deliberately resolved by the documentation catalogue,
 * while this function owns only URL syntax shared by browser and server code.
 *
 * @param value - Absolute URL, root-relative path, or pathname to parse.
 * @returns Landing, article-shaped, or unsupported route information.
 */
export function parseDocumentationRoute(value: string): DocumentationRoute {
	const url = new URL(value || LANDING_PATH, 'https://framework.db3.ai');
	const pathname = normalizePathname(url.pathname);
	const sectionId = decodeSegment(url.hash.replace(/^#/, ''));

	if (pathname === LANDING_PATH || pathname === FRAMEWORK_PATH) {
		return {
			kind: pathname === FRAMEWORK_PATH ? 'framework' : 'landing',
			pathname,
			articleId: '',
			sectionId,
		};
	}

	if (pathname.startsWith(DOCUMENTATION_PATH_PREFIX)) {
		const encodedArticleId = pathname.slice(DOCUMENTATION_PATH_PREFIX.length);

		if (encodedArticleId && !encodedArticleId.includes('/')) {
			return {
				kind: 'article',
				pathname,
				articleId: decodeSegment(encodedArticleId),
				sectionId,
			};
		}
	}

	return {
		kind: 'not-found',
		pathname,
		articleId: '',
		sectionId,
	};
}

/**
 * Builds the canonical public path for an article and optional page section.
 *
 * @param articleId - Stable documentation article identifier.
 * @param sectionId - Optional in-page heading identifier.
 * @returns Root-relative canonical documentation URL.
 */
export function documentationPath(articleId: string, sectionId = ''): string {
	const path = `${DOCUMENTATION_PATH_PREFIX}${encodeURIComponent(articleId)}`;

	return sectionId ? `${path}#${encodeURIComponent(sectionId)}` : path;
}

/**
 * Returns the browser-visible path, query, and fragment for client navigation.
 *
 * @param location - Browser location-like value.
 * @returns Relative URL suitable for shared route parsing and history state.
 */
export function browserDocumentationLocation(
	location: Pick<Location, 'pathname' | 'search' | 'hash'>,
): string {
	return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Removes a trailing slash while preserving the root pathname.
 *
 * @param pathname - URL pathname to normalize.
 * @returns Stable public pathname.
 */
function normalizePathname(pathname: string): string {
	if (pathname === LANDING_PATH) return LANDING_PATH;

	return pathname.replace(/\/+$/, '') || LANDING_PATH;
}

/**
 * Decodes one URL path or fragment segment without making malformed URLs fatal.
 *
 * @param value - Encoded URL segment.
 * @returns Decoded segment, or its original value when decoding fails.
 */
function decodeSegment(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}
