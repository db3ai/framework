import type { SsrRenderer, SsrRequest, SsrState } from '../../contracts';

/** Loads the current application document template for a render request. */
export type SsrTemplateLoader = (request: SsrRequest) => string | Promise<string>;

/** Determines whether the Fastify SSR fallback owns an incoming URL. */
export type SsrRequestMatcher = (request: SsrRequest) => boolean | Promise<boolean>;

/**
 * Configuration for the optional Fastify SSR adapter.
 *
 * Applications own their renderer and template. The adapter owns request
 * conversion, response headers, status handling and the private error boundary.
 */
export interface FastifySsrOptions<TState extends object = SsrState> {
	/** Application server entry used to render matching requests. */
	render: SsrRenderer<TState>;
	/** HTML shell or loader used for every matching request. */
	template: string | SsrTemplateLoader;
	/** Explicit Fastify page routes owned by this renderer. */
	routes?: readonly string[];
	/** Optional ownership check for excluding API or SPA paths. */
	shouldRender?: SsrRequestMatcher;
}
