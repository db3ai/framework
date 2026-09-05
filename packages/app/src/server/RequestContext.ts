import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextValues =
	| Map<string, unknown>
	| Record<string, unknown>
	| Iterable<readonly [string, unknown]>;

/**
 * Request-scoped key/value context.
 *
 * Values are isolated with AsyncLocalStorage so the app singleton can expose
 * request data without sharing it across concurrent requests.
 */
export class RequestContext {
	private readonly storage = new AsyncLocalStorage<Map<string, unknown>>();

	/**
	 * Returns true when code is running inside a request context.
	 */
	get active(): boolean {
		return Boolean(this.storage.getStore());
	}

	/**
	 * Runs a callback inside an isolated request context.
	 */
	run<TResult>(
		callback: () => TResult,
		initialValues?: RequestContextValues,
	): TResult {
		return this.storage.run(this.initialStore(initialValues), callback);
	}

	/**
	 * Reads a value from the active request context.
	 */
	get<TValue = unknown>(key: string): TValue | undefined {
		return this.storage.getStore()?.get(key) as TValue | undefined;
	}

	/**
	 * Returns true when the active request context contains a value for the key.
	 */
	has(key: string): boolean {
		return this.storage.getStore()?.has(key) ?? false;
	}

	/**
	 * Stores a value on the active request context.
	 */
	set<TValue>(key: string, value: TValue): TValue {
		const store = this.storage.getStore();

		if (!store) {
			throw new Error('No active request context.');
		}

		store.set(key, value);
		return value;
	}

	/**
	 * Returns an existing request value or stores the factory result for reuse.
	 */
	remember<TValue>(key: string, factory: () => TValue): TValue {
		const store = this.storage.getStore();

		if (!store) {
			return factory();
		}

		if (store.has(key)) {
			return store.get(key) as TValue;
		}

		const value = factory();

		store.set(key, value);

		if (isPromiseLike(value)) {
			Promise.resolve(value).catch(() => {
				if (store.get(key) === value) {
					store.delete(key);
				}
			});
		}

		return value;
	}

	/**
	 * Deletes a value from the active request context.
	 */
	delete(key: string): boolean {
		return this.storage.getStore()?.delete(key) ?? false;
	}

	/**
	 * Normalises initial request values into the internal map store.
	 */
	private initialStore(initialValues?: RequestContextValues): Map<string, unknown> {
		if (!initialValues) return new Map();
		if (initialValues instanceof Map) return new Map(initialValues);
		if (Symbol.iterator in Object(initialValues)) {
			return new Map(initialValues as Iterable<readonly [string, unknown]>);
		}

		return new Map(Object.entries(initialValues));
	}
}

/**
 * Detects promise-like values without forcing callers to return real promises.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return Boolean(
		value
			&& typeof value === 'object'
			&& 'then' in value
			&& typeof value.then === 'function',
	);
}
