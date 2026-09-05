import { createKeyv as createMemoryStore } from 'cacheable';
import { createCache } from 'cache-manager';
import { createKeyv as createRedisStore } from '@keyv/redis';

import type * as cache from '../contracts';
import { CacheManagerDriver } from './CacheManagerDriver';

const defaultMemoryStore: cache.MemoryCacheStoreOptions = {
	driver: 'memory',
	maxEntries: 1000,
};

/**
 * Creates the concrete cache driver selected by named application config.
 *
 * @param options - Named store configuration from `config.cache`.
 * @returns Cache Manager driver using the selected memory or Redis store.
 */
export function createCacheDriver(
	options: cache.CacheOptions = {},
): cache.CacheDriver {
	const storeName = nonEmptyString(options.default ?? 'memory', 'Cache default store');
	const stores = options.stores ?? {
		memory: defaultMemoryStore,
	};
	const store = stores[storeName];

	if (!store) {
		throw new Error(`Cache store "${storeName}" is not configured.`);
	}

	switch (store.driver) {
		case 'memory':
			return memoryCacheDriver(store);

		case 'redis':
			return redisCacheDriver(store);

		default:
			return unsupportedCacheDriver(store);
	}
}

/**
 * Creates a bounded CacheableMemory store behind Cache Manager.
 *
 * @param options - Memory TTL, LRU bound, and clone configuration.
 * @returns Cache Manager driver using an in-process store.
 */
function memoryCacheDriver(
	options: cache.MemoryCacheStoreOptions,
): cache.CacheDriver {
	const ttl = optionalPositiveNumber(options.ttl, 'Memory cache TTL');
	const maxEntries = positiveInteger(
		options.maxEntries ?? defaultMemoryStore.maxEntries,
		'Memory cache maxEntries',
	);
	const store = createMemoryStore({
		ttl,
		lruSize: maxEntries,
		useClone: options.clone,
	});

	store.on('error', ignoreStoreError);

	return new CacheManagerDriver(createCache({
		stores: [store],
		ttl,
	}));
}

/**
 * Creates a namespaced Redis Keyv store behind Cache Manager.
 *
 * `noNamespaceAffectsAll` remains false so a cache clear never becomes a broad
 * Redis database flush.
 *
 * @param options - Redis connection, namespace, TTL, and failure configuration.
 * @returns Cache Manager driver using the official Redis adapter.
 */
function redisCacheDriver(
	options: cache.RedisCacheStoreOptions,
): cache.CacheDriver {
	const url = nonEmptyString(options.url, 'Redis cache URL');
	const namespace = nonEmptyString(options.namespace, 'Redis cache namespace');
	const ttl = optionalPositiveNumber(options.ttl, 'Redis cache TTL');
	const connectionTimeout = optionalPositiveNumber(
		options.connectionTimeoutMs,
		'Redis cache connectionTimeoutMs',
	);
	const clearBatchSize = options.clearBatchSize === undefined
		? undefined
		: positiveInteger(options.clearBatchSize, 'Redis cache clearBatchSize');
	const store = createRedisStore(url, {
		namespace,
		keyPrefixSeparator: ':',
		connectionTimeout,
		clearBatchSize,
		noNamespaceAffectsAll: false,
		throwOnConnectError: options.throwOnConnectError,
		throwOnErrors: options.throwOnErrors,
		useUnlink: true,
	});

	store.on('error', ignoreStoreError);

	return new CacheManagerDriver(createCache({
		stores: [store],
		ttl,
	}));
}

/**
 * Produces an exhaustive runtime error for config values outside the public union.
 *
 * @param store - Invalid store configuration received from untyped runtime config.
 * @returns Never because unsupported drivers cannot be created.
 */
function unsupportedCacheDriver(store: never): never {
	const driver = (store as {
		driver?: unknown;
	}).driver;

	throw new Error(`Unsupported cache driver "${String(driver)}".`);
}

/**
 * Prevents storage-adapter EventEmitter errors from terminating the process.
 *
 * Cache operations still follow Cache Manager's own resolve/reject semantics.
 *
 * @param _error - Adapter error governed by the selected store's failure options.
 */
function ignoreStoreError(_error: unknown): void {}

/**
 * Validates a required non-empty string config value.
 *
 * @param value - Candidate config value.
 * @param label - Human-readable option name.
 * @returns Trimmed non-empty string.
 */
function nonEmptyString(value: unknown, label: string): string {
	const normalized = typeof value === 'string'
		? value.trim()
		: '';

	if (!normalized) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return normalized;
}

/**
 * Validates an optional positive finite number.
 *
 * @param value - Candidate numeric config value.
 * @param label - Human-readable option name.
 * @returns Validated value or undefined when omitted.
 */
function optionalPositiveNumber(
	value: number | undefined,
	label: string,
): number | undefined {
	if (value === undefined) return undefined;

	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${label} must be greater than zero.`);
	}

	return value;
}

/**
 * Validates a positive integer config value.
 *
 * @param value - Candidate numeric config value.
 * @param label - Human-readable option name.
 * @returns Validated positive integer.
 */
function positiveInteger(
	value: number | undefined,
	label: string,
): number {
	if (!Number.isInteger(value) || Number(value) <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}

	return Number(value);
}
