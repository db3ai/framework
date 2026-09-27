import Fastify from 'fastify';
import { Log, registerHttpExchangeMonitor } from '@db3.ai/app/logging';

const { tty, ...options } = JSON.parse(process.argv[2]);
Object.defineProperty(process.stdout, 'isTTY', { value: tty });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
const originalOut = process.stdout.write;
const originalErr = process.stderr.write;
const log = new Log({ devtools: false, level: 'info', ...options });
const server = Fastify({ loggerInstance: log.logger });
registerHttpExchangeMonitor(server, { environment: options.environment });
server.post('/hello', async request => ({ received: request.body, saved: true }));
try {
	log.info({ password: 'synthetic-secret', jobId: 'job-1' }, 'Worker ready');
	await server.inject({ method: 'POST', url: '/hello', payload: { user: 1234, password: 'synthetic-body-secret' } });
	log.error({ err: new Error('Provider unavailable') }, 'Job failed');
} finally {
	await server.close();
	await log.close();
}
if (process.stdout.write !== originalOut || process.stderr.write !== originalErr) throw new Error('Console streams were not restored');
