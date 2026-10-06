import type { WebSocketEndpoint } from './WebSocketEndpoint';
import type { IncomingMessage } from 'node:http';

/** Mount configuration for one app-owned HTTP/S server. No additional port is opened. */
export interface WebSocketOptions {
	/** Optional service-authenticated HTTP publisher registered by the Fastify adapter. */
	publish?: {
		/** Exact private route path on this API; keep it off public reverse-proxy routes. */
		path: string;
		/** Dedicated server-only bearer secret matching worker configuration. */
		token: string;
	};
	/** Exact HTTP(S) origins allowed to upgrade. Missing origins are rejected. */
	origins: readonly string[];
	/** Exact paths to endpoint actions. Query parameters are available on request.url. */
	endpoints: Readonly<Record<string, WebSocketEndpoint<any, any>>>;
	/** Resolves an existing session from the upgrade request, e.g. an HttpOnly cookie. Origin checks still apply. Public endpoints never invoke this. */
	resolveToken?(request: IncomingMessage): string | null | Promise<string | null>;
	/** Maximum simultaneous sockets, including unauthenticated handshakes. Default 1000. */
	maxConnections?: number;
	/** Incoming and outgoing JSON frame limit in bytes. Default 64 KiB. */
	maxPayloadBytes?: number;
	/** Maximum queued outgoing bytes per client. Default 256 KiB. */
	maxBufferedBytes?: number;
	/** Maximum queued incoming actions per client. Default 16. */
	maxPendingMessages?: number;
	/** Maximum concurrent outgoing sends awaiting access checks per client. Overflow closes with retryable 1013. Default 32. */
	maxPendingSends?: number;
	/** Deadline for initial authentication. Default 5000 ms. */
	authTimeoutMs?: number;
	/** Ping and session/policy revalidation interval. Default 30000 ms. */
	heartbeatMs?: number;
	/** Bounded wait for connection cleanup at shutdown. Default 3000 ms. */
	shutdownTimeoutMs?: number;
	/** Server-only error reporting. Never receives authentication frames or raw tokens. */
	onError?(error: unknown): void;
}

/** Validated internal limits shared by the transport and its connections. */
export interface WebSocketLimits {
	maxConnections: number;
	maxPayloadBytes: number;
	maxBufferedBytes: number;
	maxPendingMessages: number;
	/** Includes authentication and resource authorization, before socket buffering begins. */
	maxPendingSends: number;
	authTimeoutMs: number;
	heartbeatMs: number;
	shutdownTimeoutMs: number;
}
