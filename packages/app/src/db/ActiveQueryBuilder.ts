import type { Knex } from 'knex';

import { databaseDialectForConnection } from './dialects';
import type {
	ActiveRecord,
	ActiveRecordClass,
} from './ActiveRecord';
import {
	type DbRow,
	type FieldType,
	RecordValidationError,
} from './FieldType';
import { RecordNotFoundError } from './errors';
import {
	EntityRef,
	LinkField,
} from './fields/LinkField';
import { VectorField } from './fields/VectorField';
import {
	getSoftDeleteField,
	getSoftDeleteWriteData,
	requireSoftDeleteField,
	type ActiveRecordSoftDeleteScope,
} from './SoftDeletes';

export interface VectorSimilarityOptions {
	/** SQL result alias used for the computed vector distance. Defaults to `distance`. */
	as?: string;

	/** Optional maximum vector distance for filtering candidate rows. */
	maxDistance?: number;

	/** Whether to order rows by closest distance. Defaults to ascending distance. */
	orderBy?: 'asc' | 'desc' | false;
}

interface VectorDistanceSql {
	expression: string;
	bindings: Knex.RawBinding[];
}

/**
 * Field-aware query builder that wraps Knex.
 *
 * Add wrapper methods as you need them. `toKnex()` is the escape hatch for raw
 * Knex operations.
 */
export class ActiveQueryBuilder<TRecord extends ActiveRecord> {
	private readonly qb: Knex.QueryBuilder;
	private readonly includedFields = new Set<string>();
	private readonly includedRelations = new Set<string>();
	private selectedFields: Set<string> | null = null;
	private softDeleteScope: ActiveRecordSoftDeleteScope = 'without';

	constructor(
		private readonly Model: ActiveRecordClass<TRecord>,
		private readonly db: Knex,
	) {
		this.qb = db(Model.table);
	}

	/**
	 * Includes soft-deleted rows in query results and write operations.
	 */
	withTrashed(): this {
		requireSoftDeleteField(this.Model);
		this.softDeleteScope = 'with';

		return this;
	}

	/**
	 * Restricts the query to soft-deleted rows only.
	 */
	onlyTrashed(): this {
		requireSoftDeleteField(this.Model);
		this.softDeleteScope = 'only';

		return this;
	}

	/**
	 * Restricts the query to rows that have not been soft deleted.
	 */
	withoutTrashed(): this {
		requireSoftDeleteField(this.Model);
		this.softDeleteScope = 'without';

		return this;
	}

	/**
	 * Includes an opt-in field that normal fetches omit by default.
	 */
	withField(fieldName: string): this {
		this.getField(fieldName);
		this.includedFields.add(fieldName);

		return this;
	}

	/**
	 * Eager-loads a link field and serializes it as nested model JSON.
	 *
	 * The relation name may be the logical link field name, the target model table
	 * name, or the target model class name. Prefer the field name when a model has
	 * more than one link to the same table.
	 */
	with(relationName: string): this {
		const [fieldName] = this.getRelationField(relationName);

		this.includedRelations.add(fieldName);

		return this;
	}

	/**
	 * Restricts hydrated query results to the requested logical model fields.
	 *
	 * This is intended for bounded read models and polling endpoints that should
	 * not load large model columns they do not render.
	 *
	 * @param fieldNames - Logical model field names to select.
	 * @returns This query builder.
	 *
	 * @example
	 * const pages = await WebsitePage
	 * 	.where('website', websiteId)
	 * 	.select('analyzeStatus', 'analyzeData')
	 * 	.all();
	 */
	select(...fieldNames: string[]): this {
		if (fieldNames.length === 0) {
			throw new Error('At least one select field is required.');
		}

		for (const fieldName of fieldNames) {
			this.getField(fieldName);
		}

		this.selectedFields = new Set(fieldNames);
		return this;
	}

	/**
	 * Adds field-aware equality conditions from an object.
	 */
	where(criteria: Record<string, unknown>): this;

	/**
	 * Adds a field-aware `where field = value` condition.
	 */
	where(fieldName: string, value: unknown): this;

	/**
	 * Adds a field-aware `where field operator value` condition.
	 */
	where(fieldName: string, operator: string, value: unknown): this;
	where(
		fieldNameOrCriteria: string | Record<string, unknown>,
		operatorOrValue?: unknown,
		value?: unknown,
	): this {
		if (isWhereCriteria(fieldNameOrCriteria)) {
			const entries = Object.entries(fieldNameOrCriteria);

			if (entries.length === 0) {
				throw new Error('At least one where field is required.');
			}

			for (const [fieldName, fieldValue] of entries) {
				this.where(fieldName, fieldValue);
			}

			return this;
		}

		const hasExplicitOperator = arguments.length === 3;
		const operator = hasExplicitOperator ? String(operatorOrValue) : '=';
		const rawValue = hasExplicitOperator ? value : operatorOrValue;

		const field = this.getField(fieldNameOrCriteria);

		this.qb.where(
			this.qualifiedColumn(field),
			operator as any,
			field.getQueryValue(rawValue) as any,
		);

		return this;
	}

