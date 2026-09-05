import {
	BasicFieldState,
	DbSchemaPart,
	FieldConfig,
	FieldContext,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';
import type { ValidationRule } from '../../validation';
import type { DatabaseDialect } from '../dialects';

/**
 * Configuration for boolean fields.
 */
export interface BooleanFieldConfig extends FieldConfig { }

/**
 * Boolean field with light coercion for common form values.
 */
export class BooleanField extends FieldType<
	boolean | null,
	boolean | number | string | null,
	boolean | null,
	unknown,
	BasicFieldState<boolean | null>
> {
	constructor(public override readonly config: BooleanFieldConfig = {}) {
		super(config);
	}

	/**
	 * Parses booleans from booleans, numbers, and common strings.
	 */
	protected override parse(input: unknown): boolean | null {
		if (input === null || input === undefined || input === '') {
			return null;
		}

		if (typeof input === 'boolean') {
			return input;
		}

		if (typeof input === 'number') {
			return input !== 0;
		}

		const value = String(input).toLowerCase().trim();

		if (['true', '1', 'yes', 'on'].includes(value)) {
			return true;
		}

		if (['false', '0', 'no', 'off'].includes(value)) {
			return false;
		}

		return null;
	}

	/**
	 * Normalises database driver boolean values such as MySQL's 1/0 integers.
	 */
	protected override fromDbValue(input: unknown): boolean | null {
		return this.parse(input);
	}

	protected override defaultFormComponent(): string {
		return 'DomToggle';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return 'DomToggle';
	}

	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return [
			...super.getValidationRules(ctx),
			'boolean',
		];
	}

	/**
	 * Describes the boolean database column.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const dialect = this.schemaDialect();
			const types = dialect.columnTypes;

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: types.boolean(),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
						default: booleanDatabaseDefault(
							this.getDbDefaultValue(),
							dialect,
						),
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}
}

/**
 * Converts logical boolean defaults into values accepted by each SQL dialect.
 *
 * MySQL and MariaDB expose booleans as numeric columns and reject a quoted
 * `true` or `false` emitted by Knex for `specificType()` columns. Postgres owns
 * a native boolean type and retains the logical value.
 *
 * @param value - Static field default produced by the base field lifecycle.
 * @param dialect - Database dialect that will create or migrate the column.
 * @returns Dialect-safe schema default.
 */
function booleanDatabaseDefault(
	value: unknown,
	dialect: DatabaseDialect,
): unknown {
	if (typeof value !== 'boolean') return value;

	return dialect.name === 'postgres' ? value : Number(value);
}
