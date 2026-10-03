# Cache

`@db3.ai/app/cache` provides the application cache exposed through
`app().cache`. The framework owns the public API, config resolution, validation, and
shutdown lifecycle. Cache Manager currently supplies TTL storage and
process-local request coalescing.

## Run a note-summary cache

From an independent application prepared using [Installation](https://db3.ai/framework/docs/installation):

```sh
mkdir -p examples
cp -R node_modules/@db3.ai/app/src/cache/examples/. examples/
npx tsx examples/runNoteCache.ts
```

The real memory-store lab returns `firstLoads: 1` for two concurrent reads and `refreshed: { count: 2 }` after invalidation. A second owner keeps their own value. A failed factory is retried explicitly, an undefined value is rejected, and the isolated store is cleared and closed. No Redis, SQL or network is needed.

Copy the exact test from the [Cache guide](https://db3.ai/framework/docs/cache#testing) to `tests/cache/runNoteCache.test.ts`, then run:

```sh
npx vitest run tests/cache/runNoteCache.test.ts
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --types node --skipLibCheck examples/*.ts
```

Tests exercise the real store and control only the clock for deterministic expiry. The [complete API](https://db3.ai/framework/docs/cache-api) covers service, driver, store and operation contracts.

## Get Or Set

Use `getOrSet(...)` when a value is expensive to compute:

```ts
const myValue = await app().cache.getOrSet('the_key', async () => {
	const complexFunctionResult = await myComplexFunction();

	return complexFunctionResult;
}, {
	ttl: 300_000,
});
```

The factory runs only after a cache miss. Concurrent misses for the same key in
one process share a single in-flight factory execution.

Coalescing belongs to one cache instance, not a distributed lock. Authorize private data before using an owner-scoped key. Include operation, owner, arguments and a version in the key; the cache never enforces ownership itself. Invalidate affected keys after the source write commits. Do not cache live models or connections.

TTL values are milliseconds. `refreshThreshold` can refresh an expiring entry
in the background while returning its current value:

```ts
const website = await app().cache.getOrSet(
	`website:${websiteId}`,
	() => loadWebsite(websiteId),
	{
		ttl: 300_000,
		refreshThreshold: 30_000,
	},
);
```

## Other Operations

```ts
await app().cache.set('feature:enabled', true, {
	ttl: 60_000,
});

const enabled = await app().cache.get<boolean>('feature:enabled');

await app().cache.forget('feature:enabled');
await app().cache.clear();
```

`undefined` represents a cache miss and cannot be stored. `null`, `false`, zero,
empty strings, arrays, and objects remain valid values. Prefer values that can
be cloned and serialized consistently across memory and Redis stores.

## Configuration

Cache stores are configured under the application config:

```ts
const config = {
	cache: {
		default: 'memory',
		stores: {
			memory: {
				driver: 'memory',
				ttl: 300_000,
				maxEntries: 1000,
			},
		},
	},
};
```

The memory driver uses CacheableMemory behind Cache Manager. It is process-local
and bounded with least-recently-used eviction. Separate API, queue-worker, and
scheduler processes do not share memory cache entries.

Redis uses the official `@keyv/redis` adapter:

```ts
const config = {
	cache: {
		default: 'redis',
		stores: {
			redis: {
				driver: 'redis',
				url: 'redis://127.0.0.1:6379',
				namespace: 'my-app:cache',
				ttl: 300_000,
				connectionTimeoutMs: 5000,
				clearBatchSize: 1000,
				throwOnConnectError: true,
				throwOnErrors: true,
			},
		},
	},
};
```

Redis namespaces are mandatory. `clear()` scans and unlinks only keys inside
that namespace; the framework never enables a broad Redis database flush.

One configured store is selected; named stores do not mean tiering or automatic failover. The local walkthrough tests memory only. Redis delivery and failure handling need real infrastructure tests before release; a Redis configuration example is not proof of a successful connection.

## Lifecycle And Boundaries

`App.close()` disconnects the configured cache store. Applications should use
the normal framework shutdown lifecycle so Redis connections close cleanly.

Cache is an optimization, not durable storage. Do not rely on it as the only
copy of application state. Cache Manager read misses and refresh behavior follow
the selected Keyv store; write, clear, factory, and strict Redis failures reject
their calling operation.
