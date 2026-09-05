/**
 * Bounded in-process cache store configuration.
 */
export interface MemoryCacheStoreOptions {
	/** Cache driver selected for this named store. */
	driver: 'memory';
	/** Default time-to-live in milliseconds. Omit for no default expiry. */
	ttl?: number;
	/** Maximum entries retained by the least-recently-used cache. Defaults to 1,000. */
	maxEntries?: number;
	/** Whether values are cloned when stored and retrieved. Defaults to true. */
	clone?: boolean;
}

/**
 * Redis cache store configuration using the official Keyv adapter.
 */
export interface RedisCacheStoreOptions {
	/** Cache driver selected for this named store. */
	driver: 'redis';
	/** Redis connection URL including credentials and database when required. */
	url: string;
	/**
	 * Prefix isolating application cache keys from other Redis data.
	 *
	 * A namespace is required so clearing the cache cannot affect unrelated keys.
	 */
	namespace: string;
	/** Default time-to-live in milliseconds. Omit for no default expiry. */
	ttl?: number;
	/** Milliseconds allowed for the initial Redis connection attempt. */
	connectionTimeoutMs?: number;
	/** Number of namespaced keys removed in each cache-clear batch. */
	clearBatchSize?: number;
	/** Whether Redis connection failures should reject cache operations. */
	throwOnConnectError?: boolean;
	/** Whether Redis command errors should reject cache operations. */
	throwOnErrors?: boolean;
}

/**
 * Supported framework cache store configurations.
 */
export type CacheStoreOptions =
	| MemoryCacheStoreOptions
	| RedisCacheStoreOptions;

/**
 * Named cache-store configuration resolved from the application config.
 */
export interface CacheOptions {
	/** Named store used by `app().cache`. Defaults to `memory`. */
	default?: string;
	/** Cache stores available to the application. */
	stores?: Record<string, CacheStoreOptions>;
}
