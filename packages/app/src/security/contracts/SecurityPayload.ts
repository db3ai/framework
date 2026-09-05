import type { Buffer } from 'node:buffer';

/**
 * Per-operation options for authenticated encryption and decryption.
 */
export interface SecurityPayloadOptions {
	/**
	 * Optional context authenticated with the payload but not stored inside it.
	 *
	 * Callers can use this to bind ciphertext to a model field, tenant, or other
	 * stable ownership boundary.
	 */
	additionalAuthenticatedData?: string | Buffer;
}
