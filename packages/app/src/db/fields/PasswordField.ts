import {
	DbRow,
	DbSchemaPart,
	DbWriteData,
	DbWriteOptions,
	FieldConfig,
	FieldContext,
	FieldError,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import {
	defaultPasswordHash,
	type PasswordHash,
} from '../../auth/passwordHash';

/**
 * Per-record runtime state for a password field.
 *
 * The normal app-facing value is always `null`, but the state may hold an
 * existing hash or a pending plaintext password waiting to be hashed on save.
 */
export interface PasswordFieldState {
	/** Hash currently stored in memory, usually loaded from the database. */
	hash: string | null;

	/** Plaintext assigned by the app but not yet converted to a hash. */
	pendingPlainText: string | null;

	/** Hash generated during `getDataForDb()`, committed in `markClean()`. */
	preparedHash: string | null;

	/** Whether the password should be included in the next update. */
	dirty: boolean;

	/** Validation errors for this field state. */
	errors: FieldError[];
}

/**
 * Configuration for password fields.
 */
export interface PasswordFieldConfig extends FieldConfig {
	/** Minimum plaintext password length. Defaults to 12. */
	minLength?: number;

	/** Database varchar length for the hash. Defaults to 255. */
	length?: number;
}

/**
 * Password field.
 *
 * App-facing behaviour:
 * - `user.password = 'plain text'` stores pending plaintext in field state.
 * - `user.password` returns `null`.
 * - `user.toJSON()` omits the password.
 * - `user.save()` hashes pending plaintext and writes the hash to the database.
 *
 * The field clears plaintext after successful database conversion.
 */
export class PasswordField extends FieldType<
	null,
	string | null,
	undefined,
	unknown,
	PasswordFieldState
> {
	declare public readonly config: PasswordFieldConfig;

	constructor(config: PasswordFieldConfig) {
		super({
			...config,
			hidden: true,
		});
	}

	/**
	 * Creates password-specific per-record state.
	 */
	override createState(): PasswordFieldState {
		return {
			hash: null,
			pendingPlainText: null,
			preparedHash: null,
			dirty: false,
			errors: [],
		};
	}

	/**
	 * Stores pending plaintext for hashing later during `getDataForDb()`.
	 */
	override setValue(
		state: PasswordFieldState,
		input: unknown,
		ctx?: FieldContext,
	): void {
		return this.withContext(ctx, () => {
			if (input === null || input === undefined || input === '') {
				state.pendingPlainText = null;
				state.dirty = true;
				return;
			}

			state.pendingPlainText = String(input);
			state.preparedHash = null;
			state.dirty = true;
		});
	}

	/**
	 * Never exposes a password or hash through normal property access.
	 */
	override getValue(): null {
		return null;
	}

	protected override defaultFormComponent(): string {
		return 'DomPasswordInput';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return null;
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'string',
			{
				rule: 'minLength',
				value: this.config.minLength ?? 12,
			},
		];
	}

	/**
	 * Hydrates the existing password hash from a raw database row.
	 */
	override setFromDb(
		state: PasswordFieldState,
		row: DbRow,
		ctx?: FieldContext,
	): void {
		return this.withContext(ctx, () => {
			state.hash = row[this.column] === null || row[this.column] === undefined
				? null
				: String(row[this.column]);

			state.pendingPlainText = null;
			state.preparedHash = null;
			state.dirty = false;
			state.errors = [];
		});
	}

	/**
	 * Validates required/minimum length rules.
	 */
	override async validate(
		state: PasswordFieldState,
		ctx?: FieldContext,
	): Promise<FieldError[]> {
		return this.withContext(ctx, async () => {
			state.errors = [];

			if (this.config.required && !state.hash && !state.pendingPlainText) {
				state.errors.push({
					field: this.fieldName,
					message: `${this.fieldName} is required`,
					code: 'required',
				});
			}

			const minLength = this.config.minLength ?? 12;

			if (state.pendingPlainText && state.pendingPlainText.length < minLength) {
				state.errors.push({
					field: this.fieldName,
					message: `${this.fieldName} must be at least ${minLength} characters`,
					code: 'minLength',
					details: { minLength },
				});
			}

			return state.errors;
		});
	}

	/**
	 * Produces the database hash column.
	 */
	override getDataForDb(
		state: PasswordFieldState,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override getDataForDb(
		state: PasswordFieldState,
		ctx: FieldContext,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override async getDataForDb(
		state: PasswordFieldState,
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): Promise<DbWriteData> {
		const args = this.resolveDbWriteArgs(ctxOrOptions, options);

		return this.withContext(args.ctx, async () => {
			if (args.options.onlyDirty && !state.dirty) {
				return {};
			}

			if (state.pendingPlainText) {
				state.preparedHash = await defaultPasswordHash.hash(state.pendingPlainText);

				return {
					[this.column]: state.preparedHash,
				};
			}

			if (state.hash) {
				return {
					[this.column]: state.hash,
				};
			}

			return {};
		});
	}

	/**
	 * Commits the prepared hash and clears plaintext after successful save.
	 */
	override markClean(state: PasswordFieldState): void {
		if (state.preparedHash) {
			state.hash = state.preparedHash;
		}

		state.pendingPlainText = null;
		state.preparedHash = null;
		state.dirty = false;
		state.errors = [];
	}

	/**
	 * Verifies a plaintext password against this field's hydrated hash.
	 */
	verifyPassword(
		plainText: string,
		passwordHash: PasswordHash = defaultPasswordHash,
	): Promise<boolean> {
		return this.state.hash
			? passwordHash.verify(plainText, this.state.hash)
			: Promise.resolve(false);
	}

	/**
	 * Passwords are omitted from JSON output.
	 */
	override getDisplayValue(): undefined {
		return undefined;
	}

	/**
	 * Prevents accidental password querying.
	 */
	override getQueryValue(): never {
		throw new Error('Password fields cannot be queried directly');
	}

	/**
	 * Describes the password hash database column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.varchar(this.config.length ?? 255),
						nullable: !this.config.required,
						default: this.getDbDefaultValue(),
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}
}
