import type { Knex } from 'knex';
import {
	afterEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';

import {
	Cache,
	type CacheDriver,
	type CacheOptions,
} from '../index';
import { App } from '../../server';

afterEach(() => {
	vi.useRealTimers();
});

describe('Cache', () => {
	it('stores, retrieves, and forgets defined values', async () => {
		const cache = memoryCache();

		await expect(cache.set('answer', 42)).resolves.toBe(42);
		await expect(cache.get<number>('answer')).resolves.toBe(42);

		await cache.set('nullable', null);
		await expect(cache.get<null>('nullable')).resolves.toBeNull();

		await expect(cache.forget('answer')).resolves.toBe(true);
		await expect(cache.get<number>('answer')).resolves.toBeUndefined();

		await cache.close();
	});

	it('computes a missing value once and returns the cached result', async () => {
		const cache = memoryCache();
		const factory = vi.fn(async () => {
			return {
				status: 'ready',
			};
		});

		const first = await cache.getOrSet('website:1', factory, {
			ttl: 60_000,
		});
		const second = await cache.getOrSet('website:1', factory, {
			ttl: 60_000,
		});

		expect(first).toEqual({
			status: 'ready',
		});
		expect(second).toEqual(first);
		expect(factory).toHaveBeenCalledOnce();

		await cache.close();
	});

	it('coalesces concurrent getOrSet misses for the same key', async () => {
		const cache = memoryCache();
		let releaseFactory: () => void = () => {};
		const factoryWait = new Promise<void>(resolve => {
			releaseFactory = resolve;
		});
		const factory = vi.fn(async () => {
			await factoryWait;

			return 'computed';
		});

		const first = cache.getOrSet('shared-key', factory);
		const second = cache.getOrSet('shared-key', factory);

		await vi.waitFor(() => {
			expect(factory).toHaveBeenCalledOnce();
		});

		releaseFactory();

		await expect(Promise.all([
			first,
			second,
		])).resolves.toEqual([
			'computed',
			'computed',
		]);

		await cache.close();
	});

	it('expires values using millisecond TTL options', async () => {
		vi.useFakeTimers();

		const cache = memoryCache();

		await cache.set('temporary', 'value', {
			ttl: 100,
		});
		await expect(cache.get<string>('temporary')).resolves.toBe('value');

		await vi.advanceTimersByTimeAsync(101);

		await expect(cache.get<string>('temporary')).resolves.toBeUndefined();

		await cache.close();
	});

	it('bounds the configured memory cache by least-recently-used entries', async () => {
		const cache = memoryCache({
			maxEntries: 2,
		});

		await cache.set('first', 1);
		await cache.set('second', 2);
		await cache.get('first');
		await cache.set('third', 3);

		await expect(cache.get<number>('first')).resolves.toBe(1);
		await expect(cache.get<number>('second')).resolves.toBeUndefined();
		await expect(cache.get<number>('third')).resolves.toBe(3);

		await cache.close();
	});

	it('does not cache failed or undefined factory results', async () => {
		const cache = memoryCache();
		const failedFactory = vi.fn(async () => {
			throw new Error('Computation failed.');
		});
		const successfulFactory = vi.fn(async () => 'recovered');

		await expect(
			cache.getOrSet('retryable', failedFactory),
		).rejects.toThrow('Computation failed.');
		await expect(
			cache.getOrSet('retryable', successfulFactory),
		).resolves.toBe('recovered');

		await expect(
			cache.set('undefined', undefined),
		).rejects.toThrow('cannot be undefined');
		await expect(
			cache.getOrSet('undefined-factory', async () => undefined),
		).rejects.toThrow('cannot be undefined');

		expect(failedFactory).toHaveBeenCalledOnce();
		expect(successfulFactory).toHaveBeenCalledOnce();

		await cache.close();
	});

	it('validates selected stores and Redis namespace safety', async () => {
		expect(() => new Cache({
			default: 'missing',
			stores: {},
		})).toThrow('Cache store "missing" is not configured');

		expect(() => new Cache({
			default: 'redis',
			stores: {
				redis: {
					driver: 'redis',
					url: 'redis://127.0.0.1:6379',
				},
			},
		} as unknown as CacheOptions)).toThrow('Redis cache namespace must be a non-empty string');

		const redis = new Cache({
			default: 'redis',
			stores: {
				redis: {
					driver: 'redis',
					url: 'redis://127.0.0.1:6379',
					namespace: 'platform:test',
				},
			},
		});

		await expect(redis.close()).resolves.toBeUndefined();
	});

	it('resolves app cache config and closes an injected driver once', async () => {
		const close = vi.fn(async () => {});
		const driver = lifecycleDriver(close);
		const cache = new Cache({}, driver);
		const application = new App({
			db: {} as Knex,
			config: {
				cache: {
					default: 'memory',
					stores: {
						memory: {
							driver: 'memory',
							maxEntries: 1,
						},
					},
				} satisfies CacheOptions,
			},
		});

		await application.cache.set('first', 1);
		await application.cache.set('second', 2);

		expect(application.cache).toBe(application.cache);
		await expect(application.cache.get('first')).resolves.toBeUndefined();
		await expect(application.cache.get('second')).resolves.toBe(2);

		application.set('cache', cache);
		await application.close();
		await cache.close();

		expect(close).toHaveBeenCalledOnce();
	});
});

/**
 * Creates a real bounded memory cache for behavior tests.
 *
 * @param options - Per-test memory store overrides.
 * @returns Framework cache backed by Cache Manager and CacheableMemory.
 */
function memoryCache(
	options: Omit<Extract<
		NonNullable<CacheOptions['stores']>[string],
		{ driver: 'memory' }
	>, 'driver'> = {},
): Cache {
	return new Cache({
		default: 'memory',
		stores: {
			memory: {
				driver: 'memory',
				...options,
			},
		},
	});
}

/**
 * Creates a minimal injectable driver for App shutdown verification.
 *
 * @param close - Close spy invoked by the framework lifecycle.
 * @returns Cache driver whose data operations are inert.
 */
function lifecycleDriver(
	close: CacheDriver['close'],
): CacheDriver {
	return {
		async get<TValue>(): Promise<TValue | undefined> {
			return undefined;
		},
		async set<TValue>(
			_key: string,
			value: TValue,
		): Promise<TValue> {
			return value;
		},
		async getOrSet<TValue>(
			_key: string,
			factory: () => TValue | Promise<TValue>,
		): Promise<TValue> {
			return factory();
		},
		async forget(): Promise<boolean> {
			return true;
		},
		async clear(): Promise<void> {},
		close,
	};
}
