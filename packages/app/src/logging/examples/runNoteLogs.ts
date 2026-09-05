import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { Log, PinoLoggerDriver } from '@db3.ai/app/logging';

/**
 * Captures real structured logs and demonstrates child context and redaction.
 *
 * @returns Parsed records without unstable process/time fields for readable output.
 */
export async function runNoteLogs() {
	const chunks: string[] = [];
	const destination = new Writable({
		/** Captures complete Pino output using a real writable stream. */
		write(chunk, _encoding, callback) { chunks.push(chunk.toString()); callback(); },
	});
	const log = new Log({ driver: new PinoLoggerDriver({ level: 'info', environment: 'test', source: 'notes', console: false, devtools: false, redact: ['integration.apiKey'] }, destination) });
	try {
		const request = log.child({ requestId: 'request-1', ownerId: 'ada' });
		request.debug('Filtered diagnostic');
		request.info({ noteId: 'one', password: 'test-password', integration: { apiKey: 'test-provider-key' } }, 'Note saved');
		request.error({ err: new Error('Summary unavailable'), token: 'test-token' }, 'Summary failed');
		log.level = 'debug';
		log.debug({ component: 'notes' }, 'Diagnostics enabled');
		log.level = 'silent';
		log.error('Filtered after disabling');
		await log.flush();
		return chunks.join('').trim().split('\n').map(line => {
			const { time, pid, hostname, ...record } = JSON.parse(line);
			if (record.err) delete record.err.stack;
			return record;
		});
	} finally {
		await log.close();
		destination.end();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runNoteLogs(), null, 2));
