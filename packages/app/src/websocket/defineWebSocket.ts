import type { WebSocketEndpoint } from './contracts';

/**
 * Defines controller actions while inferring the validated message type.
 * @param endpoint - Application-owned authorization, validation and lifecycle actions.
 * @returns The same definition for registration against an exact URL path.
 * @example defineWebSocket({ open: async ({ send }) => { await send({ ready: true }); } });
 */
export function defineWebSocket<TMessage = unknown>(endpoint: WebSocketEndpoint<TMessage, null> & { auth: 'public' }): WebSocketEndpoint<TMessage, null> & { auth: 'public' };
/** Defines an authenticated endpoint; omitted auth always requires a valid session. */
export function defineWebSocket<TMessage = unknown>(endpoint: WebSocketEndpoint<TMessage>): WebSocketEndpoint<TMessage>;
/** Retains controller definitions without wrapping application actions. */
export function defineWebSocket(endpoint: WebSocketEndpoint<any, any>): WebSocketEndpoint<any, any> {
	return endpoint;
}
