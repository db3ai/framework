import type { PublicUrlOptions } from './PublicUrlOptions';

/**
 * Options for one guarded outbound HTTP request.
 *
 * `init` is passed to `fetch` unchanged except that redirects are always
 * handled by the guard and the connection dispatcher is always replaced with
 * one that re-validates the addresses DNS returns at connect time.
 */
export interface GuardedFetchOptions extends PublicUrlOptions {
	/** Standard fetch options such as method, headers, body and abort signal. */
	init?: RequestInit;

	/**
	 * Maximum redirects followed before the request fails with `BlockedUrlError`.
	 *
	 * Every redirect target is validated as a new destination. Defaults to 4.
	 */
	maxRedirects?: number;

	/**
	 * How redirects are handled.
	 *
	 * `follow` (default) validates and follows each hop. `manual` returns the
	 * first 3xx response unchanged so a caller such as a browser can follow it
	 * through its own guarded request path.
	 */
	redirect?: 'follow' | 'manual';
}

/**
 * Response returned by a guarded outbound request.
 */
export interface GuardedFetchResult {
	/** Final response after any followed redirects. */
	response: Response;

	/** Absolute URL that produced `response`, after followed redirects. */
	finalUrl: string;
}
