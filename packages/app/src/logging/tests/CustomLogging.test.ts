import { describe, expect, it, vi } from 'vitest';
import { Log } from '../Log';
import type { LogTransport } from '../contracts';

describe('configured custom transports', () => {
	it('routes redacted child records at the configured level and owns flush/close exactly once', async () => {
		const records: Record<string, unknown>[] = [];
		const lifecycle: string[] = [];
		const create = vi.fn((): LogTransport => ({
			/** Records the already serialized output received by a provider. */
			write(line) { records.push(JSON.parse(line)); },
			/** Drains accepted records before shutdown. */
			async flush() { lifecycle.push('flush'); },
			/** Releases the destination. */
			async close() { lifecycle.push('close'); },
		}));
		const log = new Log({ level: 'info', transports: [{ type: 'custom', level: 'error', create }] });
		log.warn('excluded');
		log.child({ jobId: 'job-1' }).error({ err: new Error('failure'), password: 'PRIVATE' }, 'failed');
		await log.close();
		await log.close();
		expect(create).toHaveBeenCalledTimes(1);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ jobId: 'job-1', err: { message: 'failure', type: 'Error' } });
		expect(JSON.stringify(records)).not.toContain('PRIVATE');
		expect(lifecycle).toEqual(['flush', 'close']);
	});

	it('does not construct disabled destinations and isolates failures from other destinations', async () => {
		const disabled = vi.fn();
		const good = vi.fn();
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
		const log = new Log({ level: 'info', transports: [
			{ type: 'custom', level: 'silent', create: disabled },
			{ type: 'custom', create: () => ({
				/** Simulates a broken provider without leaking its message. */
				write() { throw new Error('PRIVATE'); },
				/** Simulates provider shutdown failure. */
				async flush() { throw new Error('PRIVATE'); },
				/** Simulates provider resource failure. */
				async close() { throw new Error('PRIVATE'); },
			}) },
			{ type: 'custom', create: () => ({ write: good, /** No pending records. */ async flush() {} }) },
		] });
		try {
			log.error('preserved');
			await log.close();
			expect(disabled).not.toHaveBeenCalled();
			expect(good).toHaveBeenCalledTimes(1);
			expect(good.mock.calls[0][0]).toContain('preserved');
			expect(stderr).toHaveBeenCalledTimes(3);
			expect(JSON.stringify(stderr.mock.calls)).not.toContain('PRIVATE');
		} finally { await log.close(); stderr.mockRestore(); }
		const silent = new Log({ level: 'silent', transports: [{ type: 'custom', create: disabled }] });
		await silent.close();
		expect(disabled).not.toHaveBeenCalled();
	});
});
