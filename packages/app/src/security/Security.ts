import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { app } from '../server/appContext';
import type * as security from './contracts';
import { SecurityError } from './SecurityError';

const DEFAULT_CIPHER: security.SecurityCipher = 'aes-256-gcm';
const ENCRYPTION_KEY_BYTES = 32;
const INITIALIZATION_VECTOR_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const PAYLOAD_FORMAT = 'security';
const PAYLOAD_VERSION = '1';

/**
 * Central application service for versioned authenticated encryption.
 *
 * The service owns key resolution, cipher policy, payload framing, and JSON
 * serialization so fields and application services do not implement their own
 * cryptographic formats.
 *
 * @example
 * const encrypted = app().security.encryptJson({
 * 	token: 'provider-secret',
 * });
 * const decrypted = app().security.decryptJson<{ token: string }>(encrypted);
 */
export class Security {
	/**
	 * Central key source and encryption policy.
	 */
	readonly #options: security.SecurityOptions;

	/**
	 * Validated key pinned for this service lifetime.
	 */
	readonly #encryptionKey: Buffer;

	/**
	 * Creates the application security service from the active app config.
	 */
	constructor() {
		const options = app().config.get<security.SecurityOptions>('security', {});

		this.#options = {
			...options,
			key: Buffer.isBuffer(options.key)
				? Buffer.from(options.key)
				: options.key,
		};
		this.#encryptionKey = this.#validateKey(this.#options.key);
	}

	/**
	 * Generates a new base64-formatted 256-bit application key.
	 *
	 * @returns Value suitable for an `APP_KEY` environment variable.
	 */
	static generateKey(): string {
		return `base64:${randomBytes(ENCRYPTION_KEY_BYTES).toString('base64')}`;
	}

	/**
	 * Encrypts bytes or text with authenticated encryption.
	 *
	 * @param value - Plaintext bytes or UTF-8 text.
	 * @param options - Optional additional authenticated ownership context.
	 * @returns Versioned encrypted payload safe for text storage.
	 */
	encrypt(
		value: string | Buffer,
		options: security.SecurityPayloadOptions = {},
	): string {
		const cipherName = this.#cipher();
		const iv = randomBytes(INITIALIZATION_VECTOR_BYTES);
		const cipher = createCipheriv(cipherName, this.#key(), iv);

		cipher.setAAD(additionalAuthenticatedData(options));

		const ciphertext = Buffer.concat([
			cipher.update(bufferValue(value)),
			cipher.final(),
		]);
		const authenticationTag = cipher.getAuthTag();

		return [
			PAYLOAD_FORMAT,
			PAYLOAD_VERSION,
			cipherName,
			iv.toString('base64url'),
			authenticationTag.toString('base64url'),
			ciphertext.toString('base64url'),
		].join(':');
	}

	/**
	 * Decrypts and authenticates a versioned security payload.
	 *
	 * @param payload - Encrypted payload created by {@link encrypt}.
	 * @param options - Additional authenticated data supplied during encryption.
	 * @returns Decrypted plaintext bytes.
	 */
	decrypt(
		payload: string,
		options: security.SecurityPayloadOptions = {},
	): Buffer {
		const parsed = parsePayload(payload);
		const configuredCipher = this.#cipher();

		if (parsed.cipher !== configuredCipher) {
			throw new SecurityError(
				`Encrypted payload uses unsupported cipher "${parsed.cipher}".`,
			);
		}

		try {
			const decipher = createDecipheriv(
				configuredCipher,
				this.#key(),
				parsed.initializationVector,
			);

			decipher.setAAD(additionalAuthenticatedData(options));
			decipher.setAuthTag(parsed.authenticationTag);

			return Buffer.concat([
				decipher.update(parsed.ciphertext),
				decipher.final(),
			]);
		} catch (error) {
			if (error instanceof SecurityError) throw error;

			throw new SecurityError(
				'Encrypted payload could not be decrypted. Verify the application key and payload integrity.',
				{ cause: error },
			);
		}
	}

	/**
	 * Serializes and encrypts a JSON-compatible value.
	 *
	 * @param value - JSON-compatible value to protect.
	 * @param options - Optional additional authenticated ownership context.
	 * @returns Versioned encrypted payload safe for text storage.
	 */
	encryptJson<TValue>(
		value: TValue,
		options: security.SecurityPayloadOptions = {},
	): string {
		let serialized: string;

		try {
			const json = JSON.stringify(value);

			if (json === undefined) {
				throw new TypeError('Value is not JSON serializable.');
			}

			serialized = json;
		} catch (error) {
			throw new SecurityError(
				'Security value could not be serialized as JSON.',
				{ cause: error },
			);
		}

		return this.encrypt(serialized, options);
	}

	/**
	 * Decrypts and parses a JSON-compatible value.
	 *
	 * @param payload - Encrypted JSON payload created by {@link encryptJson}.
	 * @param options - Additional authenticated data supplied during encryption.
	 * @returns Decrypted and parsed JSON value.
	 */
	decryptJson<TValue>(
		payload: string,
		options: security.SecurityPayloadOptions = {},
	): TValue {
		const plaintext = this.decrypt(payload, options).toString('utf8');

		try {
			return JSON.parse(plaintext) as TValue;
		} catch (error) {
			throw new SecurityError(
				'Decrypted security payload does not contain valid JSON.',
				{ cause: error },
			);
		}
	}

	/**
	 * Resolves and validates the configured encryption cipher.
	 *
	 * @returns Supported authenticated encryption cipher.
	 */
	#cipher(): security.SecurityCipher {
		const cipher = this.#options.cipher ?? DEFAULT_CIPHER;

		if (cipher !== DEFAULT_CIPHER) {
			throw new SecurityError(`Unsupported security cipher "${String(cipher)}".`);
		}

		return cipher;
	}

	/**
	 * Resolves and validates the central 256-bit application key.
	 *
	 * @returns Raw AES-256 key bytes.
	 */
	#key(): Buffer {
		return this.#encryptionKey;
	}

	/**
	 * Validates configured key material and returns detached raw bytes.
	 *
	 * @param input - Raw or encoded application key.
	 * @returns Validated AES-256 key bytes.
	 */
	#validateKey(input: string | Buffer | undefined): Buffer {
		if (
			input === undefined
			|| (typeof input === 'string' && input.trim() === '')
			|| (Buffer.isBuffer(input) && input.length === 0)
		) {
			throw new SecurityError(
				'Application security requires a configured 32-byte key.',
			);
		}

		const key = securityKeyBuffer(input);

		if (key.length !== ENCRYPTION_KEY_BYTES) {
			throw new SecurityError(
				'Application security key must contain exactly 32 bytes.',
			);
		}

		return key;
	}
}

