import { createCacheDriver } from './drivers/createCacheDriver';
import type * as cache from './contracts';

/**
 * Application cache service exposed through `app().cache`.
 *
 * The framework owns cache naming and lifecycle while Cache Manager currently
 * supplies storage behavior through memory and Redis Keyv adapters.
 *
 * @example
	 * const summary = await app().cache.getOrSet(`notes:v1:${ownerId}:summary`, async () => {
	 * 	return { count: await Note.where('owner', ownerId).count() };
 * }, {
 * 	ttl: 60_000,
 * });
 */
export class Cache implements cache.CacheDriver {
	readonly #driver: cache.CacheDriver;
	#closePromise: Promise<void> | null = null;

	/**
	 * Creates the configured cache service.
	 *
	 * @param options - Named cache-store configuration.
	 * @param driver - Optional concrete driver used by focused tests or providers.
	 */
	constructor(
		options: cache.CacheOptions = {},
		driver?: cache.CacheDriver,
	) {
		this.#driver = driver ?? createCacheDriver(options);
	}

	/**
	 * Retrieves a cached value.
	 *
	 * @param key - Stable application cache key.
	 * @returns Cached value or undefined after a miss.
	 */
	async get<TValue>(key: string): Promise<TValue | undefined> {
		return this.#driver.get<TValue>(cacheKey(key));
	}

	/**
	 * Stores one defined cache value.
	 *
	 * @param key - Stable application cache key.
	 * @param value - Defined value to retain.
	 * @param options - Optional per-write TTL.
	 * @returns The stored value.
	 */
	async set<TValue>(
		key: string,
		value: TValue,
		options: cache.CacheSetOptions = {},
	): Promise<TValue> {
		return this.#driver.set(
			cacheKey(key),
			definedCacheValue(value, key),
			options,
		);
	}

	/**
	 * Returns a cached value or computes and stores it after a miss.
	 *
	 * Cache Manager coalesces concurrent misses for the same key within this
	 * process, so the factory runs once while other callers await its result.
	 *
	 * @param key - Stable application cache key.
	 * @param factory - Value producer invoked after a cache miss.
	 * @param options - TTL and optional background-refresh controls.
	 * @returns Cached or newly resolved value.
	 */
	async getOrSet<TValue>(
		key: string,
		factory: cache.CacheValueFactory<TValue>,
		options: cache.CacheGetOrSetOptions<TValue> = {},
	): Promise<TValue> {
		const normalizedKey = cacheKey(key);

		return this.#driver.getOrSet(normalizedKey, async () => {
			const value = await factory();

			return definedCacheValue(value, normalizedKey);
		}, options);
	}

	/**
	 * Removes one cache key.
	 *
	 * @param key - Cache key to remove.
	 * @returns True when the driver accepted the deletion.
	 */
	async forget(key: string): Promise<boolean> {
		return this.#driver.forget(cacheKey(key));
	}

	/**
	 * Removes every key owned by the configured store.
	 */
	async clear(): Promise<void> {
		await this.#driver.clear();
	}

	/**
	 * Releases resources held by the configured cache driver.
	 */
	async close(): Promise<void> {
		this.#closePromise ??= this.#driver.close();
		await this.#closePromise;
	}
}

/**
 * Validates and normalizes an application cache key.
 *
 * @param key - Candidate cache key.
 * @returns Trimmed non-empty cache key.
 */
function cacheKey(key: string): string {
	const normalized = key.trim();

	if (!normalized) {
		throw new Error('Cache keys must be non-empty strings.');
	}

	return normalized;
}

/**
 * Rejects undefined because it represents a cache miss in Cache Manager.
 *
 * Null, false, zero, and empty strings remain valid cached values.
 *
 * @param value - Candidate cache value.
 * @param key - Cache key used in the validation error.
 * @returns Defined cache value.
 */
function definedCacheValue<TValue>(
	value: TValue,
	key: string,
): Exclude<TValue, undefined> {
	if (value === undefined) {
		throw new TypeError(
			`Cache value for "${key}" cannot be undefined because undefined represents a cache miss.`,
		);
	}

	return value as Exclude<TValue, undefined>;
}
