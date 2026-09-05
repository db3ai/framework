import type { Readable } from 'node:stream';

/**
 * Maximum rendered image width accepted by the framework.
 *
 * Bounding width protects the application from accidental or malicious
 * requests that would create excessively large decoded images.
 */
export const MAX_IMAGE_VARIANT_WIDTH = 4096;

/**
 * Options that identify one cached responsive image variant.
 */
export interface ImageVariantOptions {
	/**
	 * Requested pixel width. Aspect ratio is preserved and images are never
	 * enlarged. Omit the width to compress the source at its original dimensions.
	 */
	width?: number;
}

/**
 * Storage-backed responsive image returned by the media service.
 */
export interface ImageVariant {
	/** Rendered image stream loaded from durable storage. */
	stream: Readable;

	/** MIME type of the rendered bytes. */
	mimeType: string;

	/** Storage path used on the configured disposable cache disk, or null for passthrough images. */
	path: string | null;

	/** Whether the bytes were loaded from an existing generated variant. */
	cached: boolean;
}
