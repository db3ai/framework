import { defineChannel, defineWebSocket, type WebSocketChannelContext } from '@db3.ai/app/websocket';

/**
 * Defines one authenticated endpoint for website jobs and private account notifications.
 * @param canAccessWebsite - App-owned policy checking current organization membership and website access.
 * @returns An endpoint to mount at /ws using the existing HTTP server and session.
 */
export function resourceChannels(canAccessWebsite: (context: WebSocketChannelContext) => boolean | Promise<boolean>) {
	return defineWebSocket({
		channels: [
			defineChannel('website:{websiteId}:jobs', { authorize: canAccessWebsite }),
			defineChannel('user:{userId}:notifications', {
				/** Only the authenticated account may subscribe to its notification events. */
				authorize: ({ userId, params }) => userId === params.userId,
			}),
		],
	});
}
