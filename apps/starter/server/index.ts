import { fileURLToPath } from 'node:url';
import staticFiles from '@fastify/static';
import { createApplication } from './app';
import { readConfig } from './config';
import { createServer } from './http/createServer';

const config = readConfig();
const application = createApplication(config);
const server = await createServer(application, config);
server.addHook('onClose', async () => { await application.close(); });
if (config.production) {
	await server.register(staticFiles, { root: fileURLToPath(new URL('../dist', import.meta.url)) });
	server.setNotFoundHandler((request, reply) => {
		if (request.url.startsWith('/api/')) return reply.code(404).send({ message: 'Route not found.' });
		return reply.sendFile('index.html');
	});
}

/** Drains HTTP work and closes framework services before stopping. */
async function shutdown() { await server.close(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
	await server.listen({ host: config.host, port: config.port });
	console.log(`DB3 API ready. Open ${config.origin}`);
} catch {
	console.error('Could not start. Check HOST, PORT and database configuration.');
	await server.close();
	process.exitCode = 1;
}
