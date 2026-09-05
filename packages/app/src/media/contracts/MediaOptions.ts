import type { ImageVariantCacheOptions } from '../image/contracts';

/**
 * Framework media-service configuration.
 */
export interface MediaOptions {
	/** Responsive-image rendering and disposable cache configuration. */
	images?: ImageVariantCacheOptions;
}
