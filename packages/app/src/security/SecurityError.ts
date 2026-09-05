/**
 * Error raised when the application security service cannot safely complete an
 * encryption, decryption, or key operation.
 */
export class SecurityError extends Error {
	/**
	 * Creates a security error with a message that must not contain protected data.
	 *
	 * @param message - User-safe explanation of the security failure.
	 * @param options - Optional error cause retained for server-side diagnostics.
	 */
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'SecurityError';
	}
}
