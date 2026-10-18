import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { createClient, type RedisClientOptions } from '@redis/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../../db';
import { Queue, RedisQueueDriver, type JobEnvelope, type QueueJob } from '../../index';
import type * as queue from '../../index';
import { queueSelectionContract } from '../support/queueSelectionContract';

const redisOptions = redisTestOptions();
const redisAvailable = await canConnect(redisOptions.host, redisOptions.port);
const redisRequired = process.env.TEST_REDIS_REQUIRED === '1';

if (redisRequired && !redisAvailable) {
	throw new Error(
		`Redis queue integration tests require Redis at ${redisOptions.host}:${redisOptions.port}, but no server accepted the connection.`,
	);
}

const describeRedis = redisAvailable ? describe : describe.skip;

describeRedis('RedisQueueDriver', () => {
	describe('worker selection conformance', () => {
		let prefix: string;
		let driver: RedisQueueDriver;
		beforeEach(() => { prefix = `${testKeyPrefix()}[literal]`; driver = testDriver(prefix); });
		afterEach(async () => { await driver?.close(); await clearRedisPrefix(prefix); });
		queueSelectionContract(() => new Queue({} as Database, { driver, queueMonitor: false }));
	});
	describe('blocking idle waiting', () => {
		let prefix: string;
		let driver: RedisQueueDriver;
		let cancellation: AbortController;
		beforeEach(() => { prefix = testKeyPrefix(); driver = testDriver(prefix); cancellation = new AbortController(); });
		afterEach(async () => { cancellation.abort(); await driver.close(); await clearRedisPrefix(prefix); });

		it('broadcasts a dispatch to simultaneous blocked readers without claiming jobs', async () => {
			const waits = [driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal }), driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal })];
			try {
				await expect.poll(() => blockedWaitCount(prefix)).toBe(2);
				await driver.push({ queue: 'default', payload: testPayload('WakeJob'), delaySeconds: 0, createdAt: unixTimestamp() });
				await Promise.all(waits);
				expect((await driver.pop('default', { retryAfterSeconds: 90 }))?.attempts).toBe(1);
				expect(await driver.pop('default', { retryAfterSeconds: 90 })).toBeNull();
			} finally { cancellation.abort(); await Promise.allSettled(waits); }
		});

		it('detects work published before waiting and honors a bounded empty wait', async () => {
			await driver.push({ queue: 'default', payload: testPayload('ExistingJob'), delaySeconds: 0, createdAt: unixTimestamp() });
			await driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal });
			const job = await driver.pop('default', { retryAfterSeconds: 90 });
			await driver.delete(job!);
			const start = Date.now();
			await driver.waitForWork({ queues: ['default'] }, { timeoutMs: 100, signal: cancellation.signal });
			expect(Date.now() - start).toBeGreaterThanOrEqual(90);
			expect(Date.now() - start).toBeLessThan(2000);
		});

		it('wakes at delayed-job and expired-reservation deadlines without another push', async () => {
			await driver.push({ queue: 'default', payload: testPayload('DelayedWake'), delaySeconds: 1, createdAt: unixTimestamp() });
			await driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal });
			const job = await driver.pop('default', { retryAfterSeconds: 1 });
			expect(job).not.toBeNull();
			await driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal });
			const reclaimed = await driver.pop('default', { retryAfterSeconds: 90 });
			expect(reclaimed).toMatchObject({ id: job!.id, attempts: 2 });
		});

		it('wakes blocked readers when an owned job is released or deferred', async () => {
			await driver.push({ queue: 'default', payload: testPayload('RescheduledWake'), delaySeconds: 0, createdAt: unixTimestamp() });
			let job = (await driver.pop('default', { retryAfterSeconds: 90 }))!;
			for (const action of ['release', 'defer'] as const) {
				const waiting = driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal });
				try {
					await expect.poll(() => blockedWaitCount(prefix)).toBe(1);
					expect(await driver[action](job, 0)).toBe(true);
					await waiting;
					job = (await driver.pop('default', { retryAfterSeconds: 90 }))!;
					expect(job).not.toBeNull();
				} finally { if (!job) cancellation.abort(); }
			}
		});

		it('keeps idle workers blocked, starts four slots promptly and preserves exclusions', async () => {
			const manager = new Queue({} as Database, { driver, queueMonitor: false });
			const pop = vi.spyOn(driver, 'pop');
			const handled: string[] = [];
			let release!: () => void;
			const gate = new Promise<void>(resolve => { release = resolve; });
			manager.registerHandler('SlotJob', async job => { handled.push(String(job.id)); await gate; });
			const worker = manager.startWorker({ queues: '*', excludeQueues: ['images'], concurrency: 4, intervalMs: 5000 }, { force: true })!;
			try {
				await expect.poll(() => blockedWaitCount(prefix)).toBe(4);
				const calls = pop.mock.calls.length;
				await delay(350);
				expect(pop.mock.calls.length).toBe(calls);
				await manager.dispatch('SlotJob', {}, { queue: 'images' });
				await expect.poll(() => blockedWaitCount(prefix)).toBe(4);
				expect(handled).toHaveLength(0);
				for (let i = 0; i < 4; i++) await manager.dispatch('SlotJob', {}, { queue: 'new-queue' });
				await expect.poll(() => handled.length, { timeout: 2000 }).toBe(4);
				expect(new Set(handled).size).toBe(4);
				release();
				await expect.poll(() => blockedWaitCount(prefix)).toBe(4);
				const stopped = Date.now();
				await worker.stopAndDrain();
				expect(Date.now() - stopped).toBeLessThan(1000);
				expect(await blockedWaitCount(prefix)).toBe(0);
				expect(await driver.pop('images', { retryAfterSeconds: 90 })).not.toBeNull();
			} finally { release(); await worker.stopAndDrain(); pop.mockRestore(); }
		});

		it('backs off and reconnects after a blocking socket is disconnected', async () => {
			const errors: string[] = [];
			const manager = new Queue({} as Database, { driver, queueMonitor: false });
			const handled: string[] = [];
			manager.registerHandler('ReconnectJob', async job => { handled.push(String(job.id)); });
			const worker = manager.startWorker('default', { force: true, intervalMs: 100, logger: { info: () => {}, error: message => { errors.push(message); } } })!;
			const client = createClient(redisClientOptions());
			client.on('error', (): void => {});
			await client.connect();
			try {
				await expect.poll(() => blockedWaitCount(prefix)).toBe(1);
				const clients = await client.sendCommand<string>(['CLIENT', 'LIST']);
				const line = clients.split('\n').find(value => value.includes(`name=${prefix}:wait `))!;
				const id = line.match(/(?:^| )id=(\d+)/)![1]!;
				await client.sendCommand(['CLIENT', 'KILL', 'ID', id]);
				await expect.poll(() => errors.length).toBe(1);
				await expect.poll(() => blockedWaitCount(prefix)).toBe(1);
				await manager.dispatch('ReconnectJob', {});
				await expect.poll(() => handled.length).toBe(1);
			} finally { await worker.stopAndDrain(); await client.close(); }
		});

		it('closes an idle blocking connection immediately on cancellation', async () => {
			const waiting = driver.waitForWork({ queues: ['default'] }, { signal: cancellation.signal });
			try {
				await expect.poll(() => blockedWaitCount(prefix)).toBe(1);
				cancellation.abort();
				await waiting;
				expect(await blockedWaitCount(prefix)).toBe(0);
			} finally { cancellation.abort(); await waiting; }
		});
	});

	it('finds owned work in delayed, reserved and nested chained payloads without matching application data', async () => {
		const keyPrefix = testKeyPrefix(); const driver = testDriver(keyPrefix);
		try {
			expect(await driver.hasPendingJobs('social.')).toBe(false);
			const payload = testPayload('host.prepare', { job: 'crm.private-data' });
			payload.chained = [{ job: 'host.step', data: {}, chained: [{ job: 'social.review', data: {} }] }];
			await driver.push({ queue: 'default', payload, delaySeconds: 60, createdAt: unixTimestamp() - 61 });
			expect(await driver.hasPendingJobs('social.')).toBe(true);
			expect(await driver.hasPendingJobs('crm.')).toBe(false);
			const job = await driver.pop('default', { retryAfterSeconds: 90 });
			expect(await driver.hasPendingJobs('social.')).toBe(true);
			await driver.delete(job!);
			expect(await driver.hasPendingJobs('social.')).toBe(false);
		} finally { await driver.close(); await clearRedisPrefix(keyPrefix); }
	});

	it('pushes and claims immediate jobs', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);

		try {
			const id = await driver.push({
				queue: 'default',
				payload: testPayload('ImmediateJob', {
					message: 'Hello Redis',
				}),
				delaySeconds: 0,
				createdAt: unixTimestamp(),
			});
			const job = await driver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(id).toEqual(expect.any(String));
			expect(job).toMatchObject({
				id,
				queue: 'default',
				attempts: 1,
				payload: {
					job: 'ImmediateJob',
					data: {
						message: 'Hello Redis',
					},
				},
			});

			await driver.delete(job as QueueJob);

			expect(await driver.pop('default', {
				retryAfterSeconds: 90,
			})).toBeNull();
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});

	it('keeps delayed jobs unavailable until their score is due', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);

		try {
			await driver.push({
				queue: 'default',
				payload: testPayload('DelayedJob'),
				delaySeconds: 60,
				createdAt: unixTimestamp(),
			});

			expect(await driver.pop('default', {
				retryAfterSeconds: 90,
			})).toBeNull();
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});

	it('renews only the current Redis queue attempt', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);

		try {
			await driver.push({
				queue: 'default',
				payload: testPayload('HeartbeatJob'),
				delaySeconds: 0,
				createdAt: unixTimestamp(),
			});

			const job = await driver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(job).not.toBeNull();
			await expect(driver.touch(job as QueueJob, 90)).resolves.toBe(true);
			await expect(driver.touch({
				...(job as QueueJob),
				attempts: 2,
			}, 90)).resolves.toBe(false);
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});

	it('refuses terminal mutations from a stale Redis queue attempt', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);

		try {
			await driver.push({
				queue: 'default',
				payload: testPayload('FencedJob'),
				delaySeconds: 0,
				createdAt: unixTimestamp(),
			});

			const firstAttempt = await driver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(firstAttempt).not.toBeNull();
			await expect(driver.release(firstAttempt as QueueJob, 0)).resolves.toBe(true);

			const secondAttempt = await driver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(secondAttempt).toMatchObject({
				attempts: 2,
			});
			await expect(driver.delete(firstAttempt as QueueJob)).resolves.toBe(false);
			await expect(driver.release(firstAttempt as QueueJob, 0)).resolves.toBe(false);
			await expect(driver.defer(firstAttempt as QueueJob, 0)).resolves.toBe(false);
			await expect(driver.fail(firstAttempt as QueueJob, new Error('Stale failure'))).resolves.toBe(false);
			await expect(driver.touch(secondAttempt as QueueJob, 90)).resolves.toBe(true);
			await expect(driver.failedJobs()).resolves.toHaveLength(0);
			await expect(driver.delete(secondAttempt as QueueJob)).resolves.toBe(true);
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});

	it('releases and defers jobs with the expected attempt counts', async () => {
		const releaseKeyPrefix = testKeyPrefix();
		const deferKeyPrefix = testKeyPrefix();
		const releaseDriver = testDriver(releaseKeyPrefix);
		const deferDriver = testDriver(deferKeyPrefix);

		try {
			await releaseDriver.push({
				queue: 'default',
				payload: testPayload('ReleaseJob'),
				delaySeconds: 0,
				createdAt: unixTimestamp(),
			});

			const releasedFirst = await releaseDriver.pop('default', {
				retryAfterSeconds: 90,
			});

			await expect(releaseDriver.release(releasedFirst as QueueJob, 0)).resolves.toBe(true);

			const releasedSecond = await releaseDriver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(releasedFirst?.attempts).toBe(1);
			expect(releasedSecond?.attempts).toBe(2);

			await deferDriver.push({
				queue: 'default',
				payload: testPayload('DeferredJob'),
				delaySeconds: 0,
				createdAt: unixTimestamp(),
			});

			const deferredFirst = await deferDriver.pop('default', {
				retryAfterSeconds: 90,
			});

			await expect(deferDriver.defer(deferredFirst as QueueJob, 0)).resolves.toBe(true);

			const deferredSecond = await deferDriver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(deferredFirst?.attempts).toBe(1);
			expect(deferredSecond?.attempts).toBe(1);
		} finally {
			await Promise.all([
				releaseDriver.close(),
				deferDriver.close(),
			]);
			await Promise.all([
				clearRedisPrefix(releaseKeyPrefix),
				clearRedisPrefix(deferKeyPrefix),
			]);
		}
	});

	it('processes jobs through the Queue service', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);
		const handled: string[] = [];
		const queue = new Queue({} as Database, {
			driver,
		});

		try {
			queue.registerHandler<{ message: string }>('RedisHandledJob', async job => {
				handled.push(job.payload.data.message);
			});

			await queue.dispatch('RedisHandledJob', {
				message: 'Handled',
			});

			const result = await queue.workNextJob();

			expect(result?.status).toBe('succeeded');
			expect(handled).toEqual(['Handled']);
			expect(await queue.workNextJob()).toBeNull();
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});

	it('fails exhausted jobs through the Queue service', async () => {
		const keyPrefix = testKeyPrefix();
		const driver = testDriver(keyPrefix);
		const queue = new Queue({} as Database, {
			driver,
		});

		try {
			queue.registerHandler('RedisFailingJob', async () => {
				throw new Error('Failed in Redis');
			});

			await queue.dispatch('RedisFailingJob', {}, {
				maxTries: 1,
			});

			const result = await queue.workNextJob();
			const failures = await driver.failedJobs();

			expect(result?.status).toBe('failed');
			expect(result?.error).toBeInstanceOf(Error);
			expect(failures[0]).toMatchObject({
				connection: 'redis',
				queue: 'default',
				payload: {
					job: 'RedisFailingJob',
				},
				exception: 'Failed in Redis',
			});
			expect(await queue.workNextJob()).toBeNull();

			const failedId = String(failures[0].id);
			const exactFailure = await driver.failedJob(failedId);
			const replacementId = await queue.retryFailed(failedId);
			const replacement = await driver.pop('default', {
				retryAfterSeconds: 90,
			});

			expect(exactFailure).toEqual(failures[0]);
			expect(replacementId).not.toBe(failedId);
			expect(replacement).toMatchObject({
				id: replacementId,
				payload: {
					job: 'RedisFailingJob',
					retryOf: {
						failedJobId: failedId,
						jobUuid: failures[0].payload.uuid,
					},
				},
			});
			expect(await driver.failedJobs()).toHaveLength(1);

			await driver.delete(replacement as QueueJob);
		} finally {
			await driver.close();
			await clearRedisPrefix(keyPrefix);
		}
	});
});

