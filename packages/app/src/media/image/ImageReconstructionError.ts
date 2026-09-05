/**
 * Indicates that untrusted source bytes could not be decoded and reconstructed.
 *
 * Storage and database failures remain their original error types so callers
 * can distinguish invalid image input from application infrastructure errors.
 */
export class ImageReconstructionError extends Error {
	/**
	 * Creates an image reconstruction error with its processor failure attached.
	 *
	 * @param message - Stable application-facing failure summary.
	 * @param options - Standard error options containing the processor cause.
	 */
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ImageReconstructionError';
	}
}
