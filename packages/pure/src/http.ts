/**
 * Extracts a bearer token from an Authorization header value.
 *
 * @example
 * ```ts
 * bearerToken('Bearer sk_test_123');
 * // 'sk_test_123'
 * ```
 */
export function bearerToken(header: string | readonly string[] | undefined): string | null {
	const value = Array.isArray(header) ? header[0] : header;

	if (!value) return null;

	const match = value.match(/^Bearer\s+(.+)$/i);

	return match?.[1]?.trim() || null;
}

/**
 * Returns the standard application error code for an HTTP status.
 *
 * @example
 * ```ts
 * errorCodeForStatus(404);
 * // 'not_found'
 * ```
 */
export function errorCodeForStatus(statusCode: number): string {
	if (statusCode === 400) return 'bad_request';
	if (statusCode === 401) return 'unauthenticated';
	if (statusCode === 403) return 'forbidden';
	if (statusCode === 404) return 'not_found';
	if (statusCode === 409) return 'conflict';
	if (statusCode === 422) return 'unprocessable_entity';

	return statusCode >= 500 ? 'server_error' : 'request_failed';
}

/**
 * Allows only same-site redirect paths and blocks selected prefixes.
 *
 * @example
 * ```ts
 * safeRedirectPath('/app/dashboard', ['/auth/']);
 * // '/app/dashboard'
 * ```
 */
export function safeRedirectPath(
	path: unknown,
	blockedPrefixes: readonly string[] = [],
): string | null {
	if (typeof path !== 'string') return null;
	if (!path.startsWith('/') || path.startsWith('//')) return null;
	if (blockedPrefixes.some(prefix => path.startsWith(prefix))) return null;

	return path;
}
