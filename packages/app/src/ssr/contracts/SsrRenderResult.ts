import type { DocumentHead } from './DocumentHead';
import type { SsrState } from './SsrRenderContext';

/** Header value accepted from an application SSR render result. */
export type SsrResponseHeaderValue = string | number | string[];

/**
 * Application-owned output produced for one server-side render request.
 *
 * Optional values override their equivalents collected on the render context.
 */
export interface SsrRenderResult<TState extends object = SsrState> {
	/** Rendered application markup inserted into the HTML document shell. */
	appHtml: string;
	/** Optional HTTP status override, such as 404 for a rendered not-found page. */
	status?: number;
	/** Optional document head override. */
	head?: DocumentHead;
	/** Optional client hydration state override. */
	state?: TState;
	/** Additional response headers such as Location or cache policy. */
	headers?: Record<string, SsrResponseHeaderValue>;
}