	/**
	 * Adds a primary-key equality condition.
	 */
	wherePk(id: unknown): this {
		return this.where(this.Model.primaryKey, id);
	}

	/**
	 * Adds a field-aware `where in (...)` condition.
	 */
	whereIn(fieldName: string, values: unknown[]): this {
		const field = this.getField(fieldName);

		this.qb.whereIn(
			this.qualifiedColumn(field),
			values.map(value => {
				return field.getQueryValue(value);
			}) as any[],
		);

		return this;
	}

	/**
	 * Adds a field-aware `where column is null` condition.
	 */
	whereNull(fieldName: string): this {
		const field = this.getField(fieldName);

		this.qb.whereNull(this.qualifiedColumn(field));
		return this;
	}

	/**
	 * Adds a field-aware `where column is not null` condition.
	 */
	whereNotNull(fieldName: string): this {
		const field = this.getField(fieldName);

		this.qb.whereNotNull(this.qualifiedColumn(field));
		return this;
	}

	/**
	 * Adds a raw where clause.
	 *
	 * Prefer field-aware methods where possible. Use parameter bindings to avoid
	 * SQL injection when using raw SQL.
	 */
	whereRaw(sql: string, bindings?: readonly unknown[]): this {
		this.qb.whereRaw(sql, bindings as any);
		return this;
	}

	/**
	 * Adds a dialect-aware vector similarity projection, optional distance filter,
	 * and closest-first ordering for a vector field.
	 *
	 * @param fieldName - Logical vector field name.
	 * @param vector - Query vector to compare against the stored field.
	 * @param options - Projection alias, optional distance threshold, and ordering.
	 * @returns This query builder.
	 *
	 * @example
	 * WebsiteEmbedding
	 * 	.query()
	 * 	.where('website', websiteId)
	 * 	.whereVectorSimilarTo('embedding', queryVector)
	 * 	.limit(10)
	 * 	.toKnex()
	 */
	whereVectorSimilarTo(
		fieldName: string,
		vector: readonly number[],
		options: VectorSimilarityOptions = {},
	): this {
		const field = this.getVectorField(fieldName);
		const alias = sqlAlias(options.as ?? 'distance');
		const distance = this.vectorDistanceSql(field, vector);

		this.qb.select(this.db.raw(`${distance.expression} as ${alias}`, distance.bindings));

		if (options.maxDistance !== undefined) {
			assertVectorDistance(options.maxDistance);
			this.qb.whereRaw(
				`${distance.expression} <= ?`,
				[...distance.bindings, options.maxDistance] as Knex.RawBinding[],
			);
		}

		if (options.orderBy !== false) {
			this.qb.orderBy(alias, options.orderBy ?? 'asc');
		}

		return this;
	}

	/**
	 * Returns whether the active database dialect can run vector similarity search.
	 *
	 * @returns True when `whereVectorSimilarTo()` can build SQL for this connection.
	 */
	supportsVectorSimilaritySearch(): boolean {
		return this.vectorDistanceDialect() !== null;
	}

	/**
	 * Returns a model-visible message for unsupported vector similarity dialects.
	 *
	 * @returns Readable unsupported-dialect message.
	 */
	vectorSimilarityUnsupportedMessage(): string {
		const dialect = databaseDialectForConnection(this.db);

		return `Vector similarity search is not supported for the ${dialect.name} database dialect yet.`;
	}

	/**
	 * Adds field-aware ordering.
	 */
	orderBy(fieldName: string, direction: 'asc' | 'desc' = 'asc'): this {
		const field = this.getField(fieldName);

		this.qb.orderBy(this.qualifiedColumn(field), direction);
		return this;
	}

	/**
	 * Adds SELECT ... FOR UPDATE while retaining typed ActiveRecord results.
	 * Execute inside a transaction; locks are released on commit or rollback.
	 * This delegates to Knex and does not start or finish a transaction.
	 * @returns This query for further filtering or execution.
	 * @example await app().db.transaction(async () => { const user = await User.where('id', id).forUpdate().first(); });
	 */
	forUpdate(): this {
		this.qb.forUpdate();
		return this;
	}

