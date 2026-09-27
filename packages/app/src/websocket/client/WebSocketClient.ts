import type { ClientSocket, WebSocketClientOptions, WebSocketClientState, WebSocketClientChannel } from '../contracts/WebSocketClient';

/** Browser-safe JSON transport with generation fencing, bounded reconnect and no offline message queue. */
export class WebSocketClient {
	#subscriptionQueue: string[] = [];
	#subscribing: string | undefined;
	readonly #channels = new Map<string, Map<string, Set<(data: unknown) => void>>>();
	#state: WebSocketClientState = 'closed';
	#socket: ClientSocket | undefined;
	#generation = 0;
	#attempt = 0;
	#stopped = true;
	#retry: ReturnType<typeof setTimeout> | undefined;
	#deadline: ReturnType<typeof setTimeout> | undefined;
	readonly #options: Required<Pick<WebSocketClientOptions, 'maxReconnectDelayMs' | 'connectTimeoutMs' | 'maxBufferedBytes'>> & WebSocketClientOptions;

	/** Validates configuration without opening a connection, allowing safe SSR imports. */
	constructor(options: WebSocketClientOptions) {
		const url = new URL(options.url);
		if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Use an absolute ws(s) URL without credentials or fragment.');
		this.#options = { maxReconnectDelayMs: 30000, connectTimeoutMs: 10000, maxBufferedBytes: 65536, ...options };
		for (const key of ['maxReconnectDelayMs', 'connectTimeoutMs', 'maxBufferedBytes'] as const) {
			if (!Number.isSafeInteger(this.#options[key]) || this.#options[key] <= 0) throw new Error(`Invalid WebSocket client option: ${key}.`);
		}
	}

	/** Current transport state; connected is set only after the server accepts the endpoint handshake. */
	get state(): WebSocketClientState { return this.#state; }

	/** Starts once, or explicitly retries after credentials/policy have been repaired. */
	connect(): void {
		if (!this.#stopped) return;
		this.#stopped = false;
		this.#attempt = 0;
		void this.#open();
	}

	/** Closes the socket, cancels reconnect and fences late token/network results. */
	close(): void {
		this.#stopped = true;
		this.#generation++;
		clearTimeout(this.#retry);
		clearTimeout(this.#deadline);
		this.#socket?.close(1000);
		this.#socket = undefined;
		this.#subscriptionQueue = [];
		this.#subscribing = undefined;
		this.#setState('closed');
	}

	/** Sends JSON only while connected; rejected messages are never queued or replayed. */
	send(data: unknown): boolean {
		if (this.#state !== 'connected' || this.#socket?.readyState !== 1 || data === undefined) return false;
		const frame = JSON.stringify({ type: 'message', data });
		if (new TextEncoder().encode(frame).length + this.#socket.bufferedAmount > this.#options.maxBufferedBytes) return false;
		this.#socket.send(frame);
		return true;
	}

	/**
	 * Returns a logical channel sharing this client's physical connection.
	 * The first listener subscribes; removing the final listener unsubscribes.
	 * @param name - Concrete resource channel; the server must independently authorize it.
	 */
	channel(name: string): WebSocketClientChannel {
		if (name.length > 256 || !/^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)*$/.test(name)) throw new Error('Invalid channel name.');
		return { on: (event, listener) => {
			if (!event || event.length > 256) throw new Error('Invalid channel event.');
			let events = this.#channels.get(name);
			const subscribe = !events;
			if (!events) { events = new Map(); this.#channels.set(name, events); }
			let listeners = events.get(event);
			if (!listeners) { listeners = new Set(); events.set(event, listeners); }
			// Each registration owns its own cleanup, even when callbacks are identical.
			const callback = (data: unknown) => listener(data);
			listeners.add(callback);
			if (subscribe && this.#state === 'connected') { this.#subscriptionQueue.push(name); this.#subscribeNext(); }
			return () => {
				if (!listeners.delete(callback)) return;
				if (!listeners.size) events.delete(event);
				if (!events.size) {
					this.#channels.delete(name);
					this.#subscriptionQueue = this.#subscriptionQueue.filter(channel => channel !== name);
					this.send({ type: 'channel.unsubscribe', channel: name });
				}
			};
		} };
	}

	/** Serializes subscriptions so a reconnect cannot flood the server's bounded action queue. */
	#subscribeNext(): void {
		if (this.#subscribing || this.#state !== 'connected') return;
		const channel = this.#subscriptionQueue.shift();
		if (!channel) return;
		this.#subscribing = channel;
		if (!this.send({ type: 'channel.subscribe', channel })) { this.#subscribing = undefined; this.#deny(); }
	}

	/** Dispatches reserved channel envelopes without exposing them as ordinary application messages. */
	#message(data: any): void {
		if (data && typeof data.channel === 'string' && typeof data.type === 'string' && data.type.startsWith('channel.')) {
			if (['channel.subscribed', 'channel.denied'].includes(data.type) && this.#subscribing === data.channel) { this.#subscribing = undefined; this.#subscribeNext(); }
			const events = this.#channels.get(data.channel);
			if (!events) return;
			if (data.type === 'channel.subscribed') this.#options.onSubscribed?.(data.channel);
			else if (data.type === 'channel.denied') this.#options.onChannelDenied?.(data.channel);
			else if (data.type === 'channel.event' && typeof data.event === 'string') {
				for (const listener of [...events.get(data.event) ?? []]) listener(data.data);
			}
			return;
		}
		this.#options.onMessage?.(data);
	}

	/** Creates one attempt and ignores callbacks from replaced connections. */
	async #open(): Promise<void> {
		const generation = ++this.#generation;
		this.#setState(this.#attempt ? 'reconnecting' : 'connecting');
		this.#deadline = setTimeout(() => {
			if (generation !== this.#generation || this.#stopped) return;
			this.#generation++;
			this.#socket?.close();
			this.#retryLater();
		}, this.#options.connectTimeoutMs);
		try {
			const auth = this.#options.auth ?? 'required';
			const token = auth === 'required' ? await this.#options.token?.() : null;
			if (generation !== this.#generation || this.#stopped) return;
			if (auth === 'required' && !token) { this.#deny(); return; }
			const factory = this.#options.createSocket ?? nativeSocket;
			const ws = factory(this.#options.url);
			this.#socket = ws;
			ws.onopen = () => { if (generation === this.#generation && !this.#stopped) ws.send(JSON.stringify(auth === 'public' ? { type: 'connect' } : { type: 'authenticate', token })); };
			ws.onmessage = event => {
				if (generation !== this.#generation || this.#stopped) return;
				let frame: any;
				try { frame = JSON.parse(String(event.data)); } catch { this.#deny(); return; }
				if (frame?.type === 'ready' && this.#state !== 'connected') {
					clearTimeout(this.#deadline);
					this.#attempt = 0;
					this.#subscriptionQueue = [...this.#channels.keys()];
					this.#subscribing = undefined;
					this.#setState('connected');
					this.#subscribeNext();
				} else if (frame?.type === 'message' && this.#state === 'connected') this.#message(frame.data);
				else this.#deny();
			};
			ws.onerror = () => { /* Native sockets report terminal failures through close. */ };
			ws.onclose = event => {
				if (generation !== this.#generation || this.#stopped) return;
				this.#generation++;
				clearTimeout(this.#deadline);
				if ([4401, 4403, 1003, 1007, 1008, 1009].includes(event.code)) this.#deny();
				else this.#retryLater();
			};
		} catch {
			if (generation !== this.#generation || this.#stopped) return;
			clearTimeout(this.#deadline);
			this.#retryLater();
		}
	}

	/** Stops retries on an authentication, policy or protocol failure until explicitly connected again. */
	#deny(): void { this.close(); this.#setState('denied'); }

	/** Retries transient failures with exponential backoff and jitter after blue/green shutdown. */
	#retryLater(): void {
		if (this.#stopped) return;
		if (this.#options.reconnect === false) { this.close(); return; }
		this.#setState('reconnecting');
		const ceiling = Math.min(this.#options.maxReconnectDelayMs, 500 * 2 ** Math.min(this.#attempt++, 16));
		this.#retry = setTimeout(() => void this.#open(), Math.max(1, Math.floor(ceiling * (0.5 + Math.random() * 0.5))));
	}

	/** Notifies state consumers only when the lifecycle actually changes. */
	#setState(state: WebSocketClientState): void {
		if (this.#state === state) return;
		this.#state = state;
		this.#options.onState?.(state);
	}
}

/** Resolves the native browser constructor only when connecting, keeping imports SSR-safe. */
function nativeSocket(url: string): ClientSocket {
	const Constructor = (globalThis as unknown as { WebSocket: new (url: string) => ClientSocket }).WebSocket;
	if (!Constructor) throw new Error('This runtime needs a WebSocket factory.');
	return new Constructor(url);
}
