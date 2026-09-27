import { Agent, type Dispatcher } from 'undici';
import { BlockedUrlError } from './BlockedUrlError';
import { assertPublicUrl } from './assertPublicUrl';
import { publicAddressLookup } from './publicAddressLookup';
import type * as network from './contracts';

const DEFAULT_MAX_REDIRECTS = 4;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_SENSITIVE_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

let publicDispatcher: Dispatcher | undefined;
let privateDispatcher: Dispatcher | undefined;

/**
 * Fetches a user-supplied URL without allowing it to reach private networks.
 *
 * Each hop is validated before it is requested, and the connection itself uses
 * {@link publicAddressLookup}, so the address DNS returns at connect time is
 * the address that was checked. Redirects are followed manually: every target
 * is validated, `303` (and `301`/`302` after `POST`) switch to `GET` without a
 * body as `fetch` does, and credentials (`Authorization`, `Cookie`) are removed
 * when a redirect leaves the original origin.
 *
 * `allowPrivate` permits private destinations without weakening TLS certificate
 * verification. Local HTTPS receivers must present a certificate trusted by Node.
 *
 * The request is sent with the runtime's global `fetch`, so test doubles that
 * replace `globalThis.fetch` continue to work.
 *
 * @param rawUrl - Absolute HTTP(S) URL to request.
 * @param options - Fetch init, redirect handling and destination policy.
 * @returns Final response and the URL that produced it.
 * @throws {BlockedUrlError} When any hop targets a refused destination or the
 * redirect limit is exceeded.
 *
 * @example
 * const { response, finalUrl } = await guardedFetch('https://example.com/', {
 * 	init: { headers: { accept: 'text/html' }, signal: AbortSignal.timeout(10_000) },
 * });
 */
export async function guardedFetch(rawUrl: string, options: network.GuardedFetchOptions = {}): Promise<network.GuardedFetchResult> {
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	let current = rawUrl;
	let init: RequestInit = { ...options.init };

	for (let hop = 0; ; hop++) {
		await assertPublicUrl(current, options);

		const response = await fetchHop(current, init, options.allowPrivate === true);
		const location = response.headers.get('location');

		if (!REDIRECT_STATUSES.has(response.status) || !location || options.redirect === 'manual') {
			return { response, finalUrl: current };
		}

		await response.body?.cancel();

		if (hop >= maxRedirects) throw new BlockedUrlError('Too many redirects.');

		const next = new URL(location, current).toString();

		init = redirectInit(init, response.status, new URL(current).origin !== new URL(next).origin);
		current = next;
	}
}

/**
 * Sends one request hop through the dispatcher matching the destination policy.
 *
 * @param url - Already validated hop URL.
 * @param init - Fetch options for this hop.
 * @param allowPrivate - Whether private destinations are allowed.
 * @returns Unfollowed hop response.
 * @throws {BlockedUrlError} When the connect-time lookup refuses the address.
 */
async function fetchHop(url: string, init: RequestInit, allowPrivate: boolean): Promise<Response> {
	try {
		// The caller checks each URL/redirect; this dispatcher validates the actual
		// socket address, including DNS changes between validation and connection.
		return await fetch(url, {
			...init,
			redirect: 'manual',
			dispatcher: hopDispatcher(allowPrivate),
		} as RequestInit);
	} catch (error) {
		throw blockedCause(error) ?? error;
	}
}

/**
 * Chooses the connection dispatcher for one hop.
 *
 * @param allowPrivate - Whether private destinations are allowed.
 * @returns Shared dispatcher for the hop's policy.
 */
function hopDispatcher(allowPrivate: boolean): Dispatcher {
	if (!allowPrivate) {
		return publicDispatcher ??= new Agent({ connect: { lookup: publicAddressLookup, rejectUnauthorized: true } });
	}

	return privateDispatcher ??= new Agent({ connect: { rejectUnauthorized: true } });
}

/**
 * Builds the fetch options for the next redirect hop.
 *
 * @param init - Options used for the previous hop.
 * @param status - Redirect status code.
 * @param crossOrigin - Whether the redirect leaves the previous origin.
 * @returns Options for the next hop.
 */
function redirectInit(init: RequestInit, status: number, crossOrigin: boolean): RequestInit {
	const method = (init.method ?? 'GET').toUpperCase();
	const switchesToGet = status === 303
		? method !== 'GET' && method !== 'HEAD'
		: (status === 301 || status === 302) && method === 'POST';
	const headers = new Headers(init.headers);

	if (switchesToGet) {
		headers.delete('content-type');
		headers.delete('content-length');
	}

	if (crossOrigin) {
		for (const name of CROSS_ORIGIN_SENSITIVE_HEADERS) headers.delete(name);
	}

	return {
		...init,
		headers,
		...(switchesToGet ? { method: 'GET', body: undefined } : {}),
	};
}

/**
 * Finds a guard rejection wrapped inside a fetch network error.
 *
 * @param error - Error thrown by `fetch`.
 * @returns The wrapped `BlockedUrlError`, or null.
 */
function blockedCause(error: unknown): BlockedUrlError | null {
	let current: unknown = error;

	for (let depth = 0; depth < 5 && current; depth++) {
		if (current instanceof BlockedUrlError) return current;
		current = (current as { cause?: unknown }).cause;
	}

	return null;
}