	/**
	 * Limits the number of returned records.
	 */
	limit(count: number): this {
		this.qb.limit(count);
		return this;
	}

	/**
	 * Offsets returned records.
	 */
	offset(count: number): this {
		this.qb.offset(count);
		return this;
	}

	/**
	 * Escape hatch for raw database column names.
	 *
	 * This bypasses field conversion and validation. Use it for low-level cases,
	 * not normal application queries.
	 */
	whereColumn(column: string, value: unknown): this;
	whereColumn(column: string, operator: string, value: unknown): this;
	whereColumn(column: string, operatorOrValue: unknown, value?: unknown): this {
		const hasExplicitOperator = arguments.length === 3;

		if (hasExplicitOperator) {
			this.qb.where(column, String(operatorOrValue) as any, value as any);
		} else {
			this.qb.where(column, operatorOrValue as any);
		}

		return this;
	}

	/**
	 * Executes the query and returns the first hydrated record, or null.
	 */
	async first(): Promise<TRecord | null> {
		const row = await this.applySoftDeleteScope(this.qb.clone())
			.select(this.selectedColumns())
			.first();

		if (!row) {
			return null;
		}

		const record = this.Model.fromDb(row as DbRow, this.db);

		await this.loadIncludedRelations([record]);

		return record;
	}

	/**
	 * Executes the query and returns the first hydrated record.
	 *
	 * @returns First matching record.
	 * @throws {RecordNotFoundError} When the query has no matching rows.
	 *
	 * @example
	 * const user = await User
	 * 	.where('email', email)
	 * 	.firstOrFail();
	 */
	async firstOrFail(): Promise<TRecord> {
		const record = await this.first();

		if (!record) {
			throw new RecordNotFoundError(this.Model.name);
		}

		return record;
	}

	/**
	 * Executes the query and returns hydrated records.
	 */
	async all(): Promise<TRecord[]> {
		const rows = await this.applySoftDeleteScope(this.qb.clone())
			.select(this.selectedColumns());

		const records = (rows as DbRow[]).map(row => this.Model.fromDb(row, this.db));

		await this.loadIncludedRelations(records);

		return records;
	}

	/**
	 * Counts matching records without hydrating or transferring model rows.
	 *
	 * @param fieldName - Optional logical field whose non-null values should be counted.
	 * @returns Number of matching records or non-null field values.
	 *
	 * @example
	 * const keywordCount = await Keywords
	 * 	.where('website', websiteId)
	 * 	.count();
	 */
	async count(fieldName?: string): Promise<number> {
		const column = fieldName
			? this.qualifiedColumn(this.getField(fieldName))
			: '*';
		const row = await this.applySoftDeleteScope(this.qb.clone())
			.count({
				recordCount: column,
			})
			.first() as Record<string, unknown> | undefined;

		return numericAggregate(row?.recordCount);
	}

	/**
	 * Updates matching rows using field-aware assignment/conversion.
	 *
	 * This does not load records before updating them.
	 */
	async patch(input: Record<string, unknown>): Promise<number> {
		const record = new this.Model(input, {
			db: this.db,
			persisted: true,
		});

		const valid = await record.validate({ onlyDirty: true });

		if (!valid) {
			throw new RecordValidationError(record.getErrors());
		}

		const row = await record.getDataForDb({
			isInsert: false,
			onlyDirty: true,
			valueOptions: {
				db: this.db,
				dialect: databaseDialectForConnection(this.db),
			},
		});

		if (Object.keys(row).length === 0) {
			return 0;
		}

		const count = await this.applySoftDeleteScope(this.qb.clone()).update(row);
		return Number(count);
	}

	/**
	 * Deletes matching rows, using soft deletes when the model opts in.
	 */
	async delete(): Promise<number> {
		if (getSoftDeleteField(this.Model)) {
			const deletedAt = new Date();
			const count = await this.applySoftDeleteScope(this.qb.clone()).update(
				getSoftDeleteWriteData(this.Model, deletedAt, deletedAt),
			);

			return Number(count);
		}

		return this.forceDelete();
	}

	/**
	 * Physically deletes matching rows, bypassing soft delete behavior.
	 */
	async forceDelete(): Promise<number> {
		const count = await this.applySoftDeleteScope(this.qb.clone()).delete();

		return Number(count);
	}

	/**
	 * Restores matching soft-deleted rows by clearing their delete timestamp.
	 */
	async restore(): Promise<number> {
		const softDeleteField = requireSoftDeleteField(this.Model);
		const count = await this.qb
			.clone()
			.whereNotNull(softDeleteField.column)
			.update(getSoftDeleteWriteData(this.Model, null));

		return Number(count);
	}