/**
 * Creates a Redis queue driver with a unique key prefix.
 *
 * @returns Redis queue driver for one test.
 */
function testDriver(keyPrefix: string): RedisQueueDriver {
	return new RedisQueueDriver({
		...redisOptions,
		keyPrefix,
		connectionTimeoutMs: 500,
	});
}

/**
 * Creates an isolated Redis key prefix for one test case.
 *
 * @returns Redis key prefix.
 */
function testKeyPrefix(): string {
	return `platform:test:queue:${randomUUID()}`;
}

/**
 * Deletes Redis keys created under one test prefix.
 *
 * @param keyPrefix - Redis key prefix to delete.
 * @returns Promise that settles after matching keys are removed.
 */
async function clearRedisPrefix(keyPrefix: string): Promise<void> {
	const client = createClient(redisClientOptions());

	client.on('error', (): void => {});

	await client.connect();

	try {
		let cursor = '0';

		do {
			const [nextCursor, keys] = await client.sendCommand<[string, string[]]>([
				'SCAN',
				cursor,
				'MATCH',
				`${keyPrefix.replace(/[\\*?\[\]]/g, '\\$&')}:*`,
				'COUNT',
				'100',
			]);

			cursor = nextCursor;

			if (keys.length > 0) {
				await client.sendCommand(['DEL', ...keys]);
			}
		} while (cursor !== '0');
	} finally {
		await client.close();
	}
}

