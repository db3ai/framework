import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { App } from '../server/App';
import { WebSocketConnection } from './WebSocketConnection';
import { WebSocketChannels } from './WebSocketChannels';
import type * as socket from './contracts';

/** App-owned WebSocket endpoints on an existing Node HTTP/S listener. */
export class WebSockets {
	/** Process-local, server-authorized channels. Each delivery rechecks the connection's policy. */
	readonly channels = new WebSocketChannels();
	#close: (() => Promise<void>) | undefined;
	readonly #connections = new Map<WebSocketConnection, string>();
	readonly #presenceListeners = new Map<string, Set<() => void | Promise<void>>>();
	#closed = false;

	/** Configures worker HTTP delivery without opening a connection or starting a polling loop. */
	constructor(readonly app: App, readonly options: socket.WebSocketServiceOptions = {}) {
		if (options.publish) {
			const { url, token, timeoutMs = 5000 } = options.publish;
			const target = new URL(url);
			if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash || target.search) throw new Error('Use a trusted HTTP(S) publishing URL without credentials, query or fragment.');
			if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('WebSocket publish token must contain 32 to 256 URL-safe characters.');
			if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid WebSocket publish timeout.');
		}
	}

	/** Returns a publisher for a concrete authorized resource channel. No client subscription is created. */
	channel(name: string): socket.WebSocketChannelPublisher {
		if (name.length > 256 || !/^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)*$/.test(name)) throw new Error('Invalid channel name.');
		return { publish: async (event, data) => {
			if (!event || event.length > 256) throw new Error('Invalid channel event.');
			if (this.#closed) throw new Error('WebSocket service is closed.');
			const message = JSON.stringify({ channel: name, event, data });
			if (Buffer.byteLength(message) > 65536) throw new Error('WebSocket event exceeds 64 KiB.');
			if (!this.#close && this.options.publish) {
				const { url, token, timeoutMs = 5000 } = this.options.publish;
				const response = await fetch(url, {
					method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
					headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: message,
				});
				try {
					if (!response.ok) throw new Error(`WebSocket publishing failed (${response.status}).`);
					// HTTP acceptance is not a browser delivery receipt or a remote connection count.
					return 0;
				} finally { await response.body?.cancel(); }
			}
			return this.channels.publishEvent(name, event, data);
		} };
	}

	/**
	 * Mounts exact-path endpoint actions on one existing HTTP/S server.
	 * @param server - Host-owned listener; the service never opens or closes its port.
	 * @param options - Allowed origins, controller definitions and resource limits.
	 */
	mount(server: Server, options: socket.WebSocketOptions): void {
		if (this.#close) throw new Error('WebSockets are already mounted.');
		this.#closed = false;
		const origins = new Set(options.origins);
		if (!origins.size || [...origins].some(origin => { try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; } catch { return true; } })) throw new Error('WebSockets require exact HTTP(S) origins.');
		const endpoints = new Map(Object.entries(options.endpoints));
		for (const [path, endpoint] of endpoints) {
			if (!path.startsWith('/') || path.startsWith('//') || /[?#\s]/.test(path) || !endpoint || typeof endpoint !== 'object') throw new Error('Invalid WebSocket endpoint.');
		}
		const limits: socket.WebSocketLimits = { maxConnections: 1000, maxPayloadBytes: 65536, maxBufferedBytes: 262144, maxPendingMessages: 16, maxPendingSends: 32, authTimeoutMs: 5000, heartbeatMs: 30000, shutdownTimeoutMs: 3000 };
		for (const key of Object.keys(limits) as (keyof socket.WebSocketLimits)[]) {
			const value = options[key] ?? limits[key];
			if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid WebSocket limit: ${key}.`);
			limits[key] = value;
		}
		const connections = this.#connections;
		const sockets = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayloadBytes, perMessageDeflate: false });
		/** Contains reporting failures and keeps credentials out of transport diagnostics. */
		const report = (error: unknown): void => { try { options.onError?.(error); } catch { /* Reporting cannot break cleanup. */ } };
		let closing: Promise<void> | undefined;
		/** Handles only owned paths; other upgrade listeners retain ownership of their paths. */
		const upgrade = (request: IncomingMessage, stream: Duplex, head: Buffer): void => {
			let pathname: string;
			try { pathname = new URL(request.url ?? '/', 'http://localhost').pathname; } catch { stream.destroy(); return; }
			const endpoint = endpoints.get(pathname);
			if (!endpoint) {
				if (server.listenerCount('upgrade') === 1) stream.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
				return;
			}
			if (closing || !request.headers.origin || !origins.has(request.headers.origin) || connections.size >= limits.maxConnections) {
				stream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
				return;
			}
			sockets.handleUpgrade(request, stream, head, ws => {
				const connection = new WebSocketConnection(ws, request, this.app, endpoint, limits, report, () => {
					for (const listener of this.#presenceListeners.get(pathname) ?? []) {
						try { void Promise.resolve(this.app.requestContext.run(listener)).catch(report); } catch (error) { report(error); }
					}
				}, options.resolveToken);
				connections.set(connection, pathname);
				void connection.finished().then(() => connections.delete(connection));
			});
		};
		server.on('upgrade', upgrade);
		this.#close = () => closing ??= (async () => {
			const current = [...connections.keys()];
			for (const connection of current) connection.stop(1001);
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([Promise.all(current.map(connection => connection.finished())), new Promise<void>(resolve => { timer = setTimeout(resolve, limits.shutdownTimeoutMs); })]);
			} finally {
				clearTimeout(timer);
				for (const connection of current) connection.ws.terminate();
				connections.clear();
				this.#presenceListeners.clear();
				this.channels.clear();
				server.off('upgrade', upgrade);
				await new Promise<void>(resolve => sockets.close(() => resolve()));
				this.#close = undefined;
			}
		})();
	}

	/** Stops accepting upgrades and bounds socket/application cleanup; safe to call repeatedly. */
	async close(): Promise<void> { this.#closed = true; await this.#close?.(); }

	/**
	 * Lists distinct authenticated users connected to an exact endpoint in this process.
	 * Application code must authorize disclosure; this is never exposed automatically.
	 * Presence is approximate and excludes the other instance during blue/green overlap.
	 * @param path - Registered endpoint path, excluding query parameters.
	 * @returns Current user IDs and connection counts; no session tokens or profile data.
	 */
	presence(path: string): socket.WebSocketPresence[] {
		const users = new Map<string, number>();
		for (const [connection, endpoint] of this.#connections) {
			const id = connection.userId;
			if (endpoint === path && id) users.set(id, (users.get(id) ?? 0) + 1);
		}
		return [...users].map(([userId, connections]) => ({ userId, connections }));
	}

	/**
	 * Subscribes to local presence changes on one exact endpoint, without exposing them to browsers.
	 * Call presence(path) inside the listener to read current users. The listener has no Auth context
	 * and does not serialize asynchronous listeners; connection.send() reauthenticates its recipient.
	 * @param path - Exact endpoint whose authenticated connections should be observed.
	 * @param listener - Application callback for connect, disconnect or revocation changes.
	 * @returns Idempotent unsubscribe callback; register it on the owning connection's abort signal.
	 */
	onPresence(path: string, listener: () => void | Promise<void>): () => void {
		let listeners = this.#presenceListeners.get(path);
		if (!listeners) { listeners = new Set(); this.#presenceListeners.set(path, listeners); }
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (!listeners.size && this.#presenceListeners.get(path) === listeners) this.#presenceListeners.delete(path);
		};
	}
}
