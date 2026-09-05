import {
	DbSchemaPart,
	FieldConfig,
	FieldContext,
	fieldSchemaIndexes,
} from '../FieldType';
import {
	JsonField,
	type JsonFieldConfig,
} from './JsonField';

export type JsonStringFieldDbType = 'json' | 'text' | 'longtext';

/**
 * Configuration for JSON values serialised into database storage.
 */
export interface JsonStringFieldConfig extends FieldConfig {
	/** Database storage type. Defaults to `json`. Prefer `field.jsonText()` or `field.jsonLongText()` over setting this directly. */
	dbType?: JsonStringFieldDbType;
}

/**
 * Field that stores an object/array in app memory but persists JSON to the DB.
 */
export class JsonStringField<TValue> extends JsonField<TValue | null> {
	declare public readonly config: JsonStringFieldConfig;

	constructor(config: JsonStringFieldConfig = {}) {
		super(config as JsonFieldConfig);
	}

	/**
	 * Describes the database column used by this JSON string field.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const types = this.schemaDialect().columnTypes;
			const storage = this.config.dbType ?? 'json';
			let type: string;

			if (storage === 'longtext') {
				type = types.longText();
			} else if (storage === 'text') {
				type = types.text();
			} else {
				type = types.json();
			}

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type,
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
