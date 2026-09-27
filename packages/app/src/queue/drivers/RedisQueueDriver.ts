import { createClient, type RedisArgument, type RedisClientOptions, type RedisClientType } from '@redis/client';
import { unknownErrorMessage } from '@db3.ai/pure';

import type * as queue from '../contracts';
import { jobEnvelopeHasPrefix } from '../jobEnvelopeHasPrefix';

type RedisCommandArgument = string | number;
type ResolvedRedisQueueDriverOptions = Required<Pick<queue.RedisQueueDriverOptions, 'host' | 'port' | 'keyPrefix' | 'connectionTimeoutMs'>> & queue.RedisQueueDriverOptions;

interface RedisQueuedJobRecord<TData = Record<string, unknown>> {
	id?: string;
	queue: string;
	attempts: number;
	payload: queue.JobEnvelope<TData>;
	availableAt: number;
	reservedAt: number | null;
	createdAt: number;
}

interface RedisFailedJobRecord {
	id: string;
	connection: string;
	queue: string;
	payload: queue.JobEnvelope<Record<string, unknown>>;
	exception: string;
	failedAt: string;
}

const PUSH_SCRIPT = `
local id = tostring(redis.call('INCR', KEYS[1]))
local record = cjson.decode(ARGV[1])
record.id = id
local encoded = cjson.encode(record)
redis.call('HSET', KEYS[2], id, encoded)
if tonumber(ARGV[2]) > 0 then
	redis.call('ZADD', KEYS[4], ARGV[3], id)
else
	redis.call('RPUSH', KEYS[3], id)
end
return id
`;

const POP_SCRIPT = `
local delayed = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, id in ipairs(delayed) do
	if redis.call('ZREM', KEYS[2], id) == 1 then
		redis.call('RPUSH', KEYS[1], id)
	end
end

local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[1], 'LIMIT', 0, 100)
for _, id in ipairs(expired) do
	if redis.call('ZREM', KEYS[3], id) == 1 then
		redis.call('RPUSH', KEYS[1], id)
	end
end

while true do
	local id = redis.call('LPOP', KEYS[1])
	if not id then
		return nil
	end

	local raw = redis.call('HGET', KEYS[4], id)
	if raw then
		local record = cjson.decode(raw)
		record.attempts = (tonumber(record.attempts) or 0) + 1
		record.reservedAt = tonumber(ARGV[1])
		redis.call('HSET', KEYS[4], id, cjson.encode(record))
		redis.call('ZADD', KEYS[3], tonumber(ARGV[1]) + tonumber(ARGV[2]), id)
		return redis.call('HGET', KEYS[4], id)
	end
end
`;

const RELEASE_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then
	return 0
end

local current = cjson.decode(raw)
if tonumber(current.attempts) ~= tonumber(ARGV[2]) then
	return 0
end

redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('LREM', KEYS[4], 0, ARGV[1])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])
return 1
`;

const TOUCH_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then
	return 0
end

local record = cjson.decode(raw)
if tonumber(record.attempts) ~= tonumber(ARGV[2]) then
	return 0
end

record.reservedAt = tonumber(ARGV[3])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(record))
redis.call('ZADD', KEYS[2], tonumber(ARGV[3]) + tonumber(ARGV[4]), ARGV[1])
return 1
`;

const DELETE_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then
	return 0
end

local record = cjson.decode(raw)
if tonumber(record.attempts) ~= tonumber(ARGV[2]) then
	return 0
end

redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('LREM', KEYS[4], 0, ARGV[1])
return redis.call('HDEL', KEYS[1], ARGV[1])
`;

const FAIL_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then
	return 0
end

local record = cjson.decode(raw)
if tonumber(record.attempts) ~= tonumber(ARGV[2]) then
	return 0
end

redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('LREM', KEYS[4], 0, ARGV[1])
redis.call('LPUSH', KEYS[5], ARGV[3])
return 1
`;

/**
 * Queue driver that stores pending, delayed, reserved, and failed jobs in Redis.
 *
 * @example
 * ```ts
 * const queue = new Queue(db, {
 * 	driverName: 'redis',
 * 	redis: {
 * 		url: 'redis://127.0.0.1:6379',
 * 		keyPrefix: 'app:queue',
 * 	},
 * });
 * ```
 */
