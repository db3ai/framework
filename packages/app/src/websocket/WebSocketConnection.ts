import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket, type RawData } from 'ws';
import type { App } from '../server/App';
import type { UserIdentity } from '../auth';
import type * as socket from './contracts';

/** One bounded JSON connection with fresh request authentication for application work. */
export class WebSocketConnection {
	readonly id = randomUUID();
	readonly #abort = new AbortController();
	#token = '';
	#userId = '';
	#ready = false;
	#pending = 0;
	/** Bounds retained payloads and concurrent access checks before transport buffering. */
	#pendingSends = 0;
	#chain: Promise<void> = Promise.resolve();
	#alive = true;
	#checking = false;
	#timer: ReturnType<typeof setTimeout>;
	#heartbeat: ReturnType<typeof setInterval>;
	#finished: Promise<void>;
	#finish!: () => void;

	/** Attaches listeners synchronously so early frames cannot bypass authentication. */
	constructor(readonly ws: WebSocket, readonly request: IncomingMessage, readonly app: App, readonly endpoint: socket.WebSocketEndpoint<any, any>, readonly limits: socket.WebSocketLimits, readonly report: (error: unknown) => void, readonly presenceChanged: () => void, readonly resolveToken?: socket.WebSocketOptions['resolveToken']) {
		this.#finished = new Promise(resolve => { this.#finish = resolve; });
		this.#abort.signal.addEventListener('abort', () => { if (this.#ready) this.presenceChanged(); }, { once: true });
		this.#timer = setTimeout(() => this.stop(4401), limits.authTimeoutMs);
		this.#heartbeat = setInterval(() => void this.#tick(), limits.heartbeatMs);
		this.#timer.unref();
		this.#heartbeat.unref();
		ws.on('pong', () => { this.#alive = true; });
		ws.on('error', () => this.stop(1011));
		ws.on('message', (data, binary) => this.#receive(data, binary));
		ws.once('close', code => {
			this.#abort.abort();
			this.#token = '';
			clearTimeout(this.#timer);
			clearInterval(this.#heartbeat);
			// Wait for open/message work before cleanup, including an open action that closed itself.
			void this.#chain.then(async () => {
				if (this.#ready) await this.endpoint.close?.({ id: this.id, userId: this.#userId || null, code });
			}).catch(this.report).finally(this.#finish);
		});
	}

	/** Stops delivery immediately and bounds the close handshake for unresponsive peers. */
	stop(code = 1000): void {
		if (this.#abort.signal.aborted) return;
		this.#abort.abort();
		clearTimeout(this.#timer);
		clearInterval(this.#heartbeat);
		this.ws.close(code);
		this.#timer = setTimeout(() => this.ws.terminate(), this.limits.shutdownTimeoutMs);
		this.#timer.unref();
	}

	/** Resolves when the socket and application cleanup are finished. */
	finished(): Promise<void> { return this.#finished; }

	/** Returns local presence only after authorization and until shutdown/disconnection. */
	get userId(): string | null { return this.#ready && !this.#abort.signal.aborted ? this.#userId : null; }

	/** Queues bounded text messages; the first frame is reserved for authentication. */
	#receive(data: RawData, binary: boolean): void {
		if (this.#abort.signal.aborted) return;
		if (binary) { this.stop(1003); return; }
		if (++this.#pending > this.limits.maxPendingMessages) { this.stop(1008); return; }
		const text = data.toString();
		this.#chain = this.#chain.then(async () => {
			if (this.#abort.signal.aborted) return;
			let frame: any;
			try { frame = JSON.parse(text); } catch { this.stop(1007); return; }
			if (!this.#ready) {
				if (this.endpoint.auth === 'public') {
					if (frame?.type !== 'connect') { this.stop(1008); return; }
				} else {
					if (frame?.type !== 'authenticate') { this.stop(4401); return; }
					const token = this.resolveToken ? await this.resolveToken(this.request) : frame.token;
					if (typeof token !== 'string' || !token || token.length > 4096) { this.stop(4401); return; }
					this.#token = token;
				}
				await this.#authorized(async context => {
					this.#ready = true;
					clearTimeout(this.#timer);
					this.#write({ type: 'ready' });
					this.presenceChanged();
					await this.endpoint.open?.(context);
				});
				return;
			}
			if (frame?.type !== 'message' || !Object.hasOwn(frame, 'data')) { this.stop(1008); return; }
			await this.#authorized(async context => {
				if (await this.app.webSockets.channels.handle(this.endpoint.channels ?? [], context, frame.data)) return;
				let data: unknown;
				try { data = this.endpoint.parse ? await this.endpoint.parse(frame.data) : frame.data; } catch { this.stop(1008); return; }
				if (!this.#abort.signal.aborted) await this.endpoint.message?.(context, data);
			});
		}).catch(error => { this.report(error); this.stop(1011); }).finally(() => { this.#pending--; });
	}

	/** Revalidates sessions and application access without retaining request-scoped Auth memoization. */
	async #authorized(action: (context: socket.WebSocketContext<any>) => Promise<void>): Promise<boolean> {
		if (this.#abort.signal.aborted) return false;
		return this.app.requestContext.run(async () => {
			const publicEndpoint = this.endpoint.auth === 'public';
			const user = publicEndpoint ? null : await this.app.auth.authenticateToken(this.#token);
			if (this.#abort.signal.aborted) return false;
			if (!publicEndpoint && !user) { this.stop(4401); return false; }
			const userId = user ? String(user.get((user.constructor as typeof UserIdentity).primaryKey)) : null;
			if (this.#userId && this.#userId !== userId) { this.stop(4401); return false; }
			this.#userId = userId ?? '';
			const context: socket.WebSocketContext<any> = {
				id: this.id, userId, user, request: this.request, signal: this.#abort.signal,
				send: (data, authorize) => this.#send(data, authorize), close: () => this.stop(),
			};
			if (this.endpoint.authorize && !await this.endpoint.authorize(context)) { this.stop(4403); return false; }
			if (this.#abort.signal.aborted) return false;
			await action(context);
			return true;
		});
	}

	/** Bounds in-flight sends before fresh access checks; overload disconnects without queuing or replay. */
	async #send(data: unknown, authorize?: Parameters<socket.WebSocketContext<any>['send']>[1]): Promise<boolean> {
		if (this.#abort.signal.aborted) return false;
		if (this.#pendingSends >= this.limits.maxPendingSends) { this.stop(1013); return false; }
		this.#pendingSends++;
		try {
			let sent = false;
			await this.#authorized(async context => {
				if (!authorize || await authorize(context)) sent = this.#write({ type: 'message', data });
			});
			return sent;
		} catch (error) { this.report(error); this.stop(1011); return false; }
		finally { this.#pendingSends--; }
	}

	/** Enforces frame and buffered-byte limits before handing data to the socket. */
	#write(frame: unknown): boolean {
		if (this.#abort.signal.aborted || this.ws.readyState !== WebSocket.OPEN) return false;
		const value = JSON.stringify(frame);
		const bytes = Buffer.byteLength(value);
		if (bytes > this.limits.maxPayloadBytes || this.ws.bufferedAmount + bytes > this.limits.maxBufferedBytes) { this.stop(1009); return false; }
		this.ws.send(value, error => { if (error) this.stop(1011); });
		return true;
	}

	/** Detects dead peers and revokes idle authenticated sockets as well as active ones. */
	async #tick(): Promise<void> {
		if (this.#abort.signal.aborted) return;
		if (!this.#alive || this.#checking) { this.stop(1011); return; }
		this.#alive = false;
		this.ws.ping();
		if (!this.#ready) return;
		this.#checking = true;
		try { await this.#authorized(async () => {}); } catch (error) { this.report(error); this.stop(1011); }
		finally { this.#checking = false; }
	}
}
