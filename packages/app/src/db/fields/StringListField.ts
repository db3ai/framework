import {
	BasicFieldState,
	FieldContext,
	FieldError,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import {
	JsonField,
	type JsonFieldConfig,
} from './JsonField';

/**
 * Configuration for JSON-backed lists of short strings.
 */
export interface StringListFieldConfig extends JsonFieldConfig {
	/** Maximum number of saved items. Leave unset to allow storage-sized lists. */
	maxItems?: number;

	/** Whether values beyond maxItems are truncated. Defaults to true. */
	truncate?: boolean;
}

/**
 * Stores a normalised string array in app memory and JSON in the database.
 */
export class StringListField extends JsonField<string[]> {
	declare public readonly config: StringListFieldConfig;

	/**
	 * Creates a JSON-backed string list field with an empty-array default.
	 */
	constructor(config: StringListFieldConfig = {}) {
		super({
			default: () => [],
			...config,
		});
	}

	/**
	 * Normalises supported input into a deduplicated list of trimmed strings.
	 */
	protected override parse(input: unknown): string[] {
		const values = this.rawValues(input);
		const seen = new Set<string>();
		const items: string[] = [];
		const maxItems = this.config.maxItems;

		if (
			maxItems !== undefined
			&& this.config.truncate !== false
			&& maxItems <= 0
		) {
			return [];
		}

		for (const value of values) {
			const item = String(value).trim().replace(/\s+/g, ' ');
			const key = item.toLowerCase();

			if (!item || seen.has(key)) continue;

			seen.add(key);
			items.push(item);

			if (
				maxItems !== undefined
				&& this.config.truncate !== false
				&& items.length >= maxItems
			) {
				break;
			}
		}

		return items;
	}

	/**
	 * Hydrates persisted JSON or already-decoded storage into app values.
	 */
	protected override fromDbValue(input: unknown): string[] {
		return this.parse(super.fromDbValue(input as string | string[] | null));
	}

	/**
	 * Serialises the normalised list for database storage.
	 */
	protected override toDbValue(input: string[]): string {
		return super.toDbValue(this.parse(input)) ?? '[]';
	}

	/**
	 * Provides the default form control for editing JSON string lists.
	 */
	protected override defaultFormComponent(): string {
		return 'DomJsonListInput';
	}

	/**
	 * Disables default search filtering for list fields.
	 */
	protected override defaultSearchFilterComponent(): string | null {
		return null;
	}

	/**
	 * Publishes request validation rules for list-shaped input.
	 */
	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		const rules = super.getValidationRules(ctx);

		rules.push('array');

		if (this.config.maxItems !== undefined) {
			rules.push({
				rule: 'max',
				value: this.config.maxItems,
			});
		}

		return rules;
	}

	/**
	 * Reports an item-count validation error when maxItems is configured.
	 */
	protected override async collectErrors(
		state: BasicFieldState<string[]>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const maxItems = this.config.maxItems;

		if (
			maxItems !== undefined
			&& state.value
			&& state.value.length > maxItems
		) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must contain ${maxItems} items or fewer`,
				code: 'maxItems',
				value: state.value,
				details: {
					maxItems,
				},
			});
		}

		return errors;
	}

	/**
	 * Extracts candidate string values from arrays, JSON, and delimited text.
	 */
	private rawValues(input: unknown): unknown[] {
		if (input === null || input === undefined || input === '') {
			return [];
		}

		if (Array.isArray(input)) {
			return input.filter(item => typeof item === 'string');
		}

		if (typeof input === 'string') {
			const value = input.trim();

			if (!value) return [];

			if (value.startsWith('[')) {
				const parsed = JSON.parse(value);

				return Array.isArray(parsed) ? parsed : [];
			}

			return value.split(/[\n,]/);
		}

		return [];
	}
}
