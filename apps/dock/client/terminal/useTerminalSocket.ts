import { onScopeDispose } from 'vue';

/**
 * Sends terminal keystrokes and sizes to the Dock server over one WebSocket,
 * reconnecting after drops. Messages sent while disconnected are queued (up to
 * a limit) so typing during a reconnect is not lost.
 *
 * @param url - Socket address; defaults to `/api/terminal` on this page's host.
 * @returns `input` and `resize` senders.
 */
export function useTerminalSocket(url = defaultUrl()) {
	let socket: WebSocket | null = null;
	let retry: ReturnType<typeof setTimeout> | null = null;
	let closed = false;
	const queue: string[] = [];

	function connect(): void {
		socket = new WebSocket(url);
		socket.onopen = () => {
			while (queue.length && socket?.readyState === WebSocket.OPEN) socket.send(queue.shift()!);
		};
		socket.onclose = () => {
			socket = null;
			if (!closed) retry = setTimeout(connect, 1000);
		};
	}

	function send(message: unknown): void {
		const text = JSON.stringify(message);
		if (socket?.readyState === WebSocket.OPEN) socket.send(text);
		else if (queue.length < 1000) queue.push(text);
	}

	connect();
	onScopeDispose(() => {
		closed = true;
		if (retry) clearTimeout(retry);
		socket?.close();
	});

	return {
		/** @param id - Process id. @param data - Raw keystrokes. */
		input: (id: string, data: string) => send({ type: 'input', id, data }),
		/** @param id - Process id. @param cols - Columns. @param rows - Rows. */
		resize: (id: string, cols: number, rows: number) => send({ type: 'resize', id, cols, rows }),
	};
}

function defaultUrl(): string {
	const { protocol, host } = globalThis.location ?? { protocol: 'http:', host: '127.0.0.1:8790' };
	return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/api/terminal`;
}