export class RedisQueueDriver implements queue.QueueDriver {
	readonly name = 'redis';
	readonly #client: RedisClientType;
	readonly #options: ResolvedRedisQueueDriverOptions;
	#connecting: Promise<RedisClientType> | null = null;

	/**
	 * Creates a Redis-backed queue driver.
	 *
	 * @param options - Redis connection and key options.
	 */
	constructor(options: queue.RedisQueueDriverOptions = {}) {
		this.#options = resolveRedisOptions(options);
		this.#client = createClient(redisClientOptions(this.#options));
		this.#client.on('error', (): void => {});
	}

	/**
	 * Persists a job into Redis and schedules it for immediate or delayed processing.
	 *
	 * @param job - Queue job payload and scheduling data.
	 * @returns Redis queue job id.
	 */
	async push<TData extends Record<string, unknown>>(
		job: queue.QueueDriverPushInput<TData>,
	): Promise<queue.QueueJobId> {
		const record: RedisQueuedJobRecord<TData> = {
			queue: job.queue,
			attempts: 0,
			payload: job.payload,
			availableAt: job.createdAt + job.delaySeconds,
			reservedAt: null,
			createdAt: job.createdAt,
		};
		const id = await this.#command<string | number>([
			'EVAL',
			PUSH_SCRIPT,
			4,
			this.#idKey(),
			this.#jobsKey(),
			this.#readyKey(job.queue),
			this.#delayedKey(job.queue),
			JSON.stringify(record),
			job.delaySeconds,
			record.availableAt,
		]);

		return String(id);
	}

	/** Scans active Redis payloads during quiesced maintenance; includes delayed, reserved and chained jobs. */
	async hasPendingJobs(jobPrefix: string): Promise<boolean> {
		let cursor = '0';
		do {
			const result = await this.#command<[string, string[]]>(['HSCAN', this.#jobsKey(), cursor, 'COUNT', 100]);
			cursor = String(result[0]);
			for (let index = 1; index < result[1].length; index += 2) {
				const record = JSON.parse(result[1][index]) as RedisQueuedJobRecord;
				if (jobEnvelopeHasPrefix(record.payload, jobPrefix)) return true;
			}
		} while (cursor !== '0');
		return false;
	}

	/**
	 * Claims the next available job from a Redis queue.
	 *
	 * @param queue - Named queue/channel to claim from.
	 * @param options - Claim controls such as retry expiry.
	 * @returns Claimed queue job, or null when no job is ready.
	 */
	async pop(queue: string, options: queue.QueueDriverPopOptions): Promise<queue.QueueJob | null> {
		const raw = await this.#command<string | null>([
			'EVAL',
			POP_SCRIPT,
			4,
			this.#readyKey(queue),
			this.#delayedKey(queue),
			this.#reservedKey(queue),
			this.#jobsKey(),
			unixTimestamp(),
			options.retryAfterSeconds,
		]);

		if (raw === null) return null;
		if (typeof raw !== 'string') {
			throw new Error('Redis queue pop returned an invalid payload.');
		}

		return queueJobFromRecord(parseRedisJobRecord(raw));
	}

	/**
	 * Renews the Redis reservation for the current queue attempt.
	 *
	 * @param job - Claimed job whose id and attempt count identify the lease owner.
	 * @param retryAfterSeconds - Number of seconds before the renewed reservation expires.
	 * @returns True when the current attempt still owns the job.
	 */
	async touch(job: queue.QueueJob, retryAfterSeconds: number): Promise<boolean> {
		const renewed = await this.#command<number>([
			'EVAL',
			TOUCH_SCRIPT,
			2,
			this.#jobsKey(),
			this.#reservedKey(job.queue),
			String(job.id),
			job.attempts,
			unixTimestamp(),
			retryAfterSeconds,
		]);

		return Number(renewed) === 1;
	}

	/**
	 * Releases a failed attempt for another try after a delay.
	 *
	 * @param job - Claimed queue job to release.
	 * @param delaySeconds - Number of seconds before the job can be claimed again.
	 * @returns True when the current attempt owned and released the job.
	 */
	async release(job: queue.QueueJob, delaySeconds: number): Promise<boolean> {
		return await this.#reschedule(job, job.attempts, delaySeconds);
	}

	/**
	 * Defers a claimed job without consuming one of its retry attempts.
	 *
	 * @param job - Claimed queue job to defer.
	 * @param delaySeconds - Number of seconds before the job can be claimed again.
	 * @returns True when the current attempt owned and deferred the job.
	 */
	async defer(job: queue.QueueJob, delaySeconds: number): Promise<boolean> {
		return await this.#reschedule(job, Math.max(0, job.attempts - 1), delaySeconds);
	}

	/**
	 * Deletes a completed job from Redis.
	 *
	 * @param job - Claimed queue job to delete.
	 * @returns True when the current attempt owned and deleted the job.
	 */
	async delete(job: queue.QueueJob): Promise<boolean> {
		const deleted = await this.#command<number>([
			'EVAL',
			DELETE_SCRIPT,
			4,
			this.#jobsKey(),
			this.#reservedKey(job.queue),
			this.#delayedKey(job.queue),
			this.#readyKey(job.queue),
			String(job.id),
			job.attempts,
		]);

		return Number(deleted) === 1;
	}

	/**
	 * Records a terminal failed job and removes it from the active Redis queue.
	 *
	 * @param job - Claimed queue job that exhausted retries.
	 * @param error - Handler error that caused the terminal failure.
	 * @returns True when the current attempt owned and failed the job.
	 */
	async fail(job: queue.QueueJob, error: unknown): Promise<boolean> {
		const failed = await this.#command<number>([
			'EVAL',
			FAIL_SCRIPT,
			5,
			this.#jobsKey(),
			this.#reservedKey(job.queue),
			this.#delayedKey(job.queue),
			this.#readyKey(job.queue),
			this.#failedKey(),
			String(job.id),
			job.attempts,
			JSON.stringify({
				id: String(job.id),
				connection: this.name,
				queue: job.queue,
				payload: job.payload,
				exception: unknownErrorMessage(error),
				failedAt: new Date().toISOString(),
			}),
		]);

		return Number(failed) === 1;
	}

	/**
	 * Returns recent terminal failures stored by the Redis driver.
	 *
	 * @param limit - Maximum number of recent failed jobs to return.
	 * @returns Recent failed jobs ordered from newest to oldest.
	 */
	async failedJobs(limit = 100): Promise<queue.QueueFailedJob[]> {
		const raw = await this.#command<string[]>([
			'LRANGE',
			this.#failedKey(),
			0,
			normalizeFailureLimit(limit) - 1,
		]);

		return raw.map(parseRedisFailedJobRecord);
	}

	/**
	 * Returns one terminal failure from the Redis failed-job list.
	 *
	 * Failed-job replay is an administrative operation, so an exact lookup may
	 * scan the retained failure list without affecting normal worker hot paths.
	 *
	 * @param id - Redis queue job identifier stored on the failed record.
	 * @returns Persisted failed job, or null when it does not exist.
	 */
	async failedJob(id: queue.QueueJobId): Promise<queue.QueueFailedJob | null> {
		const raw = await this.#command<string[]>([
			'LRANGE',
			this.#failedKey(),
			0,
			-1,
		]);

		for (const value of raw) {
			const failure = parseRedisFailedJobRecord(value);

			if (String(failure.id) === String(id)) return failure;
		}

		return null;
	}

	/**
	 * Closes the underlying Redis socket.
	 *
	 * @returns Promise that settles after the Redis client has closed.
	 */
	async close(): Promise<void> {
		if (!this.#client.isOpen) return;

		await this.#client.close();
	}

	/**
	 * Reschedules a claimed job for a future attempt.
	 *
	 * @param job - Claimed queue job to reschedule.
	 * @param attempts - Attempt count to store.
	 * @param delaySeconds - Seconds before the job becomes available.
	 * @returns True when the current attempt owned and rescheduled the job.
	 */
	async #reschedule(job: queue.QueueJob, attempts: number, delaySeconds: number): Promise<boolean> {
		const availableAt = unixTimestamp() + delaySeconds;
		const record: RedisQueuedJobRecord = {
			id: String(job.id),
			queue: job.queue,
			attempts,
			payload: job.payload,
			availableAt,
			reservedAt: null,
			createdAt: unixTimestamp(),
		};

		const rescheduled = await this.#command<number>([
			'EVAL',
			RELEASE_SCRIPT,
			4,
			this.#jobsKey(),
			this.#reservedKey(job.queue),
			this.#delayedKey(job.queue),
			this.#readyKey(job.queue),
			String(job.id),
			job.attempts,
			JSON.stringify(record),
			availableAt,
		]);

		return Number(rescheduled) === 1;
	}

	/**
	 * Sends a Redis command through the shared client connection.
	 *
	 * @param args - Redis command name and arguments.
	 * @returns Parsed command reply from Redis.
	 */
	async #command<T>(args: RedisCommandArgument[]): Promise<T> {
		const client = await this.#connect();
		const command = args.map(arg => String(arg)) as RedisArgument[];

		return await client.sendCommand<T>(command);
	}

	/**
	 * Opens the Redis client connection on first use.
	 *
	 * @returns Connected Redis client.
	 */
	async #connect(): Promise<RedisClientType> {
		if (this.#client.isOpen) return this.#client;
		if (this.#connecting) return await this.#connecting;

		this.#connecting = this.#client.connect().finally((): void => {
			this.#connecting = null;
		});

		return await this.#connecting;
	}

	/**
	 * Returns the Redis key used for queue id generation.
	 *
	 * @returns Redis id key.
	 */
	#idKey(): string {
		return this.#key('ids');
	}

	/**
	 * Returns the Redis key used for job payload storage.
	 *
	 * @returns Redis jobs hash key.
	 */
	#jobsKey(): string {
		return this.#key('jobs');
	}

	/**
	 * Returns the Redis key used for failed job storage.
	 *
	 * @returns Redis failed jobs list key.
	 */
	#failedKey(): string {
		return this.#key('failed');
	}

	/**
	 * Returns the Redis ready list key for a queue.
	 *
	 * @param queue - Named queue/channel.
	 * @returns Redis ready list key.
	 */
	#readyKey(queue: string): string {
		return this.#key('queues', queue, 'ready');
	}

	/**
	 * Returns the Redis delayed sorted-set key for a queue.
	 *
	 * @param queue - Named queue/channel.
	 * @returns Redis delayed sorted-set key.
	 */
	#delayedKey(queue: string): string {
		return this.#key('queues', queue, 'delayed');
	}

	/**
	 * Returns the Redis reserved sorted-set key for a queue.
	 *
	 * @param queue - Named queue/channel.
	 * @returns Redis reserved sorted-set key.
	 */
	#reservedKey(queue: string): string {
		return this.#key('queues', queue, 'reserved');
	}

	/**
	 * Builds a Redis key with the configured queue prefix.
	 *
	 * @param parts - Key suffix parts.
	 * @returns Redis key.
	 */
	#key(...parts: string[]): string {
		return [this.#options.keyPrefix, ...parts].join(':');
	}
}

