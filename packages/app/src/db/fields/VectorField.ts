import type { ValidationRule } from '../../validation';
import {
	type BasicFieldState,
	type DbSchemaPart,
	type DbIndexSpec,
	type FieldConfig,
	type FieldContext,
	type FieldError,
	type FieldRenderOptions,
	FieldType,
} from '../FieldType';
import type { DatabaseDialect, DatabaseValueOptions } from '../dialects';
import { resolveDatabaseDialect } from '../dialects';

type VectorDbValue = Uint8Array | string | number[] | null;

/**
 * Configuration for native database vectors such as embeddings.
 */
export interface VectorFieldConfig extends FieldConfig {
	/** Expected number of vector dimensions. Leave unset to use the database default. */
	dimensions?: number;

	/** Whether to create a database-native vector index. Defaults to true for required vectors. */
	index?: boolean;
}

/**
 * Stores an embedding/vector as a native database VECTOR column.
 */
export class VectorField extends FieldType<
	number[] | null,
	unknown,
	number[] | null,
	unknown,
	BasicFieldState<number[] | null>
> {
	declare public readonly config: VectorFieldConfig;

	/**
	 * Creates a native vector field and validates schema-level options.
	 */
	constructor(config: VectorFieldConfig = {}) {
		const resolvedConfig: VectorFieldConfig = {
			selectedByDefault: false,
			index: config.index ?? Boolean(config.required),
			...config,
		};

		super(resolvedConfig);
		validateVectorConfig(resolvedConfig, resolveDatabaseDialect().vectorMaxDimensions);
	}

	/**
	 * Parses JSON text, decoded arrays, or binary vector input into app memory.
	 */
	protected override parse(input: unknown): number[] | null {
		if (input === null || input === undefined || input === '') {
			return null;
		}

		return resolveDatabaseDialect().vectorFromDbValue(input);
	}

	/**
	 * Hydrates binary vectors, vector text, or already-decoded arrays.
	 */
	protected override fromDbValue(input: VectorDbValue): number[] | null {
		return this.parse(input);
	}

	/**
	 * Converts app-memory vectors into the active dialect's native vector value.
	 */
	protected override toDbValue(
		input: number[] | null,
		options?: DatabaseValueOptions,
	): unknown {
		if (input === null || input === undefined) {
			return null;
		}

		const dialect = options?.dialect ?? resolveDatabaseDialect();

		return dialect.vectorToDbValue(input, options?.db);
	}

	/**
	 * Uses a JSON editor for manual vector editing in generated forms.
	 */
	protected override defaultFormComponent(): string {
		return 'DomJsonInput';
	}

	/**
	 * Disables default scalar search filtering for vector fields.
	 */
	protected override defaultSearchFilterComponent(): string | null {
		return null;
	}

	/**
	 * Adds dimension metadata to generated vector form props.
	 */
	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		const props = super.defaultFormComponentProps(options);

		if (this.config.dimensions !== undefined) {
			props.dimensions = this.config.dimensions;
		}

		return props;
	}

	/**
	 * Publishes request validation rules for array-shaped vector input.
	 */
	override getValidationRules(ctx?: FieldContext): ValidationRule[] {
		const rules = super.getValidationRules(ctx);

		rules.push('array');

		return rules;
	}

	/**
	 * Describes the native VECTOR column used by this field.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const dialect = this.schemaDialect();

			validateVectorConfig(this.config, dialect.vectorMaxDimensions);

			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: dialect.vectorColumnType(this.config.dimensions),
						nullable: !this.config.required,
					},
				],
				indexes: vectorSchemaIndexes(this.column, this.config, dialect),
			}, ctx);
		});
	}

	/**
	 * Reports non-array, non-number, and dimension mismatch errors.
	 */
	protected override async collectErrors(
		state: BasicFieldState<number[] | null>,
	): Promise<FieldError[]> {
		const errors = await super.collectErrors(state);
		const value = state.value as unknown;

		if (this.isEmpty(value)) {
			return errors;
		}

		if (!Array.isArray(value)) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must be an array of numbers`,
				code: 'array',
				value,
			});

			return errors;
		}

		const invalidIndex = value.findIndex(item => (
			typeof item !== 'number' || !Number.isFinite(item)
		));

		if (invalidIndex !== -1) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must contain only finite numbers`,
				code: 'numberArray',
				value,
				details: {
					invalidIndex,
				},
			});
		}

		if (
			this.config.dimensions !== undefined
			&& value.length !== this.config.dimensions
		) {
			errors.push({
				field: this.fieldName,
				message: `${this.fieldName} must contain ${this.config.dimensions} numbers`,
				code: 'dimensions',
				value,
				details: {
					dimensions: this.config.dimensions,
					actual: value.length,
				},
			});
		}

		return errors;
	}

	/**
	 * Treats an empty vector as empty for required validation.
	 */
	protected override isEmpty(value: unknown): boolean {
		return super.isEmpty(value) || (Array.isArray(value) && value.length === 0);
	}
}

/**
 * Validates configuration that native VECTOR columns cannot support.
 */
function validateVectorConfig(
	config: VectorFieldConfig,
	maxDimensions: number,
): void {
	if (
		config.dimensions !== undefined
		&& (
			!Number.isInteger(config.dimensions)
			|| config.dimensions <= 0
			|| config.dimensions > maxDimensions
		)
	) {
		throw new Error(
			`VectorField dimensions must be an integer between 1 and ${maxDimensions}.`,
		);
	}

	if (config.primary || config.unique || (config.indexes?.length ?? 0) > 0) {
		throw new Error('VECTOR columns cannot be primary, unique, or custom normal indexed keys.');
	}

	if (config.index && !config.required) {
		throw new Error('VECTOR indexes require required: true because MariaDB vector indexes cannot include nullable columns.');
	}
}

/**
 * Builds the native vector index metadata for dialects that support it.
 *
 * @param column - Database column that stores the vector.
 * @param config - Vector field configuration.
 * @param dialect - Active database dialect.
 * @returns Vector index schema metadata, or undefined when disabled/unsupported.
 */
function vectorSchemaIndexes(
	column: string,
	config: VectorFieldConfig,
	dialect: DatabaseDialect,
): DbIndexSpec[] | undefined {
	if (!config.index || !dialect.supportsVectorIndexes) return undefined;

	return [
		{
			type: 'vector',
			columns: [column],
			name: config.indexName,
		},
	];
}
