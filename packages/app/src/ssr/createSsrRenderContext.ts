import type { SsrRenderContext, SsrRequest, SsrState } from './contracts';

/**
 * Creates isolated mutable state for one server-side render request.
 *
 * @param request - Transport-neutral incoming request.
 * @param state - Optional initial hydration state owned by this request.
 * @returns A fresh render context that is safe to mutate during rendering.
 */
export function createSsrRenderContext<TState extends object = SsrState>(
	request: SsrRequest,
	state: TState = {} as TState,
): SsrRenderContext<TState> {
	return {
		request,
		status: 200,
		head: {
			meta: [],
			link: [],
			script: [],
		},
		state,
		modules: new Set(),
	};
}
