import { createFirstServer } from './createFirstServer';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const server = createFirstServer(process.env.GREETING ?? 'Hello');

/** Closes the listener and framework resources when the local process stops. */
async function shutdown(): Promise<void> {
	await server.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
	console.log(await server.listen({ port, host: '127.0.0.1' }));
} catch (error) {
	await server.close();
	throw error;
}
