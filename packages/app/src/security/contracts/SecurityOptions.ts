import type { Buffer } from 'node:buffer';

/**
 * Authenticated encryption ciphers supported by the framework security service.
 */
export type SecurityCipher = 'aes-256-gcm';

/**
 * Central application security configuration.
 */
export interface SecurityOptions {
	/**
	 * Application encryption key as 32 raw bytes, a 32-byte UTF-8 string, or a
	 * `base64:`-prefixed value.
	 */
	key?: string | Buffer;

	/** Authenticated encryption cipher used for new payloads. */
	cipher?: SecurityCipher;
}
