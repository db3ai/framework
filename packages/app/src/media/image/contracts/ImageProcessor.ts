import type { Duplex } from 'node:stream';

/**
 * Allowlisted image transformation passed to a concrete processing engine.
 */
export interface ImageProcessorCommand {
	/** Normalized MIME type of the encoded source stream. */
	sourceMimeType: string;

	/** Normalized MIME type the processor must emit. */
	outputMimeType: string;

	/** Maximum output width in pixels, or null to preserve source dimensions. */
	width: number | null;
}

/**
 * Canonical image reconstruction passed to a concrete processing engine.
 *
 * Reconstruction decodes the complete untrusted input and emits a new image
 * without preserving source metadata or trailing source bytes.
 */
export interface ImageProcessorReconstructionCommand {
	/** Normalized MIME type already identified from the encoded source stream. */
	sourceMimeType: string;

	/** Normalized MIME type the processor must use for the reconstructed image. */
	outputMimeType: string;
}

/**
 * Adapter implemented by a concrete image processing engine.
 *
 * The framework owns request parsing, cache identity, storage, and concurrency.
 * Processors only translate a trusted command into a bounded transform stream.
 */
export interface ImageProcessor {
	/**
	 * Creates a stream that transforms encoded source bytes into an image variant.
	 *
	 * @param command - Validated transformation command.
	 * @returns Duplex stream that accepts source bytes and emits encoded output.
	 */
	transform(command: ImageProcessorCommand): Duplex;

	/**
	 * Creates a stream that fully decodes and reconstructs an untrusted image.
	 *
	 * @param command - Validated canonical reconstruction command.
	 * @returns Duplex stream that accepts source bytes and emits reconstructed bytes.
	 */
	reconstruct(command: ImageProcessorReconstructionCommand): Duplex;
}
