import type { WebSocketChannelDefinition } from './WebSocketChannel';
import type { IncomingMessage } from 'node:http';
import type { UserIdentity } from '../../auth';

/** An accepted connection. Authenticated sends recheck the session; all sends recheck endpoint policy. */
export interface WebSocketContext<TUser extends UserIdentity | null = UserIdentity> {
	/** Stable connection identity for application-owned local subscriptions. */
	readonly id: string;
	/** Authenticated account ID, derived from framework Auth rather than client data. */
	readonly userId: TUser extends UserIdentity ? string : null;
	/** Fresh account model for this action. */
	readonly user: TUser;
	/** Original upgrade request; HTTP route hooks do not run for this transport. */
	readonly request: IncomingMessage;
	/** Aborted as soon as the connection closes or shutdown starts. */
	readonly signal: AbortSignal;
	/** Sends JSON after fresh authentication and endpoint policy checks. Optional resource guard uses that same fresh context; false means closed or denied. */
	send(data: unknown, authorize?: (context: Omit<WebSocketContext<TUser>, 'send' | 'close'>) => boolean | Promise<boolean>): Promise<boolean>;
	/** Ends the connection normally. */
	close(): void;
}

/** Cleanup metadata; close handlers run without authenticated request context. */
export interface WebSocketClosed {
	id: string;
	userId: string | null;
	code: number;
}

/** Controller-style JSON endpoint. Authentication is required unless public access is explicit. */
export interface WebSocketEndpoint<TMessage = unknown, TUser extends UserIdentity | null = UserIdentity> {
	/** Authentication is required by default. Public endpoints explicitly opt out and always have null identity. */
	auth?: TUser extends UserIdentity ? 'required' : 'public';
	/** Additional resource/tenant authorization, rerun before each action and send. */
	authorize?(context: Omit<WebSocketContext<TUser>, 'send' | 'close'>): boolean | Promise<boolean>;
	/** Named channel policies on this shared endpoint. Anonymous endpoints cannot subscribe to private channels. */
	channels?: readonly WebSocketChannelDefinition[];
	/** Called once after authentication. May send initial application data. */
	open?(context: WebSocketContext<TUser>): void | Promise<void>;
	/** Validates untrusted JSON. Throwing closes with 1008; omitted messages remain unknown. */
	parse?(data: unknown): TMessage | Promise<TMessage>;
	/** Called sequentially for validated application messages in a fresh Auth context. */
	message?(context: WebSocketContext<TUser>, data: TMessage): void | Promise<void>;
	/** Releases application subscriptions. Must settle promptly and must not send data. */
	close?(context: WebSocketClosed): void | Promise<void>;
}

/** A non-user client, such as a machine agent, identified by the endpoint's own token check. */
export interface WebSocketPrincipal {
	/** Stable identity; a different ID on revalidation closes the connection. */
	readonly id: string;
}

/** Connection context for a token endpoint. There is no framework user; `principal` is what `authenticate` returned. */
export interface WebSocketTokenContext<TPrincipal extends WebSocketPrincipal = WebSocketPrincipal> extends Omit<WebSocketContext<null>, 'send'> {
	/** Freshly authenticated principal for this action. */
	readonly principal: TPrincipal;
	/** Sends JSON after the token and endpoint policy are checked again. */
	send(data: unknown, authorize?: (context: Omit<WebSocketTokenContext<TPrincipal>, 'send' | 'close'>) => boolean | Promise<boolean>): Promise<boolean>;
}

/**
 * Endpoint for machine or service clients that hold their own bearer token rather than a user session.
 * The first frame is `{ "type": "authenticate", "token": "..." }`; cookies are never read. Upgrades
 * without an Origin header are accepted because no ambient browser credential is involved; a present
 * Origin must still be allowed. Private channels are not available to principals.
 */
export interface WebSocketTokenEndpoint<TMessage = unknown, TPrincipal extends WebSocketPrincipal = WebSocketPrincipal> {
	auth: 'token';
	/** Resolves the bearer token. Rerun on every action, send and heartbeat; null rejects or revokes. */
	authenticate(token: string, request: IncomingMessage): TPrincipal | null | Promise<TPrincipal | null>;
	/** Additional policy, rerun with the fresh principal before each action and send. */
	authorize?(context: Omit<WebSocketTokenContext<TPrincipal>, 'send' | 'close'>): boolean | Promise<boolean>;
	/** Called once after authentication. */
	open?(context: WebSocketTokenContext<TPrincipal>): void | Promise<void>;
	/** Validates untrusted JSON. Throwing closes with 1008. */
	parse?(data: unknown): TMessage | Promise<TMessage>;
	/** Called sequentially for validated application messages. */
	message?(context: WebSocketTokenContext<TPrincipal>, data: TMessage): void | Promise<void>;
	/** Releases application state; `userId` is the principal ID. Must settle promptly and must not send data. */
	close?(context: WebSocketClosed): void | Promise<void>;
}