/**
 * Builds Redis client options for test cleanup.
 *
 * @returns Redis client options.
 */
function redisClientOptions(): RedisClientOptions {
	const base: RedisClientOptions = {
		database: redisOptions.database,
		username: redisOptions.username,
		password: redisOptions.password,
	};

	if (redisOptions.url) {
		return {
			...base,
			url: redisOptions.url,
			socket: {
				connectTimeout: 500,
			},
		};
	}

	return {
		...base,
		socket: {
			host: redisOptions.host,
			port: redisOptions.port,
			connectTimeout: 500,
		},
	};
}

/**
 * Builds a queue payload for Redis driver tests.
 *
 * @param job - Durable job name.
 * @param data - JSON-safe payload data.
 * @returns Queue payload envelope.
 */
function testPayload<TData extends Record<string, unknown> = Record<string, unknown>>(
	job: string,
	data = {} as TData,
): JobEnvelope<TData> {
	return {
		uuid: randomUUID(),
		displayName: job,
		job,
		maxTries: 3,
		data,
	};
}

/**
 * Resolves Redis test connection options from the environment.
 *
 * @returns Redis connection options for tests.
 */
function redisTestOptions(): queue.RedisQueueDriverOptions & { host: string; port: number } {
	const url = process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;
	const parsed = url ? new URL(url) : null;

	return {
		url: url ?? undefined,
		host: parsed?.hostname || process.env.QUEUE_REDIS_HOST || '127.0.0.1',
		port: Number(parsed?.port || process.env.QUEUE_REDIS_PORT || 6379),
		username: parsed?.username ? decodeURIComponent(parsed.username) : process.env.QUEUE_REDIS_USERNAME,
		password: parsed?.password ? decodeURIComponent(parsed.password) : process.env.QUEUE_REDIS_PASSWORD,
		database: parsed?.pathname ? Number(parsed.pathname.replace('/', '')) : undefined,
	};
}

/**
 * Checks whether a Redis TCP port is reachable before enabling integration tests.
 *
 * @param host - Redis host.
 * @param port - Redis port.
 * @returns True when a socket can connect.
 */
async function canConnect(host: string, port: number): Promise<boolean> {
	return await new Promise(resolve => {
		const socket = createConnection({
			host,
			port,
		});
		const timeout = setTimeout(() => {
			socket.destroy();
			resolve(false);
		}, 200);

		socket.once('connect', () => {
			clearTimeout(timeout);
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => {
			clearTimeout(timeout);
			resolve(false);
		});
	});
}

/**
 * Returns the current Unix timestamp in seconds for queue scheduling fields.
 *
 * @returns Current Unix timestamp in seconds.
 */
function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}

/** Counts only this test namespace's blocked sockets on the disposable Redis server. */
async function blockedWaitCount(prefix: string): Promise<number> {
	const client = createClient(redisClientOptions());
	client.on('error', (): void => {});
	await client.connect();
	try {
		const clients = await client.sendCommand<string>(['CLIENT', 'LIST']);
		return clients.split('\n').filter(line => line.includes(`name=${prefix}:wait `) && line.includes('cmd=xread')).length;
	} finally { await client.close(); }
}
