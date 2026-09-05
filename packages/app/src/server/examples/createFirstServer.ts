import Fastify, { type FastifyInstance } from 'fastify';
import { App } from '@db3.ai/app/server';

/**
 * Creates a small HTTP application without opening a port or database.
 *
 * The caller owns listen/close, so the same app can serve requests in a process
 * or be exercised through Fastify.inject in an isolated test.
 *
 * @param greeting - Application-owned greeting, configurable at process boot.
 * @returns HTTP server with framework cleanup attached to its close lifecycle.
 */
export function createFirstServer(greeting = 'Hello'): FastifyInstance {
	const application = new App({ config: { greeting } });
	const server = Fastify();
	server.addHook('onClose', async () => { await application.close(); });
	server.get('/health', async () => ({ status: 'ready' }));
	server.get<{ Params: { name: string } }>('/hello/:name', {
		schema: { params: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } },
	}, async request => application.requestContext.run(async () => {
		application.requestContext.set('requestId', request.id);
		return { message: `${application.config.get<string>('greeting')}, ${request.params.name}!` };
	}));
	return server;
}
