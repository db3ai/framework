import {
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import type { Database } from '../../db';
import {
	Queue,
	QueueRetryLaterError,
	QueueableJob,
	type JobEnvelope,
	type QueueableJobFailureContext,
	type QueueableJobRetryContext,
	type QueueMonitorEvent,
	type QueueDriver,
	type QueueFailedJob,
	type QueueDriverPopOptions,
	type QueueDriverPushInput,
	type QueueJob,
	type QueueJobId,
} from '../index';

interface QueueableTestJobData extends Record<string, unknown> {
	message: string;
}

class QueueableTestJob extends QueueableJob<QueueableTestJobData> {
	static handled: string[] = [];

	/**
	 * Creates a test job after validating its runtime data.
	 *
	 * @param data - Runtime data persisted with the queue job.
	 */
	constructor(data: QueueableTestJobData) {
		if (typeof data.message !== 'string') {
			throw new Error('QueueableTestJob requires a message.');
		}

		super(data);
	}

	/**
	 * Records the message restored by the base queueable job contract.
	 */
	async handle(): Promise<void> {
		QueueableTestJob.handled.push(this.data.message);
	}
}

class QueueableDefaultChainJob extends QueueableTestJob {
	/**
	 * Adds a default follow-up job when no explicit chain is provided.
	 *
	 * @returns Queueable jobs to run after this job succeeds.
	 */
	protected override defaultChain(): QueueableJob[] {
		return [
			new QueueableTestJob({ message: 'Default child' }),
		];
	}
}

interface HookedQueueableJobData extends Record<string, unknown> {
	mode: 'fail' | 'defer';
}

/**
 * Queueable test job that records retry and terminal-failure hook behaviour.
 */
class HookedQueueableJob extends QueueableJob<HookedQueueableJobData> {
	static hooks: string[] = [];
	static failRetryHook = false;
	private attempted = false;

	/**
	 * Creates a hooked test job after validating its runtime mode.
	 *
	 * @param data - Runtime data persisted with the queue job.
	 */
	constructor(data: HookedQueueableJobData) {
		if (data.mode !== 'fail' && data.mode !== 'defer') {
			throw new Error('HookedQueueableJob requires a valid mode.');
		}

		super(data);
	}

	/**
	 * Raises the configured failure after marking this instance as attempted.
	 */
	async handle(): Promise<void> {
		this.attempted = true;

		if (this.data.mode === 'defer') {
			throw new QueueRetryLaterError(12, 'Wait for capacity.');
		}

		throw new Error('Hooked failure.');
	}

	/**
	 * Records a safely released attempt.
	 *
	 * @param context - Retry hook context.
	 */
	async onRetry(context: QueueableJobRetryContext): Promise<void> {
		if (HookedQueueableJob.failRetryHook) {
			throw new Error('Retry hook failed.');
		}

		HookedQueueableJob.hooks.push(`retry:${this.attempted}:${context.job.attempts}:${context.delaySeconds}`);
	}

	/**
	 * Records a terminally failed attempt.
	 *
	 * @param context - Terminal failure hook context.
	 */
	async onFinalFailure(context: QueueableJobFailureContext): Promise<void> {
		HookedQueueableJob.hooks.push(`final:${this.attempted}:${context.job.attempts}`);
	}

}

class MemoryQueueDriver implements QueueDriver {
	readonly name = 'memory';
	jobs: QueueJob[] = [];
	deleted: QueueJob[] = [];
	released: Array<{ job: QueueJob; delaySeconds: number }> = [];
	deferred: Array<{ job: QueueJob; delaySeconds: number }> = [];
	failed: Array<{ job: QueueJob; error: unknown }> = [];
	storedFailures: QueueFailedJob[] = [];
	touch: QueueDriver['touch'] = async job => {
		return this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));
	};
	private nextId = 1;

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

	async release(job: QueueJob, delaySeconds: number): Promise<boolean> {
		const storedJob = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!storedJob) return false;

		this.released.push({ job, delaySeconds });
		storedJob.attempts = job.attempts;

		return true;
	}

	/**
	 * Defers a rate-limited job while restoring the consumed pop attempt.
	 *
	 * @param job - Claimed queue job.
	 * @param delaySeconds - Seconds before the job should be available again.
	 */
	async defer(job: QueueJob, delaySeconds: number): Promise<boolean> {
		const restoredAttempts = Math.max(0, job.attempts - 1);
		const storedJob = this.jobs.find(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!storedJob) return false;

		const deferredJob = {
			job: {
				...job,
				attempts: restoredAttempts,
			},
			delaySeconds,
		};

		this.deferred.push(deferredJob);
		storedJob.attempts = restoredAttempts;

		return true;
	}

	async fail(job: QueueJob, error: unknown): Promise<boolean> {
		const owned = this.jobs.some(candidate => (
			candidate.id === job.id
			&& candidate.attempts === job.attempts
		));

		if (!owned) return false;

		this.failed.push({ job, error });
		this.jobs = this.jobs.filter(candidate => candidate.id !== job.id);

		return true;
	}

	/**
	 * Returns persisted failures configured by a queue service test.
	 *
	 * @param limit - Maximum failures requested by the queue monitor.
	 * @returns Configured persisted failures.
	 */
	async failedJobs(limit = 100): Promise<QueueFailedJob[]> {
		return this.storedFailures.slice(0, limit);
	}

	/**
	 * Returns one configured persisted failure by id.
	 *
	 * @param id - Failed-job identifier.
	 * @returns Matching persisted failure, or null.
	 */
	async failedJob(id: QueueJobId): Promise<QueueFailedJob | null> {
		return this.storedFailures.find(failure => String(failure.id) === String(id)) ?? null;
	}
}