/**
 * Resolves Redis driver options from explicit options and environment variables.
 *
 * @param options - Explicit Redis queue driver options.
 * @returns Normalized Redis driver options.
 */
function resolveRedisOptions(options: queue.RedisQueueDriverOptions): ResolvedRedisQueueDriverOptions {
	const url = options.url || process.env.QUEUE_REDIS_URL || process.env.REDIS_URL;
	const parsed = url ? new URL(url) : null;
	const database = options.database
		?? numberFromEnv('QUEUE_REDIS_DB')
		?? databaseFromUrl(parsed);

	return {
		...options,
		url: url ?? options.url,
		host: options.host || parsed?.hostname || process.env.QUEUE_REDIS_HOST || '127.0.0.1',
		port: options.port || portFromUrl(parsed) || numberFromEnv('QUEUE_REDIS_PORT') || 6379,
		username: options.username || usernameFromUrl(parsed) || process.env.QUEUE_REDIS_USERNAME,
		password: options.password || passwordFromUrl(parsed) || process.env.QUEUE_REDIS_PASSWORD,
		database,
		keyPrefix: options.keyPrefix || process.env.QUEUE_REDIS_PREFIX || 'platform:queue',
		connectionTimeoutMs: options.connectionTimeoutMs || numberFromEnv('QUEUE_REDIS_TIMEOUT_MS') || 1000,
	};
}