	/**
	 * Returns a scoped clone of the underlying Knex query builder.
	 *
	 * After calling this, you are outside the ActiveRecord hydration layer. Raw
	 * Knex results will not automatically become model instances.
	 */
	toKnex(): Knex.QueryBuilder {
		const query = this.applySoftDeleteScope(this.qb.clone());

		if (this.selectedFields) {
			query.select(this.selectedColumns());
		}

		return query;
	}

	/**
	 * Looks up a field by logical model field name.
	 */
	private getField(fieldName: string): FieldType<any, any, any, any, any> {
		return this.Model.getField(fieldName);
	}

	/**
	 * Looks up a field and requires it to be a native vector field.
	 *
	 * @param fieldName - Logical model field name.
	 * @returns Native vector field instance.
	 */
	private getVectorField(fieldName: string): VectorField {
		const field = this.getField(fieldName);

		if (!(field instanceof VectorField)) {
			throw new Error(`Field "${fieldName}" is not a vector field.`);
		}

		return field;
	}

	/**
	 * Builds a dialect-aware vector distance expression for a vector field.
	 *
	 * @param field - Vector field being compared.
	 * @param vector - Query vector to compare against.
	 * @returns SQL expression and bindings for the active dialect.
	 */
	private vectorDistanceSql(field: VectorField, vector: readonly number[]): VectorDistanceSql {
		validateVectorSimilarityVector(vector);

		const dialect = this.vectorDistanceDialect();
		const column = this.qualifiedColumn(field);
		const vectorText = JSON.stringify(vector);

		if (dialect === 'mariadb') {
			return {
				expression: 'VEC_DISTANCE_COSINE(??, VEC_FromText(?))',
				bindings: [column, vectorText],
			};
		}

		if (dialect === 'postgres') {
			return {
				expression: '?? <=> ?::vector',
				bindings: [column, vectorText],
			};
		}

		throw new Error(this.vectorSimilarityUnsupportedMessage());
	}

	/**
	 * Returns the supported vector-search dialect name for this query connection.
	 *
	 * @returns Supported dialect name, or null when not supported.
	 */
	private vectorDistanceDialect(): 'mariadb' | 'postgres' | null {
		const dialect = databaseDialectForConnection(this.db);

		if (dialect.name === 'mariadb' || dialect.name === 'postgres') {
			return dialect.name;
		}

		return null;
	}

	/**
	 * Returns a model-table-qualified database column name for field-aware clauses.
	 *
	 * @param field - Model field or metadata whose storage column should be referenced.
	 * @returns Column qualified with the ActiveRecord model table.
	 */
	private qualifiedColumn(field: { column: string }): string {
		return `${this.Model.table}.${field.column}`;
	}

	/**
	 * Looks up a requested relation and requires it to resolve to one link field.
	 */
	private getRelationField(relationName: string): [string, LinkField<ActiveRecord>] {
		const exactField = this.Model.getFields()[relationName];

		if (exactField) {
			if (exactField instanceof LinkField) {
				return [relationName, exactField as LinkField<ActiveRecord>];
			}

			throw new Error(`Field "${relationName}" is not a link relation.`);
		}

		const matches = Object.entries(this.Model.getFields())
			.filter(([, field]) => {
				if (!(field instanceof LinkField)) return false;

				const Target = field.config.target();

				return relationName === Target.table
					|| relationName === Target.name
					|| relationName === Target.name.toLowerCase();
			}) as Array<[string, LinkField<ActiveRecord>]>;

		if (matches.length === 1) {
			return matches[0];
		}

		if (matches.length > 1) {
			throw new Error(`Relation "${relationName}" matched multiple link fields. Use the logical field name instead.`);
		}

		throw new Error(`Unknown link relation "${relationName}".`);
	}

	/**
	 * Loads included link records in batches and attaches them to each record.
	 */
	private async loadIncludedRelations(records: TRecord[]): Promise<void> {
		if (records.length === 0 || this.includedRelations.size === 0) return;

		for (const fieldName of this.includedRelations) {
			await this.loadIncludedRelation(records, fieldName);
		}
	}

