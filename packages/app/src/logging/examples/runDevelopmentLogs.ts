import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { Log, registerHttpExchangeMonitor } from '@db3.ai/app/logging';

/**
 * Demonstrates overlapping requests without a listening socket, database or provider.
 * Run with tsx in a terminal to see pending rows turn into completed payload blocks.
 */
export async function runDevelopmentLogs(): Promise<void> {
	const log = new Log({ environment: 'development', consoleFormat: 'pretty', devtools: false, source: 'demo' });
	const server = Fastify({ loggerInstance: log.logger as FastifyBaseLogger });
	registerHttpExchangeMonitor(server, { environment: 'development' });
	server.post('/api/v1/user', async (request, reply) => {
		await delay(1200);
		reply.code(201);
		return { id: 1234, name: 'Steve', created: true, input: request.body };
	});
	server.get('/api/v1/projects', async () => {
		await delay(300);
		return { projects: [{ id: 1, name: 'Example project' }], total: 1 };
	});
	try {
		log.info('Development console ready');
		await Promise.all([
			server.inject({ method: 'POST', url: '/api/v1/user', payload: { user: 1234 } }),
			server.inject('/api/v1/projects'),
			delay(600).then(() => { console.log('Client rebuilt successfully'); }),
		]);
	} finally {
		await server.close();
		await log.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runDevelopmentLogs();
