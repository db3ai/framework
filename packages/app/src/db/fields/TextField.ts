import {
	DbSchemaPart,
	FieldConfig,
	FieldContext,
	FieldRenderOptions,
	fieldSchemaIndexes,
} from '../FieldType';
import { StringField } from './StringField';

/**
 * Configuration for text-backed string fields.
 */
export interface TextFieldConfig extends FieldConfig {
	/** Maximum app-memory string length. Text fields have no default max length. */
	maxLength?: number;

	/** Whether to trim incoming strings. Defaults to true. */
	trim?: boolean;
}

/**
 * String value stored in a text-like database column.
 */
export class TextField extends StringField {
	declare public readonly config: TextFieldConfig;

	constructor(config: TextFieldConfig = {}) {
		super(config);
	}

	protected override defaultFormComponent(): string {
		return 'DomTextareaInput';
	}

	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		const props = super.defaultFormComponentProps(options);

		if (this.defaultFormComponent() === 'DomTextareaInput') {
			props.rows = 4;
		}

		return props;
	}

	/**
	 * Describes the text-like database column used by this field.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						// on modern systems there is no real need to use text or mediumtext - these are historical mostly for extremely memory constrained systems
						type: types.longText(),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}

	protected override effectiveMaxLength(): number | undefined {
		return this.config.maxLength;
	}
}
