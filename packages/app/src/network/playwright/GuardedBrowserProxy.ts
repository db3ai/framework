import { randomBytes } from 'node:crypto';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { assertPublicUrl } from '../assertPublicUrl';
import { BlockedUrlError } from '../BlockedUrlError';
import { normalizedUrlHostname } from '../privateNetworkAddresses';
import { publicAddressLookup } from '../publicAddressLookup';

/** Internal connection policy; the browser adapter owns request attribution. */
interface ProxyOptions {
	allowPrivate?: boolean;
	requestTimeoutMs?: number;
	onBlocked: (url: string, error: BlockedUrlError) => void;
}

/**
 * Context-owned loopback proxy enforcing the destination of every browser socket.
 *
 * HTTP bodies stream without buffering. HTTPS remains end-to-end TLS through a
 * validated CONNECT tunnel, preserving browser certificates, cookies and origins.
 * Redirects create normal browser requests and cannot escape the proxy's policy.
 */
export class GuardedBrowserProxy {
	readonly #options: ProxyOptions;
	readonly #sockets = new Set<Duplex>();
	readonly #server = createServer();
	readonly #username = 'db3-browser';
	readonly #password = randomBytes(32).toString('hex');
	#closed = false;

	/** Creates an unstarted, isolated browser proxy. */
	constructor(options: ProxyOptions) {
		this.#options = options;
		this.#server.on('connection', socket => this.#track(socket));
		this.#server.on('request', (request, response) => { void this.#forward(request, response); });
		this.#server.on('connect', (request, socket, head) => { void this.#tunnel(request, socket, head); });
		this.#server.on('clientError', (_error, socket) => socket.destroy());
	}

	/**
	 * Starts the proxy on an ephemeral loopback port.
	 * @returns Chromium proxy options; the bypass rule includes loopback traffic.
	 */
	async start(): Promise<{ server: string; bypass: string; username: string; password: string }> {
		await new Promise<void>((resolve, reject) => {
			this.#server.once('error', reject);
			this.#server.listen(0, '127.0.0.1', () => {
				this.#server.off('error', reject);
				resolve();
			});
		});
		const address = this.#server.address();
		if (!address || typeof address === 'string') throw new Error('Browser proxy did not open a TCP port.');
		return { server: `http://127.0.0.1:${address.port}`, bypass: '<-loopback>', username: this.#username, password: this.#password };
	}

	/** Stops accepting requests and synchronously tears down every owned socket. */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		for (const socket of this.#sockets) socket.destroy();
		this.#server.close();
	}

	/**
	 * Registers socket cleanup and an inactivity timeout without buffering data.
	 * @param socket - Accepted browser socket or outgoing destination connection.
	 */
	#track(socket: Duplex): void {
		if (this.#closed) { socket.destroy(); return; }
		this.#sockets.add(socket);
		socket.once('close', () => this.#sockets.delete(socket));
		socket.on('error', () => socket.destroy());
		if ('setTimeout' in socket) (socket as Socket).setTimeout(this.#options.requestTimeoutMs ?? 30_000, () => socket.destroy());
	}

	/** Checks the per-context proxy credential supplied by Chromium. */
	#authorized(request: IncomingMessage): boolean {
		return request.headers['proxy-authorization'] === `Basic ${Buffer.from(`${this.#username}:${this.#password}`).toString('base64')}`;
	}

	/**
	 * Streams a normal HTTP proxy request through a validated connection.
	 * @param request - Browser's absolute-form request.
	 * @param response - Response streamed back to the browser.
	 */
	async #forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
		if (!this.#authorized(request)) {
			response.writeHead(407, { 'proxy-authenticate': 'Basic realm="db3-browser"' }).end();
			return;
		}
		const url = request.url ?? '';
		try {
			await assertPublicUrl(url, this.#options);
			const destination = new URL(url);
			if (destination.protocol !== 'http:') throw new BlockedUrlError('HTTPS browser requests must use a CONNECT tunnel.');
			if (this.#closed || response.destroyed) return;
			const headers: OutgoingHttpHeaders = { ...request.headers, host: destination.host };
			delete headers['proxy-authorization'];
			delete headers['proxy-connection'];
			const outgoing = httpRequest(destination, {
				method: request.method,
				headers,
				agent: false,
				lookup: this.#options.allowPrivate ? undefined : publicAddressLookup,
			}, upstream => {
				response.writeHead(upstream.statusCode ?? 502, upstream.headers);
				upstream.on('error', () => response.destroy());
				upstream.pipe(response);
			});
			outgoing.on('socket', socket => this.#track(socket));
			outgoing.on('error', error => {
				this.#reportBlocked(url, error);
				response.destroy();
			});
			request.on('aborted', () => outgoing.destroy());
			request.on('error', () => outgoing.destroy());
			response.on('close', () => outgoing.destroy());
			request.pipe(outgoing);
		} catch (error) {
			this.#reportBlocked(url, error);
			response.destroy();
		}
	}

	/**
	 * Opens a TLS tunnel only after validating its actual destination connection.
	 * @param request - Chromium CONNECT authority.
	 * @param browser - Browser side of the opaque tunnel.
	 * @param head - Bytes received with the CONNECT request.
	 */
	async #tunnel(request: IncomingMessage, browser: Duplex, head: Buffer): Promise<void> {
		if (!this.#authorized(request)) {
			browser.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="db3-browser"\r\nContent-Length: 0\r\n\r\n');
			return;
		}
		const url = `https://${request.url ?? ''}/`;
		try {
			await assertPublicUrl(url, this.#options);
			if (this.#closed || browser.destroyed) return;
			const destination = new URL(url);
			const upstream = connect({
				host: normalizedUrlHostname(destination.hostname),
				port: Number(destination.port || 443),
				lookup: this.#options.allowPrivate ? undefined : publicAddressLookup,
			});
			this.#track(upstream);
			browser.once('close', () => upstream.destroy());
			upstream.once('close', () => browser.destroy());
			upstream.on('error', error => {
				this.#reportBlocked(url, error);
				browser.destroy();
			});
			upstream.once('connect', () => {
				browser.write('HTTP/1.1 200 Connection Established\r\n\r\n');
				if (head.length) upstream.write(head);
				upstream.pipe(browser);
				browser.pipe(upstream);
			});
		} catch (error) {
			this.#reportBlocked(url, error);
			browser.destroy();
		}
	}

	/** Records policy refusals without allowing observer failures to escape I/O. */
	#reportBlocked(url: string, error: unknown): void {
		if (!(error instanceof BlockedUrlError)) return;
		try { this.#options.onBlocked(url, error); } catch { /* Observers cannot change network enforcement. */ }
	}
}
