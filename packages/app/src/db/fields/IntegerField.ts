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
 * Configuration for integer fields.
 */
export interface IntegerFieldConfig extends FieldConfig {
	/** Minimum allowed integer value. */
	min?: number;

	/** Maximum allowed integer value. */
	max?: number;

	/** Whether to generate an unsigned integer column where supported. */
	unsigned?: boolean;

	/** Whether to generate a big integer column. */
	big?: boolean;
}

/**
 * Integer field for numeric model attributes.
 */
export class IntegerField extends FieldType<
	number | null,
	number | null,
	number | null,
	unknown,
	BasicFieldState<number | null>
> {
	constructor(public override readonly config: IntegerFieldConfig = {}) {
		super(config);
	}

	protected override parse(input: unknown): number | null {
		if (input === null || input === undefined || input === '') {
			return null;
		}

		const value = typeof input === 'number'
			? input
			: Number(String(input).trim());

		if (!Number.isFinite(value)) {
			return null;
		}

		return Math.trunc(value);
	}

	protected override defaultFormComponent(): string {
		return 'DomNumberInput';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return 'DomNumberInput';
	}

	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		const props = super.defaultFormComponentProps(options);

		if (this.config.min !== undefined) {
			props.min = this.config.min;
		}

		if (this.config.max !== undefined) {
			props.max = this.config.max;
		}

		return props;
	}

	public min(value: number): IntegerField {
		this.config.min = value;
		return this;
	}

	public max(value: number): IntegerField {
		this.config.max = value;
		return this;
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		const rules = super.getValidationRules(ctx);

		rules.push('integer');

		if (this.config.min !== undefined) {
			rules.push({
				rule: 'min',
				value: this.config.min,
			});
		}

		if (this.config.max !== undefined) {
			rules.push({
				rule: 'max',
				value: this.config.max,
			});
		}

		return rules;
	}

	protected override async collectErrors(
		state: BasicFieldState<number | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (value === null) {
			return errors;
		}

		if (this.config.min !== undefined && value < this.config.min) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be at least ${this.config.min}`,
				code: 'min',
				value,
				details: {
					min: this.config.min,
				},
			});
		}

		if (this.config.max !== undefined && value > this.config.max) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be ${this.config.max} or lower`,
				code: 'max',
				value,
				details: {
					max: this.config.max,
				},
			});
		}

		return errors;
	}

	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.integer({
							unsigned: this.config.unsigned,
							big: this.config.big,
						}),
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

export class BigIncrementsField extends IntegerField {
	constructor(config: IntegerFieldConfig = {}) {
		super({
			primary: true,
			generated: 'db',
			...config,
		});
	}

	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.bigIncrements(),
						primary: true,
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}
}
