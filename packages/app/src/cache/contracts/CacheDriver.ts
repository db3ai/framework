import type { CacheRepository } from './CacheRepository';

/**
 * Cache backend boundary owned by the framework cache service.
 */
export interface CacheDriver extends CacheRepository {
	/**
	 * Releases connections and other resources held by the cache backend.
	 */
	close(): Promise<void>;
}
