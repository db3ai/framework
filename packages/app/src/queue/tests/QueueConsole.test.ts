import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseQueueConsoleArgs, queueConsoleOptionNumber, queueConsoleWorkerProcessTitle, runQueueConsole } from '../index';

describe('queue console options', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('ignores blank numeric values instead of treating them as zero', () => {
		const parsed = parseQueueConsoleArgs(['queue:work', '--interval=']);
		const missing = parseQueueConsoleArgs(['queue:work']);

		expect(queueConsoleOptionNumber(parsed, 'interval')).toBeUndefined();
		expect(queueConsoleOptionNumber(missing, 'interval', '')).toBeUndefined();
	});

	it('parses numeric option values', () => {
		const parsed = parseQueueConsoleArgs(['queue:work', '--interval=5000', '--max-jobs', '3']);

		expect(queueConsoleOptionNumber(parsed, 'interval')).toBe(5000);
		expect(queueConsoleOptionNumber(parsed, 'max-jobs')).toBe(3);
	});

	it('defaults long-running worker process titles to queue-worker', () => {
		const previous = process.env.QUEUE_WORKER_NAME;

		delete process.env.QUEUE_WORKER_NAME;

		try {
			const parsed = parseQueueConsoleArgs(['queue:work']);

			expect(queueConsoleWorkerProcessTitle(parsed)).toBe('queue-worker');
		} finally {
			if (previous === undefined) {
				delete process.env.QUEUE_WORKER_NAME;
			} else {
				process.env.QUEUE_WORKER_NAME = previous;
			}
		}
	});

	it('uses explicit worker process names before environment defaults', () => {
		const previous = process.env.QUEUE_WORKER_NAME;

		process.env.QUEUE_WORKER_NAME = 'env-worker';

		try {
			const envParsed = parseQueueConsoleArgs(['queue:work']);
			const cliParsed = parseQueueConsoleArgs(['queue:work', '--name=cli-worker']);

			expect(queueConsoleWorkerProcessTitle(envParsed)).toBe('env-worker');
			expect(queueConsoleWorkerProcessTitle(cliParsed)).toBe('cli-worker');
		} finally {
			if (previous === undefined) {
				delete process.env.QUEUE_WORKER_NAME;
			} else {
				process.env.QUEUE_WORKER_NAME = previous;
			}
		}
	});

	it('replays a persisted failed job through the queue console', async () => {
		const retryFailed = vi.fn(async () => 10271);
		const close = vi.fn(async () => {});

		vi.spyOn(console, 'log').mockImplementation(() => {});

		await runQueueConsole({
			app: () => ({
				queue: {
					retryFailed,
				} as never,
				close,
			}),
		}, [
			'queue:retry',
			'206',
			'--queue=articles',
			'--tries=10',
		]);

		expect(retryFailed).toHaveBeenCalledWith('206', {
			queue: 'articles',
			delaySeconds: undefined,
			maxTries: 10,
		});
		expect(close).toHaveBeenCalledOnce();
	});
});
