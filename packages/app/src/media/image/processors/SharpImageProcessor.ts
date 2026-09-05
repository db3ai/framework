import sharp, { type Sharp } from 'sharp';
import type { ImageProcessor, ImageProcessorCommand, ImageProcessorReconstructionCommand } from '../contracts';

const IMAGE_VARIANT_INPUT_PIXEL_LIMIT = 40_000_000;
const IMAGE_VARIANT_PROCESSING_TIMEOUT_SECONDS = 20;
const CANONICAL_JPEG_QUALITY = 90;
const CANONICAL_WEBP_QUALITY = 90;

/**
 * Sharp/libvips image processor used by the framework's default media service.
 */
export class SharpImageProcessor implements ImageProcessor {
	/**
	 * Creates a bounded Sharp transform for one validated framework command.
	 *
	 * @param command - Trusted image transformation command.
	 * @returns Sharp duplex stream for encoded source and output bytes.
	 */
	transform(command: ImageProcessorCommand): Sharp {
		let image = this.#source(false);

		if (command.width !== null) {
			image = image.resize({
				width: command.width,
				withoutEnlargement: true,
			});
		}

		switch (command.outputMimeType) {
			case 'image/avif':
				return image.avif({
					quality: 50,
				});
			case 'image/jpeg':
				return image.jpeg({
					progressive: true,
					quality: 82,
				});
			case 'image/png':
				return image.png({
					compressionLevel: 9,
				});
			case 'image/webp':
				return image.webp({
					quality: 82,
				});
			default:
				throw new Error(`Sharp cannot encode responsive image MIME type "${command.outputMimeType}".`);
		}
	}

	/**
	 * Creates a bounded full-resolution reconstruction of untrusted image bytes.
	 *
	 * Reconstruction preserves animated GIF and WebP frames, applies source
	 * orientation, and relies on Sharp's default metadata removal.
	 *
	 * @param command - Validated canonical reconstruction command.
	 * @returns Sharp duplex stream for complete decoding and canonical encoding.
	 */
	reconstruct(command: ImageProcessorReconstructionCommand): Sharp {
		const image = this.#source(isAnimatedImageMimeType(command.sourceMimeType));

		switch (command.outputMimeType) {
			case 'image/avif':
				return image.avif({
					quality: 65,
				});
			case 'image/gif':
				return image.gif({
					effort: 7,
					interFrameMaxError: 0,
				});
			case 'image/jpeg':
				return image.jpeg({
					progressive: true,
					quality: CANONICAL_JPEG_QUALITY,
				});
			case 'image/png':
				return image.png({
					compressionLevel: 9,
				});
			case 'image/webp':
				return image.webp({
					effort: 5,
					quality: CANONICAL_WEBP_QUALITY,
				});
			default:
				throw new Error(`Sharp cannot reconstruct image MIME type "${command.outputMimeType}".`);
		}
	}

	/**
	 * Creates one security-bounded Sharp input pipeline.
	 *
	 * @param animated - Whether all frames from a supported animated source are decoded.
	 * @returns Sharp input stream with decode limits, orientation, and timeout configured.
	 */
	#source(animated: boolean): Sharp {
		return sharp({
			animated,
			failOn: 'warning',
			limitInputPixels: IMAGE_VARIANT_INPUT_PIXEL_LIMIT,
			sequentialRead: true,
		})
			.autoOrient()
			.timeout({
				seconds: IMAGE_VARIANT_PROCESSING_TIMEOUT_SECONDS,
			});
	}
}

/**
 * Returns whether reconstruction must decode every source animation frame.
 *
 * @param mimeType - Normalized source image MIME type.
 * @returns True for supported animated container formats.
 */
function isAnimatedImageMimeType(mimeType: string): boolean {
	return mimeType === 'image/gif' || mimeType === 'image/webp';
}