/**
 * Converts queue Redis options into the official Redis client options.
 *
 * @param options - Normalized queue Redis options.
 * @returns Redis client configuration.
 */
function redisClientOptions(options: ResolvedRedisQueueDriverOptions): RedisClientOptions {
	const base: RedisClientOptions = {
		database: options.database,
		disableOfflineQueue: true,
		username: options.username,
		password: options.password,
	};

	if (options.url) {
		return {
			...base,
			url: options.url,
			socket: {
				connectTimeout: options.connectionTimeoutMs,
			},
		};
	}

	return {
		...base,
		socket: {
			host: options.host,
			port: options.port,
			connectTimeout: options.connectionTimeoutMs,
		},
	};
}

/**
 * Builds a queue job from a Redis job record.
 *
 * @param record - Redis job record.
 * @returns Queue job passed to handlers.
 */
function queueJobFromRecord(record: RedisQueuedJobRecord): queue.QueueJob {
	if (!record.id) {
		throw new Error('Redis queue job record is missing an id.');
	}

	return {
		id: record.id,
		queue: record.queue,
		attempts: Number(record.attempts || 0),
		payload: record.payload,
	};
}

/**
 * Parses a Redis job record from stored JSON.
 *
 * @param value - Raw Redis job record JSON.
 * @returns Parsed Redis job record.
 */
