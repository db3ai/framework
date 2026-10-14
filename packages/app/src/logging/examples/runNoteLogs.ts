import { pathToFileURL } from 'node:url';
import { Log } from '@db3.ai/app/logging';

/**
 * Captures real structured logs and demonstrates child context and redaction.
 *
 * @returns Parsed records without unstable process/time fields for readable output.
 */
export async function runNoteLogs() {
	const chunks: string[] = [];
	const log = new Log({
		level: 'info', environment: 'test', source: 'notes', redact: ['integration.apiKey'],
		transports: [{ type: 'custom', level: 'trace', create: () => ({
			/** Receives complete redacted JSON lines; a provider may enqueue bounded asynchronous delivery. */
			write(line: string): void { chunks.push(line); },
			/** Memory writes finish synchronously; network providers drain accepted records here. */
			async flush(): Promise<void> {},
		}) }],
	});
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
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runNoteLogs(), null, 2));
