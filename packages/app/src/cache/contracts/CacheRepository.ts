import type {
	CacheGetOrSetOptions,
	CacheSetOptions,
	CacheValueFactory,
} from './CacheOperations';

/**
 * Application-facing cache operations shared by framework and app code.
 */
export interface CacheRepository {
	/**
	 * Retrieves a cached value.
	 *
	 * @param key - Stable application cache key.
	 * @returns Cached value or undefined when the key is absent or expired.
	 */
	get<TValue>(key: string): Promise<TValue | undefined>;

	/**
	 * Stores one defined cache value.
	 *
	 * @param key - Stable application cache key.
	 * @param value - Defined value to retain.
	 * @param options - Optional per-write TTL.
	 * @returns The stored value.
	 */
	set<TValue>(
		key: string,
		value: TValue,
		options?: CacheSetOptions,
	): Promise<TValue>;

	/**
	 * Returns a cached value or computes and stores it after a miss.
	 *
	 * Concurrent lookups for the same key share one in-flight factory execution
	 * within the current process.
	 *
	 * @param key - Stable application cache key.
	 * @param factory - Value producer invoked after a cache miss.
	 * @param options - TTL and optional background-refresh controls.
	 * @returns Cached or newly resolved value.
	 */
	getOrSet<TValue>(
		key: string,
		factory: CacheValueFactory<TValue>,
		options?: CacheGetOrSetOptions<TValue>,
	): Promise<TValue>;

	/**
	 * Removes one cache key.
	 *
	 * @param key - Cache key to remove.
	 * @returns True when the underlying cache accepted the deletion.
	 */
	forget(key: string): Promise<boolean>;

	/**
	 * Removes every key owned by the configured cache store.
	 */
	clear(): Promise<void>;
}