function parseRedisJobRecord(value: string): RedisQueuedJobRecord {
	const record = JSON.parse(value) as RedisQueuedJobRecord;

	if (!record || typeof record !== 'object' || !record.payload) {
		throw new Error('Redis queue job record is invalid.');
	}

	return record;
}

/**
 * Parses one failed Redis queue record into the shared driver contract.
 *
 * @param value - Raw failed-job JSON stored in the Redis list.
 * @returns Parsed failed queue job.
 */
function parseRedisFailedJobRecord(value: string): queue.QueueFailedJob {
	const record = JSON.parse(value) as RedisFailedJobRecord;

	if (
		!record
		|| typeof record !== 'object'
		|| typeof record.id !== 'string'
		|| typeof record.connection !== 'string'
		|| typeof record.queue !== 'string'
		|| !record.payload
		|| typeof record.exception !== 'string'
		|| typeof record.failedAt !== 'string'
	) {
		throw new Error('Redis failed queue job record is invalid.');
	}

	return record;
}

/**
 * Normalizes the number of Redis failures returned to development tooling.
 *
 * @param limit - Requested maximum failure count.
 * @returns Positive bounded failure count.
 */
function normalizeFailureLimit(limit: number): number {
	if (!Number.isFinite(limit) || limit <= 0) return 100;

	return Math.min(500, Math.max(1, Math.trunc(limit)));
}

/**
 * Reads a numeric environment variable.
 *
 * @param name - Environment variable name.
 * @returns Parsed number or undefined.
 */
function numberFromEnv(name: string): number | undefined {
	const value = process.env[name];

	if (!value) return undefined;

	const parsed = Number(value);

	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads the Redis database index from a URL path.
 *
 * @param url - Parsed Redis URL.
 * @returns Database index or undefined.
 */
function databaseFromUrl(url: URL | null): number | undefined {
	if (!url) return undefined;

	const path = url.pathname.replace('/', '');

	if (!path) return undefined;

	const database = Number(path);

	return Number.isFinite(database) ? database : undefined;
}

/**
 * Reads the Redis port from a URL.
 *
 * @param url - Parsed Redis URL.
 * @returns Port number or undefined.
 */
function portFromUrl(url: URL | null): number | undefined {
	if (!url || !url.port) return undefined;

	const port = Number(url.port);

	return Number.isFinite(port) ? port : undefined;
}

/**
 * Reads a decoded Redis username from a URL.
 *
 * @param url - Parsed Redis URL.
 * @returns Username or undefined.
 */
function usernameFromUrl(url: URL | null): string | undefined {
	return url?.username ? decodeURIComponent(url.username) : undefined;
}

/**
 * Reads a decoded Redis password from a URL.
 *
 * @param url - Parsed Redis URL.
 * @returns Password or undefined.
 */
function passwordFromUrl(url: URL | null): string | undefined {
	return url?.password ? decodeURIComponent(url.password) : undefined;
}

/**
 * Returns the current Unix timestamp in seconds for Redis queue scores.
 *
 * @returns Current Unix timestamp in seconds.
 */
function unixTimestamp(): number {
	return Math.floor(Date.now() / 1000);
}
