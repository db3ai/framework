import 'dotenv/config';

import { app } from './app.js';
import { ensureDatabaseSchema } from './schema.js';

const runtimeApp = app();

await ensureDatabaseSchema(runtimeApp.db);
void runtimeApp.flows;

const worker = runtimeApp.queue.startWorker('flows', {
	force: true,
	logger: console,
	verbose: true,
});

if (!worker) {
	throw new Error('Flow Lab queue worker could not be started.');
}

console.log('Flow Lab worker listening on queue "flows".');

/**
 * Stops queue polling and closes the application database connection.
 *
 * @param signal - Process signal initiating shutdown.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
	console.log(`Flow Lab worker received ${signal}; stopping.`);
	worker?.stop();
	await runtimeApp.close();
	process.exit(0);
}

process.once('SIGINT', () => {
	void shutdown('SIGINT');
});

process.once('SIGTERM', () => {
	void shutdown('SIGTERM');
});
