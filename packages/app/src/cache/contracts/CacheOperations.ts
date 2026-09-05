/**
 * Per-write cache options.
 */
export interface CacheSetOptions {
	/** Time-to-live in milliseconds, overriding the configured store default. */
	ttl?: number;
}

/**
 * Options controlling one cache-through lookup.
 */
export interface CacheGetOrSetOptions<TValue> {
	/**
	 * Time-to-live in milliseconds or a function deriving it from the resolved value.
	 */
	ttl?: number | ((value: TValue) => number);
	/**
	 * Remaining TTL threshold that triggers a background refresh.
	 *
	 * The stale value is returned while the factory refreshes it.
	 */
	refreshThreshold?: number | ((value: TValue) => number);
}

/**
 * Factory that computes a value after a cache miss.
 */
export type CacheValueFactory<TValue> = () => TValue | Promise<TValue>;
