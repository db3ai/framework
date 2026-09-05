import type { DocumentHead } from './DocumentHead';
import type { SsrRequest } from './SsrRequest';

/** JSON-compatible request state made available to the hydrating client. */
export type SsrState = Record<string, unknown>;

/**
 * Mutable state isolated to one server-side render request.
 *
 * Vue and other renderers may use `modules` to record the modules touched by a
 * render. A later build adapter can map those identifiers to route-specific
 * JavaScript and CSS without changing the application renderer contract.
 */
export interface SsrRenderContext<TState extends object = SsrState> {
	/** Transport-neutral request information. */
	request: SsrRequest;
	/** Response status used when the render result does not override it. */
	status: number;
	/** Document metadata collected during rendering. */
	head: DocumentHead;
	/** State serialised into the document for client hydration. */
	state: TState;
	/** Module identifiers observed by the concrete server renderer. */
	modules: Set<string>;
}
