import {
	BasicFieldState,
	FieldContext,
	FieldError,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import { StringField, StringFieldConfig } from './StringField';

/**
 * Configuration for email fields.
 */
export interface EmailFieldConfig extends StringFieldConfig {
	/** Whether to lowercase incoming email addresses. Defaults to true. */
	lowercase?: boolean;
}

/**
 * Email field implemented as a specialized string field.
 *
 * It normalizes values by trimming and lowercasing, then validates basic email
 * structure. It intentionally does not send verification emails or check
 * uniqueness in application code; that belongs to services/database constraints.
 */
export class EmailField extends StringField {
	declare public readonly config: EmailFieldConfig;

	constructor(config: EmailFieldConfig = {}) {
		super({
			length: 255,
			maxLength: 255,
			...config,
		});
	}

	/**
	 * Parses and normalises email input.
	 */
	protected override parse(input: unknown): string | null {
		const value = super.parse(input);

		if (value === null) {
			return null;
		}

		return this.config.lowercase === false ? value : value.toLowerCase();
	}

	protected override defaultFormComponent(): string {
		return 'DomEmailInput';
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'email',
		];
	}

	/**
	 * Adds basic email-format validation.
	 */
	protected override async collectErrors(
		state: BasicFieldState<string | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value;

		if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be a valid email address`,
				code: 'email',
				value,
			});
		}

		return errors;
	}
}
