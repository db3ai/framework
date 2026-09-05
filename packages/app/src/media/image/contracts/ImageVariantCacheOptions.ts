/**
 * Storage configuration for disposable responsive-image variants.
 *
 * Generated variants are derived from durable managed files and may be removed
 * at any time. A missing variant is regenerated on the next image request.
 */
export interface ImageVariantCacheOptions {
	/**
	 * Named storage disk used for generated variants.
	 *
	 * Omit this value to use the managed source file's disk.
	 */
	cacheDisk?: string;

	/**
	 * Relative directory containing generated variants on the cache disk.
	 *
	 * Defaults to `image-cache`.
	 */
	cachePrefix?: string;
}
