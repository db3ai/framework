import type { WebSocketContext } from './WebSocketEndpoint';

/** Current authenticated context and parameters extracted from a channel name. */
export type WebSocketChannelContext = Omit<WebSocketContext, 'send' | 'close'> & {
	/** Concrete requested channel, never trusted as proof of access. */
	readonly channel: string;
	/** Colon-delimited parameters matched by the server's definition. */
	readonly params: Readonly<Record<string, string>>;
};

/** Application policy for a named resource channel. All subscriptions require authorization. */
export interface WebSocketChannelDefinition {
	/** Pattern such as website:{websiteId}:jobs. */
	readonly pattern: string;
	/** Pure access check, evaluated on subscription and before every delivery. */
	authorize(context: WebSocketChannelContext): boolean | Promise<boolean>;
}

/** Server publisher for a concrete channel, including configured worker-to-API HTTP delivery. */
export interface WebSocketChannelPublisher {
	/** Returns accepted local sends, or zero after remote HTTP acceptance. Never a browser delivery receipt. */
	publish(event: string, data: unknown): Promise<number>;
}
