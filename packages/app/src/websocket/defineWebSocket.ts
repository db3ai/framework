import type { WebSocketEndpoint, WebSocketPrincipal, WebSocketTokenEndpoint } from './contracts';

/**
 * Defines controller actions while inferring the validated message type.
 * @param endpoint - Application-owned authorization, validation and lifecycle actions.
 * @returns The same definition for registration against an exact URL path.
 * @example defineWebSocket({ open: async ({ send }) => { await send({ ready: true }); } });
 */
export function defineWebSocket<TMessage = unknown>(endpoint: WebSocketEndpoint<TMessage, null> & { auth: 'public' }): WebSocketEndpoint<TMessage, null> & { auth: 'public' };
/** Defines a machine or service endpoint authenticated by its own bearer token check. */
export function defineWebSocket<TMessage = unknown, TPrincipal extends WebSocketPrincipal = WebSocketPrincipal>(endpoint: WebSocketTokenEndpoint<TMessage, TPrincipal>): WebSocketTokenEndpoint<TMessage, TPrincipal>;
/** Defines an authenticated endpoint; omitted auth always requires a valid session. */
export function defineWebSocket<TMessage = unknown>(endpoint: WebSocketEndpoint<TMessage>): WebSocketEndpoint<TMessage>;
/** Retains controller definitions without wrapping application actions. */
export function defineWebSocket(endpoint: WebSocketEndpoint<any, any> | WebSocketTokenEndpoint<any, any>): WebSocketEndpoint<any, any> | WebSocketTokenEndpoint<any, any> {
	return endpoint;
}
