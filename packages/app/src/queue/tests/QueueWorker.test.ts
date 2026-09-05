import { describe, expect, it } from 'vitest';
import type { Database } from '../../db';
import { Queue, QueueableJob, type JobEnvelope, type QueueDriver, type QueueDriverPopOptions, type QueueDriverPushInput, type QueueJob, type QueueJobId, type QueueLogger } from '../index';

interface QueueableWorkerTestJobData extends Record<string, unknown> {
	message: string;
}

class QueueableWorkerTestJob extends QueueableJob<QueueableWorkerTestJobData> {
	static handled: string[] = [];

	/**
	 * Creates a worker test job after validating its runtime data.
	 *
	 * @param data - Runtime data persisted with the queue job.
	 */
	constructor(data: QueueableWorkerTestJobData) {
		if (typeof data.message !== 'string') {
			throw new Error('QueueableWorkerTestJob requires a message.');
		}

		super(data);
	}

	/**
	 * Records that this worker test job ran.
	 */
	async handle(): Promise<void> {
		QueueableWorkerTestJob.handled.push(this.data.message);
	}
}

class QueueableWorkerParentJob extends QueueableWorkerTestJob {
	/**
	 * Returns the child job that should follow this parent job.
	 *
	 * @returns Queueable jobs to run after this job succeeds.
	 */
	protected override defaultChain(): QueueableJob[] {
		return [
			new QueueableWorkerTestJob({ message: 'Child' }),
		];
	}
}

class MemoryQueueDriver implements QueueDriver {
	readonly name = 'memory';
	jobs: QueueJob[] = [];
	deleted: QueueJob[] = [];
	deferred: QueueJob[] = [];
	private nextId = 1;

	/**
	 * Stores a queued job in memory.
	 *
	 * @param job - Queue driver push input.
	 * @returns In-memory job id.
	 */
	async push<TData extends Record<string, unknown>>(
		job: QueueDriverPushInput<TData>,
	): Promise<QueueJobId> {
		const id = this.nextId;

		this.nextId += 1;
		this.jobs.push({
			id,
			queue: job.queue,
			attempts: 0,
			payload: job.payload as JobEnvelope<Record<string, unknown>>,
		});

		return id;
	}

	/**
	 * Claims the first queued in-memory job for a queue.
	 *
	 * @param queue - Queue name to inspect.
	 * @param options - Queue pop options.
	 * @returns Claimed queue job or null.
	 */
	async pop(queue: string, _options: QueueDriverPopOptions): Promise<QueueJob | null> {
		const job = this.jobs.find(candidate => candidate.queue === queue);

		if (!job) return null;

		job.attempts += 1;

		return {
			...job,
			payload: {
				...job.payload,
				data: {
					...job.payload.data,
				},
			},
		};
	}

	/**
	 * Renews an owned in-memory queue attempt.
	 *
	 * @param job - Claimed queue job.
	 * @returns True when the attempt still owns the job.
	 */
	async touch(job: QueueJob): Promise<boolean> {
		return this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));
	}

	/**
	 * Deletes a completed in-memory job.
	 *
	 * @param job - Queue job to delete.
	 * @returns True when the attempt owned and deleted the job.
	 */
	async delete(job: QueueJob): Promise<boolean> {
		const owned = this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!owned) return false;

		this.deleted.push(job);
		this.jobs = this.jobs.filter(candidate => candidate.id !== job.id);

		return true;
	}

	/**
	 * Releases a failed in-memory job for another attempt.
	 *
	 * @param job - Queue job to release.
	 * @returns True when the attempt owned and released the job.
	 */
	async release(job: QueueJob): Promise<boolean> {
		const storedJob = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!storedJob) return false;

		storedJob.attempts = job.attempts;

		return true;
	}

	/**
	 * Defers a rate-limited in-memory job without consuming an attempt.
	 *
	 * @param job - Queue job to defer.
	 * @param _delaySeconds - Seconds before the job becomes available again.
	 * @returns True when the attempt owned and deferred the job.
	 */
	async defer(job: QueueJob, _delaySeconds: number): Promise<boolean> {
		const storedJob = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!storedJob) return false;

		storedJob.attempts = Math.max(0, job.attempts - 1);
		this.deferred.push({
			...storedJob,
		});

		return true;
	}

	/**
	 * Removes a terminally failed in-memory job.
	 *
	 * @param job - Queue job to fail.
	 * @returns True when the attempt owned and failed the job.
	 */
	async fail(job: QueueJob): Promise<boolean> {
		const owned = this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!owned) return false;

		this.jobs = this.jobs.filter(candidate => candidate.id !== job.id);

		return true;
	}
}

