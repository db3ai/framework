/** Header values exposed to a transport-neutral SSR renderer. */
export type SsrRequestHeaderValue = string | string[] | undefined;

/**
 * HTTP request data available to the application SSR entry point.
 *
 * The request target remains relative so query strings and encoded path data
 * are preserved exactly as received by the HTTP adapter.
 */
export interface SsrRequest {
	/** Uppercase HTTP method used for the render request. */
	method: string;
	/** Relative request target, including its query string. */
	url: string;
	/** Incoming headers copied from the concrete HTTP transport. */
	headers: Readonly<Record<string, SsrRequestHeaderValue>>;
}
