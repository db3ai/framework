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
