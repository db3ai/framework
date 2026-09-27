import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import type { Storage, StorageDisk, StorageEntry } from '../../storage';
import { normalizeStoragePath } from '../../storage/path';
import type { ImageProcessor, ImageVariant, ImageVariantCacheOptions, ImageVariantOptions } from './contracts';
import { MAX_IMAGE_VARIANT_WIDTH } from './contracts';
import type { MediaFile } from '../MediaFile';
import { SharpImageProcessor } from './processors/SharpImageProcessor';

const IMAGE_VARIANT_CACHE_VERSION = 'v1';
const DEFAULT_IMAGE_VARIANT_CACHE_PREFIX = 'image-cache';
const IMAGE_VARIANT_OUTPUT_MIME_TYPE = 'image/webp';
const MAX_CONCURRENT_IMAGE_RENDERS = 2;
const PASSTHROUGH_IMAGE_MIME_TYPES = new Set([
	'image/gif',
	'image/svg+xml',
]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
	'image/avif',
	'image/jpeg',
	'image/png',
	'image/webp',
]);

/**
 * Renders responsive variants of managed images into disposable storage.
 */
export class ImageVariantRenderer {
	#activeRenders = 0;
	readonly #cacheDiskName: string | null;
	readonly #cachePrefix: string;
	readonly #pendingRenders = new Map<string, Promise<void>>();
	readonly #renderWaiters: Array<() => void> = [];