	/**
	 * Loads one included link relation for all hydrated records.
	 */
	private async loadIncludedRelation(records: TRecord[], fieldName: string): Promise<void> {
		const [, field] = this.getRelationField(fieldName);
		const Target = field.config.target();
		const ids = uniqueRelationIds(records.flatMap(record => {
			const ref = record.get(fieldName);

			return ref instanceof EntityRef && ref.id !== null && ref.id !== undefined
				? [ref.id]
				: [];
		}));

		if (ids.length === 0) {
			this.attachLoadedRelation(records, fieldName, new Map());
			return;
		}

		const relatedRecords = await Target
			.query(this.db)
			.whereIn(Target.primaryKey, ids)
			.all();
		const relatedById = new Map<unknown, ActiveRecord>();

		for (const relatedRecord of relatedRecords) {
			relatedById.set(relatedRecord.get(Target.primaryKey), relatedRecord);
		}

		this.attachLoadedRelation(records, fieldName, relatedById);
	}

	/**
	 * Attaches loaded relation records to the bound link fields.
	 */
	private attachLoadedRelation(
		records: TRecord[],
		fieldName: string,
		relatedById: Map<unknown, ActiveRecord>,
	): void {
		for (const record of records) {
			const ref = record.get(fieldName);
			const field = record.getBoundField(fieldName);

			if (!(ref instanceof EntityRef) || !(field instanceof LinkField)) continue;

			field.setBoundLoadedRecord(relatedById.get(ref.id) ?? null);
		}
	}

	/**
	 * Returns table-qualified columns for fields included in model hydration.
	 */
	private selectedColumns(): string[] {
		const columns = new Set<string>();

		for (const [fieldName, field] of Object.entries(this.Model.getFields())) {
			if (!this.shouldSelectField(fieldName, field)) continue;

			const schemaColumns = field
				.getDbSchemaFor(this.Model, fieldName)
				.columns
				?.map(column => column.name);

			for (const column of schemaColumns ?? [field.getColumnFor(this.Model, fieldName)]) {
				columns.add(`${this.Model.table}.${column}`);
			}
		}

		return [...columns];
	}

	/**
	 * Returns true when a field should be included in hydrated query results.
	 */
	private shouldSelectField(
		fieldName: string,
		field: FieldType<any, any, any, any, any>,
	): boolean {
		if (this.selectedFields) {
			return this.selectedFields.has(fieldName)
				|| this.includedFields.has(fieldName)
				|| this.includedRelations.has(fieldName);
		}

		return field.config.selectedByDefault !== false
			|| this.includedFields.has(fieldName)
			|| this.includedRelations.has(fieldName);
	}

	/**
	 * Applies the current soft-delete scope to a Knex query clone.
	 */
	private applySoftDeleteScope(query: Knex.QueryBuilder): Knex.QueryBuilder {
		const softDeleteField = getSoftDeleteField(this.Model);

		if (!softDeleteField) {
			return query;
		}

		if (this.softDeleteScope === 'only') {
			return query.whereNotNull(this.qualifiedColumn(softDeleteField));
		}

		if (this.softDeleteScope === 'without') {
			return query.whereNull(this.qualifiedColumn(softDeleteField));
		}

		return query;
	}
}

/**
 * Validates and returns a safe SQL alias for a computed select expression.
 *
 * @param alias - Requested SQL result alias.
 * @returns Alias when it is safe to embed as an identifier.
 */
function sqlAlias(alias: string): string {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
		throw new Error(`Invalid SQL alias "${alias}".`);
	}

	return alias;
}

/**
 * Validates a maximum vector-distance threshold.
 *
 * @param value - Maximum accepted vector distance.
 */
function assertVectorDistance(value: number): void {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error('Vector similarity maxDistance must be a finite non-negative number.');
	}
}

/**
 * Validates a query vector before it is serialized into a raw SQL binding.
 *
 * @param vector - Query vector to validate.
 */
function validateVectorSimilarityVector(vector: readonly number[]): void {
	if (!Array.isArray(vector) || vector.length === 0) {
		throw new Error('Vector similarity search requires a non-empty vector.');
	}

	for (let index = 0; index < vector.length; index += 1) {
		const value = vector[index];

		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Vector similarity value at index ${index} must be a finite number.`);
		}
	}
}

/**
 * Returns true when input is an object-style where criteria map.
 */
function isWhereCriteria(input: unknown): input is Record<string, unknown> {
	return typeof input === 'object'
		&& input !== null
		&& !Array.isArray(input)
		&& !(input instanceof Date);
}

/**
 * Returns relation ids once while preserving query order.
 */
function uniqueRelationIds(ids: unknown[]): unknown[] {
	return [...new Set(ids)];
}

/**
 * Normalizes database aggregate values returned as numbers, bigints, or strings.
 *
 * @param value - Aggregate value returned by the active database driver.
 * @returns Finite numeric value, or zero when the driver value is unavailable.
 */
function numericAggregate(value: unknown): number {
	const count = Number(value ?? 0);

	return Number.isFinite(count) ? count : 0;
}
