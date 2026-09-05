import {
	BasicFieldState,
	DbSchemaPart,
	FieldConfig,
	FieldContext,
	FieldError,
	FieldRenderOptions,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';
import type { ValidationRule } from '../../validation';

/**
 * Configuration for varchar-backed string fields.
 */
export interface StringFieldConfig extends FieldConfig {
	/** Maximum app-memory string length. */
	maxLength?: number;

	/** Whether to trim incoming strings. Defaults to true. */
	trim?: boolean;

	/** Database varchar length. Defaults to `maxLength` or 255. */
	length?: number;
}

/**
 * Generic varchar-backed string field.
 *
 * Responsibilities:
 * - coerce input to a string
 * - optionally trim whitespace
 * - convert empty strings to null
 * - validate required/max length
 * - describe varchar database column metadata
 */
export class StringField extends FieldType<
	string | null,
	string | null,
	string | null,
	unknown,
	BasicFieldState<string | null>
> {
	constructor(public override readonly config: StringFieldConfig = {}) {
		super(config);
	}

	/**
	 * Parses input into a nullable string.
	 */
	protected override parse(input: unknown): string | null {
		if (input === null || input === undefined) {
			return null;
		}

		let value = String(input);

		if (this.config.trim !== false) {
			value = value.trim();
		}

		return value === '' ? null : value;
	}

	protected override defaultFormComponent(): string {
		return 'DomTextInput';
	}

	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		const props = super.defaultFormComponentProps(options);
		const maxLength = this.effectiveMaxLength();

		if (maxLength !== undefined) {
			props.maxLength = maxLength;
		}

		return props;
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		const rules = super.getValidationRules(ctx);

		rules.push('string');

		const maxLength = this.effectiveMaxLength();

		if (maxLength !== undefined) {
			rules.push({
				rule: 'maxLength',
				value: maxLength,
			});
		}

		return rules;
	}

	/**
	 * Adds string-specific validation on top of required validation.
	 */
	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;
		const maxLength = this.effectiveMaxLength();

		if (
			value !== null &&
			maxLength !== undefined &&
			value.length > maxLength
		) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be ${maxLength} characters or fewer`,
				code: 'maxLength',
				value,
				details: {
					maxLength,
				},
			});
		}

		return errors;
	}

	/**
	 * Returns database schema metadata for this string field.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.varchar(this.config.length ?? this.config.maxLength ?? 255),
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

	protected effectiveMaxLength(): number | undefined {
		if (this.config.maxLength !== undefined) return this.config.maxLength;

		return this.config.length ?? 255;
	}
}
