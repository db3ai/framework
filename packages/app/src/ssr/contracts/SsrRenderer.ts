import type { SsrRenderContext, SsrState } from './SsrRenderContext';
import type { SsrRenderResult } from './SsrRenderResult';

/**
 * Application server entry capable of rendering a matched URL.
 *
 * The application owns Vue, its router, data loading and component lifecycle.
 * The framework owns the stable request, document and HTTP response boundary.
 */
export type SsrRenderer<TState extends object = SsrState> = (
	context: SsrRenderContext<TState>,
) => SsrRenderResult<TState> | Promise<SsrRenderResult<TState>>;
