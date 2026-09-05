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

export interface DecimalFieldConfig extends FieldConfig {
	min?: number;
	max?: number;
	precision?: number;
	scale?: number;
}

export class DecimalField extends FieldType<
	number | null,
	number | string | null,
	number | null,
	unknown,
	BasicFieldState<number | null>
> {
	declare public readonly config: DecimalFieldConfig;

	constructor(config: DecimalFieldConfig = {}) {
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

		return value;
	}

	protected override fromDbValue(input: unknown): number | null {
		return this.parse(input);
	}

	protected override defaultFormComponent(): string {
		return 'DomNumberInput';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return 'DomNumberInput';
	}

	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		const props = super.defaultFormComponentProps(options);

		props.step = 'any';

		if (this.config.min !== undefined) {
			props.min = this.config.min;
		}

		if (this.config.max !== undefined) {
			props.max = this.config.max;
		}

		return props;
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		const rules = super.getValidationRules(ctx);

		rules.push('number');

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
			const precision = this.config.precision ?? 12;
			const scale = this.config.scale ?? 4;
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.decimal(precision, scale),
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
