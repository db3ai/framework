import type { ImageVariantOptions } from './contracts';
import { MAX_IMAGE_VARIANT_WIDTH } from './contracts';

/**
 * Error raised when an untrusted image variant request cannot be translated
 * into an allowlisted framework command.
 */
export class ImageVariantRequestError extends RangeError {
	/**
	 * Creates an invalid image request error.
	 *
	 * @param message - Safe explanation suitable for an HTTP error response.
	 * @param code - Stable application error code for HTTP adapters.
	 */
	constructor(message: string, readonly code: 'invalid_image_width') {
		super(message);
		this.name = 'ImageVariantRequestError';
	}
}

/**
 * Translates URL query parameters into a safe image variant command.
 *
 * Only documented parameters are interpreted. Unknown parameters are ignored
 * and no processor option is accepted directly from the request.
 *
 * @param searchParams - URL query parameters supplied by an HTTP adapter.
 * @returns Validated variant options, or null when the original is requested.
 *
 * @example
 * const options = imageVariantOptionsFromSearchParams(requestUrl.searchParams);
 */
export function imageVariantOptionsFromSearchParams(searchParams: URLSearchParams): ImageVariantOptions | null {
	const requestedWidth = searchParams.get('w');

	if (requestedWidth === null) {
		return null;
	}

	if (!/^[1-9]\d*$/.test(requestedWidth)) {
		throw invalidImageWidth();
	}

	const width = Number(requestedWidth);

	if (!Number.isSafeInteger(width) || width > MAX_IMAGE_VARIANT_WIDTH) {
		throw invalidImageWidth();
	}

	return {
		width,
	};
}

/**
 * Creates the canonical invalid-width error.
 *
 * @returns Safe image request error.
 */
function invalidImageWidth(): ImageVariantRequestError {
	return new ImageVariantRequestError(
		`Image width must be an integer between 1 and ${MAX_IMAGE_VARIANT_WIDTH}.`,
		'invalid_image_width',
	);
}
