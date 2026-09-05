import {
	BasicFieldState,
	FieldContext,
	FieldError,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import {
	StringField,
	type StringFieldConfig,
} from './StringField';

/**
 * Configuration for string fields restricted to a known set of values.
 */
export interface ChoiceStringFieldConfig extends StringFieldConfig {
	/** Allowed internal values. */
	choices: readonly string[];

	/** Whether matching should be case-sensitive. Defaults to true. */
	caseSensitive?: boolean;
}

/**
 * String field that normalises to one of a declared set of choices.
 */
export class ChoiceStringField extends StringField {
	declare public readonly config: ChoiceStringFieldConfig;

	constructor(config: ChoiceStringFieldConfig) {
		super(config);
	}

	protected override parse(input: unknown): string | null {
		const value = super.parse(input);

		if (!value) {
			return this.defaultChoice();
		}

		const match = this.matchChoice(value);

		return match ?? this.defaultChoice();
	}

	protected override fromDbValue(input: unknown): string | null {
		return this.parse(input);
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			{
				rule: 'in',
				values: this.config.choices,
			},
		];
	}

	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (value && !this.matchChoice(value)) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be one of: ${this.config.choices.join(', ')}`,
				code: 'choice',
				value,
				details: {
					choices: this.config.choices,
				},
			});
		}

		return errors;
	}

	private matchChoice(value: string): string | null {
		if (this.config.caseSensitive !== false) {
			return this.config.choices.includes(value) ? value : null;
		}

		const normalized = value.toLowerCase();

		return this.config.choices.find(choice => choice.toLowerCase() === normalized) ?? null;
	}

	private defaultChoice(): string | null {
		if (typeof this.config.default !== 'string') {
			return null;
		}

		return this.matchChoice(this.config.default);
	}
}
