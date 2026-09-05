import {
	BasicFieldState,
	DbSchemaPart,
	FieldContext,
	FieldError,
	fieldSchemaIndexes,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import { StringField, StringFieldConfig } from './StringField';

/**
 * Configuration for textual UUID fields stored as `char(36)` by default.
 */
export interface CharUuidFieldConfig extends StringFieldConfig {
	/** Character length. Defaults to 36. */
	length?: number;
}

/**
 * UUID-like string field stored as `char(36)`.
 *
 * This fits schemas that store UUIDs as text rather than using the native
 * PostgreSQL `uuid` type.
 */
export class CharUuidField extends StringField {
	declare public readonly config: CharUuidFieldConfig;

	constructor(config: CharUuidFieldConfig = {}) {
		super({
			length: 36,
			maxLength: 36,
			trim: true,
			...config,
		});
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'uuid',
		];
	}

	/**
	 * Adds simple UUID-format validation when a value is present.
	 */
	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (
			value &&
			!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
		) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be a valid UUID`,
				code: 'uuid',
				value,
			});
		}

		return errors;
	}

	/**
	 * Describes a `char(36)` database column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const length = this.config.length ?? 36;
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.char(length),
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
}