	/**
	 * Creates an image renderer backed by application storage.
	 *
	 * @param storage - Storage service used to read source bytes and cache variants.
	 * @param options - Disposable cache disk and directory configuration.
	 * @param processor - Image processing engine used for cache misses.
	 */
	constructor(
		private readonly storage: Storage,
		options: ImageVariantCacheOptions = {},
		private readonly processor: ImageProcessor = new SharpImageProcessor(),
	) {
		this.#cacheDiskName = optionalNonEmptyString(
			options.cacheDisk,
			'Image variant cache disk',
		);
		this.#cachePrefix = normalizeStoragePath(
			options.cachePrefix ?? DEFAULT_IMAGE_VARIANT_CACHE_PREFIX,
		);
	}

	/**
	 * Returns a width-constrained image, using the disposable cache when available.
	 *
	 * SVG and animated GIF sources are returned unchanged because they either
	 * scale natively or must preserve animation. Raster variants emit compressed
	 * WebP while preserving aspect ratio and orientation without enlargement.
	 * Failed renders settle source and cache streams before removing partial files.
	 *
	 * @param file - Managed source image.
	 * @param options - Variant dimensions that form the cache identity.
	 * @returns Rendered or cached image variant.
	 *
	 * @example
	 * const image = await app.media.renderImage(file, {
	 * 	width: 640,
	 * });
	 */
	async render(file: MediaFile, options: ImageVariantOptions): Promise<ImageVariant> {
		const width = imageVariantWidth(options.width);
		const sourceMimeType = normalizedImageMimeType(file.mimeType);
		const sourceDiskName = requiredMediaFileValue(file.disk, 'Managed image disk is required.');
		const sourcePath = requiredMediaFileValue(file.path, 'Managed image path is required.');
		const sourceDisk = this.storage.disk(sourceDiskName);

		if (PASSTHROUGH_IMAGE_MIME_TYPES.has(sourceMimeType)) {
			return {
				stream: await sourceDisk.readStream(sourcePath),
				mimeType: sourceMimeType,
				path: null,
				cached: false,
			};
		}

		if (!SUPPORTED_IMAGE_MIME_TYPES.has(sourceMimeType)) {
			throw new Error(`Managed media type "${sourceMimeType}" cannot be rendered as a responsive image.`);
		}

		const mimeType = IMAGE_VARIANT_OUTPUT_MIME_TYPE;
		const fileId = requiredMediaFileValue(file.id, 'Managed image id is required.');
		const cacheDiskName = this.#cacheDiskName ?? sourceDiskName;
		const cacheDisk = this.storage.disk(cacheDiskName);
		const path = imageVariantPath(this.#cachePrefix, fileId, width, mimeType);

		if (await cacheDisk.exists(path)) {
			return {
				stream: await cacheDisk.readStream(path),
				mimeType,
				path,
				cached: true,
			};
		}

		let cached = false;
		const renderKey = `${cacheDiskName}:${path}`;
		const pendingRender = this.#pendingRenders.get(renderKey);

		if (pendingRender) {
			await pendingRender;
			cached = true;
		} else {
			const render = this.#withRenderSlot(async () => {
				if (await cacheDisk.exists(path)) {
					cached = true;
					return;
				}

				const source = await sourceDisk.readStream(sourcePath);
				const renderer = this.processor.transform({
					sourceMimeType,
					outputMimeType: mimeType,
					width,
				});
				const temporaryPath = `${path}.tmp-${randomUUID()}`;
				const processing = pipeline(source, renderer);
				const writing = cacheDisk.writeStream(temporaryPath, renderer, {
					mimeType,
					visibility: 'private',
				});

				try {
					await Promise.all([processing, writing]);
					await cacheDisk.move(temporaryPath, path);
				} catch (error) {
					// Stop both streams and finish storage work before removing partial bytes.
					source.destroy();
					renderer.destroy();
					await Promise.allSettled([processing, writing]);
					await deleteVariantQuietly(cacheDisk, temporaryPath);
					throw error;
				}
			});

			this.#pendingRenders.set(renderKey, render);

			try {
				await render;
			} finally {
				if (this.#pendingRenders.get(renderKey) === render) {
					this.#pendingRenders.delete(renderKey);
				}
			}
		}

		return {
			stream: await cacheDisk.readStream(path),
			mimeType,
			path,
			cached,
		};
	}

	/**
	 * Deletes every disposable responsive variant derived from a managed image.
	 *
	 * @param file - Managed source image whose cached variants should be removed.
	 * @returns Number of cached variant files deleted from storage.
	 */
	async deleteCachedVariants(file: MediaFile): Promise<number> {
		const fileId = requiredMediaFileValue(file.id, 'Managed image id is required.');
		const sourceDiskName = requiredMediaFileValue(file.disk, 'Managed image disk is required.');
			const cacheDiskName = this.#cacheDiskName ?? sourceDiskName;
			const cacheDisk = this.storage.disk(cacheDiskName);
			const path = imageVariantDirectoryPath(this.#cachePrefix, fileId);
			let entries: StorageEntry[];

			try {
				entries = await cacheDisk.list(path, {
					deep: true,
				}).toArray(false);
			} catch (error) {
				if (isMissingStorageDirectory(error)) return 0;

				throw error;
			}
			let deleted = 0;

		for (const entry of entries) {
			if (!entry.isFile) continue;

			if (await cacheDisk.delete(entry.path)) {
				deleted += 1;
			}
		}

		return deleted;
	}

	/**
	 * Runs one cache-generating render within the per-process concurrency bound.
	 *
	 * @param task - Render operation that writes one disposable cache entry.
	 * @returns Task result after a render slot becomes available.
	 */
	async #withRenderSlot<TResult>(task: () => Promise<TResult>): Promise<TResult> {
		if (this.#activeRenders >= MAX_CONCURRENT_IMAGE_RENDERS) {
			await new Promise<void>(resolve => {
				this.#renderWaiters.push(resolve);
			});
		} else {
			this.#activeRenders += 1;
		}

		try {
			return await task();
		} finally {
			const next = this.#renderWaiters.shift();

			if (next) {
				next();
			} else {
				this.#activeRenders -= 1;
			}
		}
	}
}

/**
 * Builds the disposable cache path for one image variant.
 *
 * @param cachePrefix - Relative cache directory on the configured disk.
 * @param fileId - Immutable managed source-file ULID.
 * @param width - Validated requested width, or null for original dimensions.
 * @param mimeType - Normalized output MIME type.
 * @returns Storage path beneath the disposable image-cache directory.
 */
