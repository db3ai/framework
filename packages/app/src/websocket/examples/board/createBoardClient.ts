import type { Pinia } from 'pinia';
import type { WebSocketClientOptions } from '@db3.ai/app/websocket/client';
import { createChannelSync } from '../createChannelSync';
import { createBoardStore, type BoardApi } from './createBoardStore';

/** Host-owned URLs and current bearer identity; create this once at browser application startup. */
export interface BoardClientOptions {
	baseUrl: string;
	boardId: string;
	pinia: Pinia;
	token(): string | null;
	/** Optional native-compatible socket factory for Node integration tests. */
	createSocket?: WebSocketClientOptions['createSocket'];
}

/**
 * Composes one authenticated HTTP adapter, Pinia store and shared socket for the board recipe.
 * Other features use sync.watch() on this same connection. Route unmount does not close it.
 * Call close() at logout or before replacing the authenticated identity.
 */
export function createBoardClient(options: BoardClientOptions) {
	const base = options.baseUrl.replace(/\/$/, '');
	/** Rejects unsuccessful HTTP responses before parsing their public snapshot. */
	async function request(method: string, suffix = '', body?: unknown): Promise<unknown> {
		const response = await fetch(`${base}/boards/${encodeURIComponent(options.boardId)}${suffix}`, {
			method, headers: { authorization: `Bearer ${options.token() ?? ''}`, 'content-type': 'application/json' },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.json();
	}
	const api: BoardApi = { read: () => request('GET'), move: input => request('PATCH', '', input), start: requestId => request('POST', '/summary', { requestId }) };
	const store = createBoardStore(options.boardId, api)(options.pinia);
	const socketUrl = new URL('/ws', base);
	socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
	const sync = createChannelSync({ url: socketUrl.href, token: options.token, createSocket: options.createSocket });
	const binding = sync.watch(`board:${options.boardId}`, api.read, store.apply, store.fail);
	sync.client.connect();
	return { store, sync, binding, api,
		/** Stop app-owned listeners and clear private state when identity changes or the app is disposed. */
		close() { sync.close(); store.dispose(); store.$dispose(); },
	};
}
