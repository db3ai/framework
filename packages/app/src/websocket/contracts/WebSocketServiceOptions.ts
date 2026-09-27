/** Optional worker-to-API HTTP delivery; browser connections remain owned by the API. */
export interface WebSocketServiceOptions {
	/** Used by publishers without a mounted WebSocket server. Mounted APIs deliver locally. */
	publish?: {
		/** Trusted absolute HTTP(S) endpoint; use HTTPS outside a private application network. */
		url: string;
		/** Server-only bearer secret, at least 32 characters. Never expose it to browsers. */
		token: string;
		/** Bounded connection and response deadline. Defaults to 5000 milliseconds. */
		timeoutMs?: number;
	};
}
