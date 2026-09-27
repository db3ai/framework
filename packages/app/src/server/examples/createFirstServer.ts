import Fastify, { type FastifyInstance } from 'fastify';
import { App, registerHttpErrorHandler } from '@db3.ai/app/server';
import { registerHealthRoute } from '@db3.ai/app/health/fastify';

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
	const application = new App({ config: { greeting }, health: { service: 'first-application' } });
	const server = Fastify();
	registerHttpErrorHandler(server);
	server.addHook('onClose', async () => { await application.close(); });
	registerHealthRoute(server, { app: application });
	server.get<{ Params: { name: string } }>('/hello/:name', {
		schema: { params: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 80 } } } },
	}, async request => application.requestContext.run(async () => {
		application.requestContext.set('requestId', request.id);
		return { message: `${application.config.get<string>('greeting')}, ${request.params.name}!` };
	}));
	return server;
}
