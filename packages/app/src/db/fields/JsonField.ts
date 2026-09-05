import {
	BasicFieldState,
	DbSchemaPart,
	FieldConfig,
	FieldContext,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';

/**
 * Configuration for permissive JSON fields stored in native JSON columns.
 */
export interface JsonFieldConfig extends FieldConfig {}

/**
 * Field that stores JSON-compatible values and persists them as JSON text.
 */
export class JsonField<TValue = unknown> extends FieldType<
	TValue,
	string | TValue | null,
	TValue,
	unknown,
	BasicFieldState<TValue>
> {
	/**
	 * Creates a permissive JSON field.
	 */
	constructor(public override readonly config: JsonFieldConfig = {}) {
		super(config);
	}

	/**
	 * Parses app input. Strings are treated as JSON documents.
	 */
	protected override parse(input: unknown): TValue {
		if (input === null || input === undefined || input === '') {
			return null as TValue;
		}

		if (typeof input === 'string') {
			return JSON.parse(input) as TValue;
		}

		return input as TValue;
	}

	/**
	 * Converts a database JSON string or decoded JSON value into app memory.
	 */
	protected override fromDbValue(input: string | TValue | null): TValue {
		if (input === null || input === undefined || input === '') {
			return null as TValue;
		}

		if (typeof input === 'string') {
			return JSON.parse(input) as TValue;
		}

		return input as TValue;
	}

	/**
	 * Converts app memory into database JSON storage.
	 */
	protected override toDbValue(input: TValue): string | null {
		if (input === null || input === undefined) {
			return null;
		}

		return JSON.stringify(input);
	}

	/**
	 * Provides the default form control for editing arbitrary JSON.
	 */
	protected override defaultFormComponent(): string {
		return 'DomJsonInput';
	}

	/**
	 * Disables default search filtering for JSON fields.
	 */
	protected override defaultSearchFilterComponent(): string | null {
		return null;
	}

	/**
	 * Describes the database column used by this JSON field.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.json(),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}
}
