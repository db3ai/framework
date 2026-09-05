import type { Cache as ManagedCache } from 'cache-manager';

import type * as cache from '../contracts';

/**
 * Cache driver backed by the Cache Manager package.
 */
export class CacheManagerDriver implements cache.CacheDriver {
	#closePromise: Promise<void> | null = null;

	/**
	 * Creates a driver around one configured Cache Manager instance.
	 *
	 * @param manager - Cache Manager instance containing the selected Keyv store.
	 */
	constructor(private readonly manager: ManagedCache) {}

	/**
	 * Retrieves a cached value from Cache Manager.
	 *
	 * @param key - Stable application cache key.
	 * @returns Cached value or undefined after a miss.
	 */
	async get<TValue>(key: string): Promise<TValue | undefined> {
		return this.manager.get<TValue>(key);
	}

	/**
	 * Stores one value through Cache Manager.
	 *
	 * @param key - Stable application cache key.
	 * @param value - Value to retain.
	 * @param options - Optional per-write TTL.
	 * @returns The stored value.
	 */
	async set<TValue>(
		key: string,
		value: TValue,
		options: cache.CacheSetOptions = {},
	): Promise<TValue> {
		return this.manager.set(key, value, options.ttl);
	}

	/**
	 * Uses Cache Manager's coalesced wrapper for one cache-through lookup.
	 *
	 * @param key - Stable application cache key.
	 * @param factory - Value producer invoked after a miss.
	 * @param options - TTL and background-refresh controls.
	 * @returns Cached or newly resolved value.
	 */
	async getOrSet<TValue>(
		key: string,
		factory: cache.CacheValueFactory<TValue>,
		options: cache.CacheGetOrSetOptions<TValue> = {},
	): Promise<TValue> {
		return this.manager.wrap(key, factory, options);
	}

	/**
	 * Deletes one cache key through Cache Manager.
	 *
	 * @param key - Cache key to remove.
	 * @returns True when Cache Manager accepted the deletion.
	 */
	async forget(key: string): Promise<boolean> {
		return this.manager.del(key);
	}

	/**
	 * Clears keys owned by the selected store.
	 */
	async clear(): Promise<void> {
		await this.manager.clear();
	}

	/**
	 * Disconnects every Keyv store exactly once.
	 */
	async close(): Promise<void> {
		this.#closePromise ??= this.manager.disconnect().then(() => {});
		await this.#closePromise;
	}
}