function queueWith(driver: QueueDriver, options: ConstructorParameters<typeof Queue>[1] = {}): Queue {
	return new Queue({} as Database, {
		driver,
		...options,
	});
}

describe('Queue', () => {
	beforeEach(() => {
		QueueableTestJob.handled = [];
		HookedQueueableJob.hooks = [];
		HookedQueueableJob.failRetryHook = false;
	});

	it('dispatches jobs through the configured driver', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		const id = await queue.dispatch('send_email', { to: 'steve@example.com' }, {
			queue: 'mail',
			delaySeconds: 30,
			maxTries: 2,
		});

		expect(id).toBe(1);
		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0]).toMatchObject({
			id: 1,
			queue: 'mail',
			attempts: 0,
			payload: {
				displayName: 'send_email',
				job: 'send_email',
				maxTries: 2,
				data: {
					to: 'steve@example.com',
				},
			},
		});
		expect(driver.jobs[0].payload.uuid).toEqual(expect.any(String));
	});

	it('persists exponential retry policy and an absolute retry deadline', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		await queue.dispatch('durable_retry', {}, {
			maxTries: 10,
			backoff: {
				strategy: 'exponential',
				initialSeconds: 15,
				maxSeconds: 3600,
				jitter: true,
			},
			retryUntilSeconds: 86400,
		});

		expect(driver.jobs[0].payload).toMatchObject({
			maxTries: 10,
			backoff: {
				strategy: 'exponential',
				initialSeconds: 15,
				maxSeconds: 3600,
				jitter: true,
			},
			retryUntil: 1_700_086_400,
		});

		vi.mocked(Date.now).mockRestore();
	});

	it('dispatches queueable job instances and restores their data through the base class', async () => {
		const driver = new MemoryQueueDriver();
		const dispatchQueue = queueWith(driver);
		const workerQueue = queueWith(driver, {
			jobResolver: async ({ jobName }) => {
				return jobName === 'QueueableTestJob' ? QueueableTestJob : null;
			},
		});

		await dispatchQueue.dispatch(new QueueableTestJob({ message: 'Hello' }));

		expect(driver.jobs[0]).toMatchObject({
			payload: {
				displayName: 'QueueableTestJob',
				job: 'QueueableTestJob',
				data: {
					message: 'Hello',
				},
			},
		});

		const result = await workerQueue.workNextJob();

		expect(result?.status).toBe('succeeded');
		expect(QueueableTestJob.handled).toEqual(['Hello']);
	});

	it('renews a supported driver lease while a long-running handler is active', async () => {
		vi.useFakeTimers();

		try {
			const driver = new MemoryQueueDriver();
			const touch = vi.fn(async () => true);
			const queue = queueWith(driver, {
				retryAfterSeconds: 3,
			});
			let finishHandler: (() => void) | null = null;
			let markStarted: (() => void) | null = null;
			const started = new Promise<void>(resolve => {
				markStarted = resolve;
			});
			const handlerFinished = new Promise<void>(resolve => {
				finishHandler = resolve;
			});

			driver.touch = touch;
			queue.registerHandler('long_running', async () => {
				markStarted?.();
				await handlerFinished;
			});
			await queue.dispatch('long_running', {});

			const work = queue.workNextJob();

			await started;
			await vi.advanceTimersByTimeAsync(2000);

			expect(touch).toHaveBeenCalledTimes(2);
			expect(touch).toHaveBeenLastCalledWith(
				expect.objectContaining({
					id: 1,
					attempts: 1,
				}),
				3,
			);

			finishHandler?.();
			await work;

			const renewalsAfterCompletion = touch.mock.calls.length;

			await vi.advanceTimersByTimeAsync(3000);
			expect(touch).toHaveBeenCalledTimes(renewalsAfterCompletion);
		} finally {
			vi.useRealTimers();
		}
	});

	it('stops a stale attempt without deleting its newer durable owner', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const events: string[] = [];

		driver.touch = vi.fn(async () => false);
		queue.events.subscribe(event => {
			events.push(event.action);
		});
		await queue.chain([
			new QueueableTestJob({ message: 'Stale parent' }),
			new QueueableTestJob({ message: 'Must not dispatch' }),
		]);

		const result = await queue.workNextJob();

		expect(result).toMatchObject({
			status: 'lease_lost',
			job: {
				id: 1,
				attempts: 1,
			},
		});
		expect(result?.error).toEqual(expect.objectContaining({
			message: expect.stringContaining('refused to complete'),
		}));
		expect(driver.deleted).toHaveLength(0);
		expect(driver.jobs).toHaveLength(1);
		expect(QueueableTestJob.handled).toEqual(['Stale parent']);
		expect(events).toContain('lease_lost');
		expect(events).not.toContain('succeeded');
	});

	it.each([
		{
			name: 'completion',
			operation: 'delete',
		},
		{
			name: 'release',
			operation: 'release',
		},
		{
			name: 'deferral',
			operation: 'defer',
		},
		{
			name: 'terminal failure',
			operation: 'fail',
		},
	] as const)('reports lease loss when a stale $name mutation is rejected', async ({ name, operation }) => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const events: string[] = [];

		if (operation === 'delete') {
			vi.spyOn(driver, 'delete').mockResolvedValue(false);
		} else if (operation === 'release') {
			vi.spyOn(driver, 'release').mockResolvedValue(false);
		} else if (operation === 'defer') {
			vi.spyOn(driver, 'defer').mockResolvedValue(false);
		} else {
			vi.spyOn(driver, 'fail').mockResolvedValue(false);
		}

		queue.events.subscribe(event => {
			events.push(event.action);
		});
		queue.registerHandler(name, async () => {
			if (operation === 'defer') {
				throw new QueueRetryLaterError(5);
			}

			if (operation !== 'delete') {
				throw new Error(`${name} handler failure`);
			}
		});
		await queue.dispatch(name, {}, {
			maxTries: operation === 'fail' ? 1 : 3,
		});

		const result = await queue.workNextJob();

		expect(result?.status).toBe('lease_lost');
		expect(events).toContain('lease_lost');
		expect(events).not.toContain('succeeded');
		expect(events).not.toContain('released');
		expect(events).not.toContain('deferred');
		expect(events).not.toContain('failed');
	});

	it('dispatches queueable job chains one job at a time after success', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver, {
			jobResolver: async ({ jobName }) => {
				return jobName === 'QueueableTestJob' ? QueueableTestJob : null;
			},
		});

		await queue.chain([
			new QueueableTestJob({ message: 'First' }),
			new QueueableTestJob({ message: 'Second' }),
			new QueueableTestJob({ message: 'Third' }),
		]);

		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0].payload).toMatchObject({
			job: 'QueueableTestJob',
			data: {
				message: 'First',
			},
			chained: [
				{
					job: 'QueueableTestJob',
					data: {
						message: 'Second',
					},
				},
				{
					job: 'QueueableTestJob',
					data: {
						message: 'Third',
					},
				},
			],
		});

		await queue.workNextJob();
		await queue.workNextJob();
		await queue.workNextJob();

		expect(driver.jobs).toHaveLength(0);
		expect(driver.deleted).toHaveLength(3);
		expect(QueueableTestJob.handled).toEqual([
			'First',
			'Second',
			'Third',
		]);
	});

	it('serializes a queueable job default chain when dispatched directly', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		await queue.dispatch(new QueueableDefaultChainJob({ message: 'Root' }));

		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0].payload).toMatchObject({
			job: 'QueueableDefaultChainJob',
			data: {
				message: 'Root',
			},
			chained: [
				{
					job: 'QueueableTestJob',
					data: {
						message: 'Default child',
					},
				},
			],
		});
	});

	it('carries max tries from a completed job onto the next chained job', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		await queue.chain([
			new QueueableTestJob({ message: 'First' }),
			new QueueableTestJob({ message: 'Second' }),
		], {
			maxTries: 1,
		});

		await queue.workNextJob();

		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0].payload).toMatchObject({
			job: 'QueueableTestJob',
			maxTries: 1,
			data: {
				message: 'Second',
			},
		});
	});

	it('dispatches batches of queueable jobs', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		const ids = await queue.batch([
			new QueueableTestJob({ message: 'First' }),
			new QueueableTestJob({ message: 'Second' }),
		], {
			queue: 'analysis',
		});

		expect(ids).toEqual([1, 2]);
		expect(driver.jobs).toHaveLength(2);
		expect(driver.jobs.map(job => job.queue)).toEqual(['analysis', 'analysis']);
		expect(driver.jobs.map(job => job.payload.data)).toEqual([
			{
				message: 'First',
			},
			{
				message: 'Second',
			},
		]);
	});

	it('validates restored job data through the job constructor', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver, {
			jobResolver: async ({ jobName }) => {
				return jobName === 'QueueableTestJob' ? QueueableTestJob : null;
			},
		});

		await queue.dispatch('QueueableTestJob', {
			message: 123,
		});

		await expect(queue.workNextJob()).resolves.toMatchObject({
			status: 'released',
		});
	});

	it('processes a successful job and deletes it', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const handler = vi.fn(async () => {});

		queue.registerHandler('test_log', handler);
		await queue.dispatch('test_log', { message: 'Hello' });

		const result = await queue.workNextJob();

		expect(result?.status).toBe('succeeded');
		expect(handler).toHaveBeenCalledOnce();
		expect(driver.deleted).toHaveLength(1);
		expect(driver.jobs).toHaveLength(0);
	});

	it('emits queue monitor events for dispatch, claim, and success', async () => {
		const driver = new MemoryQueueDriver();
		const events: QueueMonitorEvent[] = [];
		const queue = queueWith(driver, {
			queueMonitor: {
				source: 'test',
				includePayload: true,
				dispatch: event => {
					events.push(event);
				},
			},
		});

		queue.registerHandler('test_log', async () => {});
		await queue.dispatch('test_log', { message: 'Hello' }, {
			origin: {
				type: 'test-run',
				id: 'run-1',
			},
		});

		const result = await queue.workNextJob();

		expect(result?.status).toBe('succeeded');
		expect(events.map(event => event.action)).toEqual([
			'dispatched',
			'claimed',
			'succeeded',
		]);
		expect(events[0]).toMatchObject({
			type: 'queue.job',
			source: 'test',
			action: 'dispatched',
			queue: 'default',
			jobName: 'test_log',
			payloadData: {
				message: 'Hello',
			},
			origin: {
				type: 'test-run',
				id: 'run-1',
			},
		});
		expect(events[2]?.durationMs).toEqual(expect.any(Number));
	});

	it('awaits asynchronous lifecycle listeners before returning', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		let releaseListener: (() => void) | undefined;
		let returned = false;

		queue.events.subscribe(async () => {
			await new Promise<void>(resolve => {
				releaseListener = resolve;
			});
		});

		const dispatch = queue.dispatch('test_log', { message: 'Hello' })
			.then(() => {
				returned = true;
			});

		await vi.waitFor(() => {
			expect(releaseListener).toBeTypeOf('function');
		});
		expect(returned).toBe(false);

		releaseListener?.();
		await dispatch;

		expect(returned).toBe(true);
	});

	it('isolates lifecycle listener failures from queue operations', async () => {
		const driver = new MemoryQueueDriver();
		const onLifecycleError = vi.fn();
		const queue = queueWith(driver, {
			onLifecycleError,
		});
		const observed = vi.fn();

		queue.events.subscribe(async () => {
			throw new Error('Listener failed.');
		});
		queue.events.subscribe(observed);

		await expect(queue.dispatch('test_log', { message: 'Hello' })).resolves.toBe(1);
		expect(observed).toHaveBeenCalledOnce();
		expect(onLifecycleError).toHaveBeenCalledWith(expect.objectContaining({
			source: 'listener',
			event: expect.objectContaining({
				action: 'dispatched',
			}),
			error: expect.any(Error),
		}));
	});

	it('returns persisted failures through the queue service', async () => {
		const driver = new MemoryQueueDriver();

		driver.storedFailures = [{
			id: 9,
			connection: 'memory',
			queue: 'default',
			payload: {
				uuid: 'persisted-job-uuid',
				displayName: 'PersistedJob',
				job: 'PersistedJob',
				maxTries: 3,
				data: {
					websiteId: 'website-1',
				},
			},
			exception: 'Persisted failure',
			failedAt: '2026-07-20T12:00:00.000Z',
		}];
		const queue = queueWith(driver);

		await expect(queue.failedJobs(1)).resolves.toEqual(driver.storedFailures);
	});

	it('replays a persisted failure without removing its audit record', async () => {
		const driver = new MemoryQueueDriver();

		driver.storedFailures = [{
			id: 9,
			connection: 'memory',
			queue: 'articles',
			payload: {
				uuid: 'failed-job-uuid',
				displayName: 'GenerateArticle',
				job: 'GenerateArticle',
				maxTries: 4,
				backoff: {
					strategy: 'exponential',
					initialSeconds: 30,
					maxSeconds: 600,
					jitter: true,
				},
				data: {
					contentPlanItemId: 'item-1',
				},
			},
			exception: 'Provider unavailable',
			failedAt: '2026-07-20T12:00:00.000Z',
		}];
		const queue = queueWith(driver);
		const replacementId = await queue.retryFailed(9);

		expect(replacementId).toBe(1);
		expect(driver.storedFailures).toHaveLength(1);
		expect(driver.jobs).toHaveLength(1);
		expect(driver.jobs[0]).toMatchObject({
			queue: 'articles',
			payload: {
				displayName: 'GenerateArticle',
				job: 'GenerateArticle',
				maxTries: 4,
				backoff: {
					strategy: 'exponential',
					initialSeconds: 30,
					maxSeconds: 600,
					jitter: true,
				},
				data: {
					contentPlanItemId: 'item-1',
				},
				retryOf: {
					failedJobId: 9,
					jobUuid: 'failed-job-uuid',
				},
			},
		});
		expect(driver.jobs[0].payload.uuid).not.toBe('failed-job-uuid');
	});

	it('rejects failed-job replay when the record does not exist', async () => {
		const queue = queueWith(new MemoryQueueDriver());

		await expect(queue.retryFailed(404)).rejects.toThrow('Failed queue job "404" was not found.');
	});

	it('returns no persisted failures when a driver does not expose inspection', async () => {
		const driver = new MemoryQueueDriver();

		driver.failedJobs = undefined;

		await expect(queueWith(driver).failedJobs()).resolves.toEqual([]);
	});

	it('notifies when a worker claims a job before handling it', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const claimed = vi.fn();
		const handler = vi.fn(async () => {
			expect(claimed).toHaveBeenCalledOnce();
		});

		queue.registerHandler('test_log', handler);
		await queue.dispatch('test_log', { message: 'Hello' });

		const result = await queue.workNextJob('default', {
			onClaimed: claimed,
		});

		expect(result?.status).toBe('succeeded');
		expect(claimed).toHaveBeenCalledWith(expect.objectContaining({
			id: 1,
			attempts: 1,
			payload: expect.objectContaining({
				job: 'test_log',
			}),
		}));
	});

	it('releases failed jobs until max tries, then records failure', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver, {
			retryDelaySeconds: 7,
		});

		queue.registerHandler('fragile_job', async () => {
			throw new Error('not today');
		});
		await queue.dispatch('fragile_job', {}, {
			maxTries: 2,
		});

		const first = await queue.workNextJob();
		const second = await queue.workNextJob();

		expect(first?.status).toBe('released');
		expect(first?.delaySeconds).toBe(7);
		expect(second?.status).toBe('failed');
		expect(driver.released).toHaveLength(1);
		expect(driver.failed).toHaveLength(1);
		expect(driver.jobs).toHaveLength(0);
	});

	it('uses capped exponential backoff for ordinary retries', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		queue.registerHandler('fragile_job', async () => {
			throw new Error('not today');
		});
		await queue.dispatch('fragile_job', {}, {
			maxTries: 4,
			backoff: {
				strategy: 'exponential',
				initialSeconds: 7,
				maxSeconds: 20,
				jitter: false,
			},
		});

		const first = await queue.workNextJob();
		const second = await queue.workNextJob();
		const third = await queue.workNextJob();
		const fourth = await queue.workNextJob();

		expect([
			first?.delaySeconds,
			second?.delaySeconds,
			third?.delaySeconds,
		]).toEqual([7, 14, 20]);
		expect(fourth?.status).toBe('failed');
	});

	it('applies equal jitter to an exponential retry delay', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);
		const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

		queue.registerHandler('jittered_job', async () => {
			throw new Error('not today');
		});
		await queue.dispatch('jittered_job', {}, {
			maxTries: 2,
			backoff: {
				strategy: 'exponential',
				initialSeconds: 100,
				maxSeconds: 1000,
				jitter: true,
			},
		});

		const first = await queue.workNextJob();

		expect(first?.delaySeconds).toBe(75);
		random.mockRestore();
	});

	it('fails terminally when the next retry would exceed its deadline', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
		queue.registerHandler('expired_retry_job', async () => {
			throw new Error('not today');
		});
		await queue.dispatch('expired_retry_job', {}, {
			maxTries: 10,
			backoff: {
				strategy: 'exponential',
				initialSeconds: 15,
				maxSeconds: 3600,
				jitter: false,
			},
			retryUntilSeconds: 10,
		});

		const result = await queue.workNextJob();

		expect(result?.status).toBe('failed');
		expect(driver.released).toHaveLength(0);
		expect(driver.failed).toHaveLength(1);

		vi.mocked(Date.now).mockRestore();
	});

	it('runs retry and final-failure hooks on the attempted job instance', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver, {
			retryDelaySeconds: 7,
		});

		await queue.dispatch(new HookedQueueableJob({ mode: 'fail' }), {
			maxTries: 2,
		});

		await expect(queue.workNextJob()).resolves.toMatchObject({
			status: 'released',
		});
		await expect(queue.workNextJob()).resolves.toMatchObject({
			status: 'failed',
		});

		expect(HookedQueueableJob.hooks).toEqual([
			'retry:true:1:7',
			'final:true:2',
		]);
	});

	it('does not run failure hooks for deliberate deferrals', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		await queue.dispatch(new HookedQueueableJob({ mode: 'defer' }), {
			maxTries: 1,
		});

		await expect(queue.workNextJob()).resolves.toMatchObject({
			status: 'deferred',
		});
		expect(HookedQueueableJob.hooks).toEqual([]);
	});

	it('reports hook failures without changing the committed retry', async () => {
		const driver = new MemoryQueueDriver();
		const onLifecycleError = vi.fn();
		const queue = queueWith(driver, {
			retryDelaySeconds: 3,
			onLifecycleError,
		});

		HookedQueueableJob.failRetryHook = true;
		await queue.dispatch(new HookedQueueableJob({ mode: 'fail' }), {
			maxTries: 2,
		});

		await expect(queue.workNextJob()).resolves.toMatchObject({
			status: 'released',
			delaySeconds: 3,
		});
		expect(driver.released).toHaveLength(1);
		expect(onLifecycleError).toHaveBeenCalledWith(expect.objectContaining({
			source: 'hook',
			hook: 'onRetry',
			event: expect.objectContaining({
				action: 'released',
			}),
		}));
	});

	it('defers retry-later jobs without consuming attempts', async () => {
		const driver = new MemoryQueueDriver();
		const queue = queueWith(driver);

		queue.registerHandler('rate_limited_job', async () => {
			throw new QueueRetryLaterError(42, 'Provider bucket is exhausted.');
		});
		await queue.dispatch('rate_limited_job', {}, {
			maxTries: 1,
		});

		const first = await queue.workNextJob();
		const second = await queue.workNextJob();

		expect(first?.status).toBe('deferred');
		expect(first?.delaySeconds).toBe(42);
		expect(first?.job.attempts).toBe(0);
		expect(second?.status).toBe('deferred');
		expect(second?.job.attempts).toBe(0);
		expect(driver.deferred).toHaveLength(2);
		expect(driver.failed).toHaveLength(0);
		expect(driver.jobs[0].attempts).toBe(0);
	});
});
