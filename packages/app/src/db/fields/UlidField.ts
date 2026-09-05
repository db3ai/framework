import { isUlid, ulid } from '@db3.ai/pure/ulid';
import {
	BasicFieldState,
	DbSchemaPart,
	DbWriteData,
	DbWriteOptions,
	FieldContext,
	FieldError,
	fieldSchemaIndexes,
} from '../FieldType';
import type { ValidationRule } from '../../validation';

import { StringField, StringFieldConfig } from './StringField';

/**
 * Configuration for ULID fields.
 */
export interface UlidFieldConfig extends StringFieldConfig {
	/**
	 * Character length. ULIDs are canonically 26 characters.
	 */
	length?: 26;

	/**
	 * Whether the field should generate a ULID automatically.
	 *
	 * Kept as serialisable data so this config can be stored in JSON/database.
	 */
	generated?: boolean | 'ulid' | 'db';

	/**
	 * Whether values should be normalised to uppercase.
	 *
	 * ULIDs are case-insensitive, but canonical representation is uppercase.
	 */
	uppercase?: boolean;
}

/**
 * ULID field stored as `char(26)` by default.
 *
 * ULIDs are useful primary keys because their string representation sorts
 * approximately by creation time.
 */
export class UlidField extends StringField {
	declare public readonly config: UlidFieldConfig;

	constructor(config: UlidFieldConfig = {}) {
		super({
			primary: true,
			generated: true,
			required: true,
			length: 26,
			maxLength: 26,
			trim: true,
			uppercase: true,
			...config,
		});
	}

	/**
	 * Creates per-record state.
	 *
	 * If generated is enabled, this creates the ULID immediately so `record.id`
	 * is available before save.
	 */
	override createState(ctx?: FieldContext): BasicFieldState<string | null> {
		const state = super.createState(ctx) as BasicFieldState<string | null>;

		if (!state.value && this.shouldGenerateInApp()) {
			state.value = ulid();
			state.originalValue = state.value;
			state.dirty = false;
		}

		return state;
	}

	/**
	 * Parses app input into canonical ULID form.
	 */
	protected override parse(input: unknown): string | null {
		const value = super.parse(input);

		if (!value) {
			return null;
		}

		return this.config.uppercase === false
			? value
		: value.toUpperCase();
	}

	/**
	 * Returns request-level validation rules for ULID input.
	 */
	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'ulid',
		];
	}

	/**
	 * Converts this field to database write data.
	 *
	 * If `generated: 'db'` and the value is empty, the column is omitted so the
	 * database can provide the value.
	 */
	override getDataForDb(
		state: BasicFieldState<string | null>,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override getDataForDb(
		state: BasicFieldState<string | null>,
		ctx: FieldContext,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override async getDataForDb(
		state: BasicFieldState<string | null>,
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): Promise<DbWriteData> {
		const args = this.resolveDbWriteArgs(ctxOrOptions, options);

		return this.withContext(args.ctx, async () => {
			if (this.config.generated === 'db' && !state.value) {
				return {};
			}

			if (this.shouldGenerateInApp() && !state.value) {
				state.value = ulid();
			}

			return super.getDataForDb(state, args.options);
		});
	}

	/**
	 * Adds ULID-format validation when a value is present.
	 */
	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (value && !isUlid(value)) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be a valid ULID`,
				code: 'ulid',
				value,
			});
		}

		return errors;
	}

	/**
	 * Describes a `char(26)` database column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.char(26),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
						default: this.getDbDefaultValue(),
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}

	/**
	 * Returns true when this field should generate ULIDs in application code.
	 */
	protected shouldGenerateInApp(): boolean {
		return this.config.generated === true || this.config.generated === 'ulid';
	}
}