/**
 * Creates a queue backed by the in-memory test driver.
 *
 * @param driver - Queue driver to use.
 * @returns Queue configured with the given driver.
 */
function queueWith(driver: QueueDriver): Queue {
	return new Queue({} as Database, {
		driver,
	});
}

/**
 * Creates a logger that stores every emitted message.
 *
 * @returns Logger and captured messages.
 */
function memoryLogger(): { logger: QueueLogger; messages: string[] } {
	const messages: string[] = [];

	return {
		messages,
		logger: {
			info: message => messages.push(message),
			warn: message => messages.push(message),
			error: message => messages.push(message),
		},
	};
}

/**
 * Waits until a log message containing text appears.
 *
 * @param messages - Captured logger messages.
 * @param text - Text expected in a message.
 */
async function waitForMessage(messages: string[], text: string): Promise<void> {
	const deadline = Date.now() + 500;

	while (Date.now() < deadline) {
		if (messages.some(message => message.includes(text))) return;

		await new Promise(resolve => setTimeout(resolve, 5));
	}

	throw new Error(`Timed out waiting for log message: ${text}`);
}

/**
 * Waits until a log message containing text has appeared a minimum number of times.
 *
 * @param messages - Captured logger messages.
 * @param text - Text expected in matching messages.
 * @param count - Minimum number of matching messages to wait for.
 */
async function waitForMessageCount(messages: string[], text: string, count: number): Promise<void> {
	const deadline = Date.now() + 1000;

	while (Date.now() < deadline) {
		const matches = messages.filter(message => message.includes(text));

		if (matches.length >= count) return;

		await new Promise(resolve => setTimeout(resolve, 5));
	}

	throw new Error(`Timed out waiting for ${count} log messages: ${text}`);
}

describe('QueueWorker', () => {
	it('logs every idle check and the next polling interval in verbose mode', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const { logger, messages } = memoryLogger();
		const worker = queue.startWorker('default', {
			force: true,
			intervalMs: 100,
			maxJobsPerTick: 5,
			logger,
			verbose: true,
		});

		expect(worker).not.toBeNull();

		try {
			await waitForMessageCount(messages, 'Idle on "default"; next check in 100ms.', 2);
		} finally {
			worker?.stop();
		}

		expect(messages).toContain('[queue] Worker started for "default" (interval 100ms, max 5 jobs/tick).');
	});

	it('normalizes unsafe timer options before starting the polling loop', () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const { logger, messages } = memoryLogger();
		const worker = queue.startWorker('default', {
			force: true,
			intervalMs: 0,
			maxJobsPerTick: 0,
			logger,
			verbose: true,
		});

		try {
			expect(worker).not.toBeNull();
			expect(messages[0]).toBe('[queue] Worker started for "default" (interval 1000ms, max 5 jobs/tick).');
		} finally {
			worker?.stop();
		}
	});

	it('logs payload keys and the next chained job in verbose mode', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const { logger, messages } = memoryLogger();

		await queue.dispatch(new QueueableWorkerParentJob({ message: 'Root' }));

		const worker = queue.startWorker('default', {
			force: true,
			intervalMs: 1000,
			maxJobsPerTick: 1,
			logger,
			verbose: true,
		});

		expect(worker).not.toBeNull();

		try {
			await waitForMessage(messages, 'Processed QueueableWorkerParentJob#1 on "default". Queued next QueueableWorkerTestJob.');
		} finally {
			worker?.stop();
		}

		expect(messages).toContain('[queue] Running QueueableWorkerParentJob#1; payload keys: message; next on success: QueueableWorkerTestJob.');
		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0].payload.job).toBe('QueueableWorkerTestJob');
	});

	it('waits for an active job before completing a graceful drain', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		let markStarted: (() => void) | undefined;
		let releaseJob: (() => void) | undefined;
		const started = new Promise<void>(resolve => {
			markStarted = resolve;
		});
		const blocked = new Promise<void>(resolve => {
			releaseJob = resolve;
		});

		queue.registerHandler('slow-test-job', async () => {
			markStarted?.();
			await blocked;
		});
		await queue.dispatch('slow-test-job', {});

		const worker = queue.startWorker('default', {
			force: true,
			intervalMs: 1000,
			maxJobsPerTick: 1,
		});

		expect(worker).not.toBeNull();
		await started;

		let drained = false;
		const drain = worker?.stopAndDrain().then(() => {
			drained = true;
		});

		await Promise.resolve();
		expect(drained).toBe(false);

		releaseJob?.();
		await drain;

		expect(drained).toBe(true);
		expect(driver.jobs).toEqual([]);
	});
});
