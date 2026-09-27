/** Browser-visible lifecycle; connected means accepted under the endpoint's authentication policy. */
export type WebSocketClientState = 'closed' | 'connecting' | 'connected' | 'reconnecting' | 'denied';

/** Minimal native browser socket surface, also usable by Node integration clients. */
export interface ClientSocket {
	readonly readyState: number;
	readonly bufferedAmount: number;
	onopen: ((event: any) => void) | null;
	/** Native implementations have different event types; the client reads only data. */
	onmessage: ((event: any) => void) | null;
	/** Native implementations have different event types; the client reads only code. */
	onclose: ((event: any) => void) | null;
	onerror: ((event: any) => void) | null;
	send(data: string): void;
	close(code?: number): void;
}

/** Options for the small JSON client. Incoming application data remains untrusted/unknown. */
export interface WebSocketClientOptions {
	/** Absolute ws(s) URL. Production applications must use wss. */
	url: string;
	/** Reads the existing bearer session afresh on every connection attempt. Never put it in the URL. */
	token?(): string | null | Promise<string | null>;
	/** Must match the endpoint: required (default), cookie (server token resolver), or public. */
	auth?: 'required' | 'cookie' | 'public';
	onMessage?(data: unknown): void;
	/** Called after each successful subscription, including reconnect; reload durable state here. */
	onSubscribed?(channel: string): void;
	/** Called when a requested channel is unknown, ambiguous, denied or exceeds the subscription limit. */
	onChannelDenied?(channel: string): void;
	onState?(state: WebSocketClientState): void;
	/** Defaults to true; authentication/policy denial and protocol failures never auto-retry. */
	reconnect?: boolean;
	/** Maximum delay between reconnect attempts. Default 30000 ms. */
	maxReconnectDelayMs?: number;
	/** Deadline including token acquisition, socket opening and server authentication. Default 10000 ms. */
	connectTimeoutMs?: number;
	/** Outgoing frame/queue limit. Default 64 KiB. */
	maxBufferedBytes?: number;
	/** Optional native-compatible factory for non-browser runtimes. */
	createSocket?(url: string): ClientSocket;
}

/** Browser-side view of one logical channel on a shared connection. */
export interface WebSocketClientChannel {
	/** Adds a listener and subscribes on first use. Returns idempotent listener cleanup. Payloads require app validation. */
	on(event: string, listener: (data: unknown) => void): () => void;
}
