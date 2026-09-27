import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { App } from '../server/App';
import type { WebSocketOptions } from './contracts';

/**
 * Registers authenticated controller endpoints and closes upgraded sockets before Fastify drains HTTP.
 * @param server - Fastify server before listen(). HTTP route hooks do not authorize upgrades.
 * @param options - Application, exact origins, endpoints and optional limits.
 */
export function registerWebSockets(server: FastifyInstance, options: WebSocketOptions & { app: App }): void {
	options.app.webSockets.mount(server.server, options);
	if (options.publish) {
		const { path, token } = options.publish;
		if (!/^\/[A-Za-z0-9/_-]+$/.test(path) || path.startsWith('//')) throw new Error('Invalid WebSocket publishing path.');
		if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new Error('WebSocket publish token must contain 32 to 256 URL-safe characters.');
		const expected = createHash('sha256').update(`Bearer ${token}`).digest();
		server.post<{ Body: { channel: string; event: string; data?: unknown } }>(path, {
			bodyLimit: 65536,
			/** Service credentials are checked before parsing a body; browser/session credentials never authorize publication. */
			onRequest: async (request, reply) => {
				const supplied = createHash('sha256').update(request.headers.authorization ?? '').digest();
				if (request.headers.origin !== undefined || !timingSafeEqual(expected, supplied)) return reply.code(401).send({ error: 'Unauthorized' });
			},
			schema: { body: {
				type: 'object', required: ['channel', 'event'], additionalProperties: false,
				properties: {
					channel: { type: 'string', maxLength: 256, pattern: '^[a-zA-Z0-9_.-]+(:[a-zA-Z0-9_.-]+)*$' },
					event: { type: 'string', minLength: 1, maxLength: 256 }, data: {},
				},
			} },
		}, async (request, reply) => {
			// Deliver locally, never call the outbound HTTP publisher or relay recursively.
			await options.app.requestContext.run(() => options.app.webSockets.channels.publishEvent(request.body.channel, request.body.event, request.body.data));
			return reply.code(204).send();
		});
	}
	server.addHook('preClose', async () => { await options.app.webSockets.close(); });
}