/**
 * Parsed authenticated encryption payload.
 */
interface ParsedSecurityPayload {
	/** Cipher recorded by the payload format. */
	cipher: string;

	/** Random initialization vector used for this payload. */
	initializationVector: Buffer;

	/** GCM authentication tag protecting ciphertext and caller context. */
	authenticationTag: Buffer;

	/** Encrypted plaintext bytes. */
	ciphertext: Buffer;
}

/**
 * Parses and validates the non-secret structure of an encrypted payload.
 *
 * @param payload - Versioned encrypted payload.
 * @returns Validated cipher and binary payload components.
 */
function parsePayload(payload: string): ParsedSecurityPayload {
	const parts = payload.split(':');
	const [format, version, cipher, encodedIv, encodedTag, encodedCiphertext] = parts;

	if (
		parts.length !== 6
		|| format !== PAYLOAD_FORMAT
		|| version !== PAYLOAD_VERSION
		|| !cipher
		|| !encodedIv
		|| !encodedTag
		|| encodedCiphertext === undefined
	) {
		throw new SecurityError('Encrypted payload has an unsupported or malformed format.');
	}

	const initializationVector = Buffer.from(encodedIv, 'base64url');
	const authenticationTag = Buffer.from(encodedTag, 'base64url');
	const ciphertext = Buffer.from(encodedCiphertext, 'base64url');

	if (
		initializationVector.length !== INITIALIZATION_VECTOR_BYTES
		|| authenticationTag.length !== AUTHENTICATION_TAG_BYTES
	) {
		throw new SecurityError('Encrypted payload has an unsupported or malformed format.');
	}

	return {
		cipher,
		initializationVector,
		authenticationTag,
		ciphertext,
	};
}

/**
 * Converts configured key input into raw bytes.
 *
 * @param input - Raw, UTF-8, or `base64:`-prefixed key material.
 * @returns Raw encryption key bytes.
 */
function securityKeyBuffer(input: string | Buffer): Buffer {
	if (Buffer.isBuffer(input)) return Buffer.from(input);

	const value = input.trim();

	return value.startsWith('base64:')
		? Buffer.from(value.slice('base64:'.length), 'base64')
		: Buffer.from(value, 'utf8');
}

/**
 * Converts text or byte input into a detached buffer.
 *
 * @param value - Text or bytes supplied by the caller.
 * @returns Plaintext buffer.
 */
function bufferValue(value: string | Buffer): Buffer {
	return Buffer.isBuffer(value)
		? Buffer.from(value)
		: Buffer.from(value, 'utf8');
}

/**
 * Resolves additional authenticated data into bytes.
 *
 * @param options - Caller-provided authenticated context.
 * @returns Context bytes, or an empty buffer.
 */
function additionalAuthenticatedData(
	options: security.SecurityPayloadOptions,
): Buffer {
	const value = options.additionalAuthenticatedData;

	if (value === undefined) return Buffer.alloc(0);

	return bufferValue(value);
}
