import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocketServer, type RawData } from 'ws';

import type { Dock } from './Dock.js';

/** Path the browser connects to for keystrokes and terminal sizes. */
export const TERMINAL_SOCKET_PATH = '/api/terminal';

const MAX_MESSAGE_BYTES = 256 * 1024;

/** A message from a terminal pane. */
export type TerminalMessage =
	| { type: 'input'; id: string; data: string }
	| { type: 'resize'; id: string; cols: number; rows: number };

/**
 * Accepts terminal input over a WebSocket on the Dock HTTP server.
 *
 * Output keeps flowing over the server-sent event stream; this socket carries
 * keystrokes and pane sizes, which must arrive quickly and in order. The upgrade
 * is refused unless both `Host` and `Origin` are loopback, as for the HTTP API.
 *
 * @param server - The Node HTTP server behind Fastify.
 * @param dock - The Dock to drive.
 * @param isLoopback - Origin check shared with the HTTP API.
 * @returns A function that closes the socket server.
 */
export function attachTerminalSocket(server: Server, dock: Dock, isLoopback: (origin: string) => boolean): () => void {
	const sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false });

	const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
		if (new URL(request.url ?? '/', 'http://localhost').pathname !== TERMINAL_SOCKET_PATH) return;
		const origin = request.headers.origin;
		if (!isLoopback(`http://${request.headers.host ?? ''}`) || (origin && !isLoopback(origin))) {
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
			return;
		}
		sockets.handleUpgrade(request, socket, head, client => {
			client.on('message', (raw: RawData) => {
				const message = parseTerminalMessage(raw.toString());
				if (!message) return;
				try {
					if (message.type === 'input') dock.write(message.id, message.data);
					else dock.resize(message.id, message.cols, message.rows);
				} catch {
					// Unknown or removed process: nothing to deliver to.
				}
			});
		});
	};

	server.on('upgrade', onUpgrade);
	return () => {
		server.off('upgrade', onUpgrade);
		for (const client of sockets.clients) client.terminate();
		sockets.close();
	};
}

/**
 * Validates a terminal message.
 *
 * @param text - JSON text from the socket.
 * @returns The message, or null when malformed.
 */
export function parseTerminalMessage(text: string): TerminalMessage | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!value || typeof value !== 'object') return null;
	const message = value as Record<string, unknown>;
	if (typeof message.id !== 'string' || !message.id) return null;
	if (message.type === 'input' && typeof message.data === 'string') return { type: 'input', id: message.id, data: message.data };
	if (message.type === 'resize' && Number.isFinite(message.cols) && Number.isFinite(message.rows)) {
		return { type: 'resize', id: message.id, cols: Number(message.cols), rows: Number(message.rows) };
	}
	return null;
}
