import type { App } from '@db3.ai/app/server';
import { defineWebSocket } from '@db3.ai/app/websocket';

/**
 * Creates controller-style actions for the current user. No snapshots or persistence are implied.
 * @param application - The same app used to mount the endpoints.
 * @returns Copyable authenticated endpoint definition.
 */
export function userEndpoint(application: App) {
	return defineWebSocket({
		/** Sends only this connection's identity after framework authentication. */
		async open({ userId, send }) {
			await send({ type: 'hello', userId });
		},
		/** Validates an application command before the message action runs. */
		parse(data: unknown): { type: 'ping' | 'my-presence' } {
			if (!data || typeof data !== 'object' || !('type' in data) || !['ping', 'my-presence'].includes(String(data.type))) throw new Error('Unknown command.');
			return data as { type: 'ping' | 'my-presence' };
		},
		/** Handles commands; presence disclosure is limited to the authenticated account. */
		async message({ userId, send }, command) {
			await send(command.type === 'ping'
				? { type: 'pong' }
				: { type: 'my-presence', users: application.webSockets.presence('/ws/me').filter(user => user.userId === userId) });
		},
	});
}
