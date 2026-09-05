import { Buffer } from 'node:buffer';
import { app } from '../../server/appContext';
import { type Security, SecurityError } from '../../security';
import { type BasicFieldState, type DbSchemaPart, type FieldConfig, type FieldContext, FieldType } from '../FieldType';

/**
 * Configuration for an authenticated encrypted JSON field.
 *
 * Encrypted fields are always hidden, cannot define database defaults or
 * indexes, and use long text storage because randomized ciphertext is not
 * queryable JSON.
 */
export interface EncryptedJsonFieldConfig extends Omit<
	FieldConfig,
	'hidden' | 'default' | 'unique' | 'index' | 'indexName' | 'indexes'
> {}

/**
 * Error raised when an encrypted JSON field cannot access or use the
 * application security service.
 */
export class EncryptedJsonFieldError extends Error {
	/**
	 * Creates an encrypted-field error with a user-safe message.
	 *
	 * @param message - Error message that must not contain plaintext or ciphertext.
	 * @param options - Optional underlying security-service error.
	 */
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'EncryptedJsonFieldError';
	}
}

/**
 * Field that keeps decoded JSON in application memory and delegates encrypted
 * storage to the active app's central security service.
 *
 * Ciphertext is bound to the model table and field column through additional
 * authenticated data, preventing encrypted values from being moved between
 * unrelated fields without detection.
 */
export class EncryptedJsonField<TValue> extends FieldType<
	TValue | null,
	string | Buffer | null,
	undefined,
	unknown,
	BasicFieldState<TValue | null>
> {
	declare public readonly config: EncryptedJsonFieldConfig;

	/**
	 * Creates an encrypted JSON field that is always omitted from display data.
	 *
	 * @param config - Normal field configuration for the encrypted column.
	 */
	constructor(config: EncryptedJsonFieldConfig = {}) {
		super({
			...config,
			hidden: true,
		});
	}

	/**
	 * Prevents encrypted values from being exposed through forms or JSON output.
	 *
	 * @returns Undefined for every encrypted value.
	 */
	override getDisplayValue(): undefined {
		return undefined;
	}

	/**
	 * Prevents equality queries against randomized ciphertext.
	 *
	 * @returns This method never returns.
	 */
	override getQueryValue(): never {
		throw new EncryptedJsonFieldError('Encrypted JSON fields cannot be queried directly.');
	}

	/**
	 * Describes the long text column used for versioned encrypted payloads.
	 *
	 * @param ctx - Model and database dialect context.
	 * @returns Schema metadata for the encrypted column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: this.schemaDialect().columnTypes.longText(),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
					},
				],
				indexes: [],
			}, ctx);
		});
	}

	/**
	 * Parses decoded input or a JSON document into application memory.
	 *
	 * @param input - Decoded JSON value, JSON string, or empty value.
	 * @returns Parsed value or null.
	 */
	protected override parse(input: unknown): TValue | null {
		if (input === null || input === undefined || input === '') return null;

		return typeof input === 'string'
			? JSON.parse(input) as TValue
			: input as TValue;
	}

	/**
	 * Decrypts and parses one database value through the application security service.
	 *
	 * @param input - Versioned ciphertext loaded from the database.
	 * @returns Decoded JSON value or null.
	 */
	protected override fromDbValue(input: string | Buffer | null): TValue | null {
		if (input === null || input === undefined || input === '') return null;

		const payload = Buffer.isBuffer(input) ? input.toString('utf8') : input;

		try {
			return this.#security().decryptJson<TValue>(payload, {
				additionalAuthenticatedData: this.#additionalAuthenticatedData(),
			});
		} catch (error) {
			if (error instanceof EncryptedJsonFieldError) throw error;

			throw this.#error(
				'could not be decrypted',
				error,
			);
		}
	}

	/**
	 * Serializes and encrypts one application value through the security service.
	 *
	 * @param input - Decoded JSON value held by the model.
	 * @returns Versioned authenticated ciphertext or null.
	 */
	protected override toDbValue(input: TValue | null): string | null {
		if (input === null || input === undefined) return null;

		try {
			return this.#security().encryptJson(input, {
				additionalAuthenticatedData: this.#additionalAuthenticatedData(),
			});
		} catch (error) {
			if (error instanceof EncryptedJsonFieldError) throw error;

			throw this.#error(
				'could not be encrypted',
				error,
			);
		}
	}

	/**
	 * Resolves the central security service from the active application.
	 *
	 * @returns Active application security service.
	 */
	#security(): Security {
		try {
			return app().security;
		} catch (error) {
			throw this.#error(
				'requires an active application security service',
				error,
			);
		}
	}

	/**
	 * Builds context bound into the authentication tag for this field.
	 *
	 * @returns Stable table-and-column authentication data.
	 */
	#additionalAuthenticatedData(): string {
		return `${this.model.table}:${this.column}`;
	}

	/**
	 * Creates a field-scoped error without including protected values.
	 *
	 * @param reason - Safe explanation of the field failure.
	 * @param cause - Optional security-service error retained for diagnostics.
	 * @returns Encrypted JSON field error.
	 */
	#error(reason: string, cause?: unknown): EncryptedJsonFieldError {
		const safeCause = cause instanceof SecurityError || cause instanceof Error
			? cause
			: undefined;
		const causeMessage = safeCause?.message
			? `: ${safeCause.message}`
			: '';

		return new EncryptedJsonFieldError(
			`Encrypted JSON field "${this.fieldName}" ${reason}${causeMessage}`,
			safeCause ? { cause: safeCause } : undefined,
		);
	}
}