function imageVariantPath(
	cachePrefix: string,
	fileId: string,
	width: number | null,
	mimeType: string,
): string {
	const extension = imageExtension(mimeType);
	const variantName = width === null ? 'original' : `w-${width}`;

	return normalizeStoragePath(
		`${cachePrefix}/${IMAGE_VARIANT_CACHE_VERSION}/${fileId}/${variantName}.${extension}`,
	);
}

/**
 * Builds the storage directory containing every cached variant for one image.
 *
 * @param cachePrefix - Relative cache directory on the configured disk.
 * @param fileId - Immutable managed source-file ULID.
 * @returns Directory path containing all cached variants for the image.
 */
function imageVariantDirectoryPath(cachePrefix: string, fileId: string): string {
	return normalizeStoragePath(
		`${cachePrefix}/${IMAGE_VARIANT_CACHE_VERSION}/${fileId}`,
	);
}

/**
 * Returns whether a storage listing failed because its directory is absent.
 *
 * Flystorage wraps provider errors, so the native missing-path code can appear
 * on any cause in the chain. Other listing failures remain visible to callers.
 *
 * @param error - Unknown storage listing failure.
 * @returns True when an underlying provider reports a missing directory.
 */
function isMissingStorageDirectory(error: unknown): boolean {
	let current = error;

	while (current && typeof current === 'object') {
		if ((current as { code?: unknown }).code === 'ENOENT') return true;

		current = (current as { cause?: unknown }).cause;
	}

	return false;
}

/**
 * Returns the conventional extension for a supported image MIME type.
 *
 * @param mimeType - Normalized image MIME type.
 * @returns Filename extension without a leading dot.
 */
function imageExtension(mimeType: string): string {
	switch (mimeType) {
		case 'image/avif':
			return 'avif';
		case 'image/jpeg':
			return 'jpg';
		case 'image/png':
			return 'png';
		case 'image/webp':
			return 'webp';
		default:
			throw new Error(`Unsupported responsive image MIME type "${mimeType}".`);
	}
}

/**
 * Validates one requested responsive image width.
 *
 * @param value - Optional requested pixel width.
 * @returns Validated integer width, or null to preserve source dimensions.
 */
function imageVariantWidth(value: number | undefined): number | null {
	if (value === undefined) return null;

	if (!Number.isInteger(value) || value < 1 || value > MAX_IMAGE_VARIANT_WIDTH) {
		throw new RangeError(`Image width must be an integer between 1 and ${MAX_IMAGE_VARIANT_WIDTH}.`);
	}

	return value;
}

/**
 * Normalizes common image MIME aliases.
 *
 * @param value - MIME type recorded on the managed file.
 * @returns Normalized lower-case MIME type.
 */
function normalizedImageMimeType(value: string | null): string {
	const mimeType = String(value || '').trim().toLowerCase();

	return mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
}

/**
 * Requires a non-empty managed file field.
 *
 * @param value - Nullable model field value.
 * @param message - Error message used when the field is empty.
 * @returns Non-empty string value.
 */
function requiredMediaFileValue(value: string | null, message: string): string {
	const normalized = String(value || '').trim();

	if (!normalized) throw new Error(message);

	return normalized;
}

/**
 * Validates one optional configuration string.
 *
 * @param value - Optional string configuration.
 * @param label - Human-readable configuration label.
 * @returns Trimmed string, or null when the option is omitted.
 */
function optionalNonEmptyString(value: string | undefined, label: string): string | null {
	if (value === undefined) return null;

	const normalized = value.trim();

	if (!normalized) {
		throw new Error(`${label} must be a non-empty string.`);
	}

	return normalized;
}

/**
 * Removes an incomplete variant without masking the render failure.
 *
 * @param disk - Storage disk containing the temporary variant.
 * @param path - Temporary storage path to remove.
 * @returns Promise that resolves after the best-effort cleanup.
 */
async function deleteVariantQuietly(disk: StorageDisk, path: string): Promise<void> {
	try {
		await disk.delete(path);
	} catch {
		// The original render or storage error is more actionable than cleanup failure.
	}
}
