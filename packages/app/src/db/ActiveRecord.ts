import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';
import { isRecord, recordFromUnknown } from '@db3.ai/pure';

import { databaseDialectForConnection } from './dialects';
import {
	DbRow,
	DbWriteData,
	DomFormRenderSpec,
	FieldError,
	type FieldClass,
	type FieldDbValue,
	type FieldDefinition,
	type FieldDisplayValue,
	type FieldMap,
	type FieldInputMap,
	type FieldInputValue,
	FieldType,
	type FieldValue,
	FrontendComponentSpec,
	RecordValidationError,
	type DbWriteOptions,
} from './FieldType';
import { ActiveQueryBuilder } from './ActiveQueryBuilder';
import { db as defaultDb } from './connection';
import { resolveModelFields } from './fields/resolveFields';
import {
	getAutomaticUpdateTimestampFieldNames,
	getSoftDeleteWriteData,
	modelUsesSoftDeletes,
	requireSoftDeleteField,
	type ActiveRecordSoftDeleteConfig,
} from './SoftDeletes';
import type { FieldBuilder } from './fields/field';
import { RecordNotFoundError, type ActiveRecordLookup } from './errors';
import { activeAppDatabase } from '../server/appContext';
import type { ValidationRules } from '../validation';

export type { FieldBuilder } from './fields/field';
export { RecordNotFoundError } from './errors';
export type { ActiveRecordLookup } from './errors';

const scopedDb = new AsyncLocalStorage<Knex>();

export interface ModelFormOptions {
	name?: string;
	mode?: 'create' | 'edit' | 'search';
	includeGenerated?: boolean;
}

/**
 * Options accepted by the ActiveRecord constructor.
 */
export interface ActiveRecordOptions {
	/** Optional database connection/session for this record instance. */
	db?: Knex;

	/** True when the provided input is a raw database row. */
	fromDb?: boolean;

	/** Whether the record already exists in the database. */
	persisted?: boolean;
}

/**
 * Options for assigning untrusted request/form values to a record.
 */
export interface ActiveRecordRequestOptions {
	/** Whether primary-key fields may be set from request data. Defaults to false. */
	includePrimary?: boolean;

	/** Whether generated fields may be set from request data. Defaults to false. */
	includeGenerated?: boolean;

	/** Explicit fillable fields for this request. Defaults to the model config. */
	fillable?: readonly string[];

	/** Explicit guarded fields for this request. Defaults to the model config. */
	guarded?: readonly string[];
}

export interface ActiveRecordValidationRulesOptions extends ActiveRecordRequestOptions {
	/** Whether hidden fields should be included. Defaults to false. */
	includeHidden?: boolean;
}

export type ActiveRecordRequestMap = Record<string, string>;

export type ActiveRecordConstructor<TRecord extends ActiveRecord = ActiveRecord> = {
	new(
		input?: Record<string, unknown>,
		options?: ActiveRecordOptions,
	): TRecord;
};

export type ActiveRecordInstance<TModel extends ActiveRecordConstructor> =
	InstanceType<TModel>;

/**
 * Static side of an ActiveRecord model class.
 *
 * Each subclass acts as its own schema by defining static `table`, `primaryKey`,
 * and a `fields(field)` method.
 */
export type ActiveRecordClass<TRecord extends ActiveRecord = ActiveRecord> = ActiveRecordConstructor<TRecord> & {
	/** Runtime JavaScript class name. */
	readonly name: string;

	/** Database table name. */
	table: string;

	/** Developer-facing model note for generated schemas and tooling. */
	comment?: string;

	/** Logical primary-key field name. */
	primaryKey: string;

	/** Fields used to render row labels when this model is linked from another model. */
	labelFields?: string[];

	/** Logical fields that request filling may assign. Undefined means all non-guarded fields. */
	requestFillable?: readonly string[];

	/** Logical fields that request filling may not assign. */
	requestGuarded?: readonly string[];

	/** Static field definitions for the model. */
	fields(field: FieldBuilder): FieldInputMap;

	/** Resolved static field definitions for the model. */
	getFields(): FieldMap;

	/** Returns a DomForm render spec composed from the model's FieldTypes. */
	getForm(options?: ModelFormOptions): DomFormRenderSpec;

	/** Returns search filter render specs composed from the model's FieldTypes. */
	getSearchFilters(options?: ModelFormOptions): Record<string, FrontendComponentSpec>;

	/** Looks up one resolved static field definition. */
	getField(fieldName: string): FieldType<any, any, any, any, any>;

	/** Optional default database connection for this model. Falls back to the shared app connection. */
	db?: Knex;

	/** Whether inserts/updates should call `.returning('*')`. */
	returning?: boolean;

	/** Soft-delete setting. True uses the conventional `deletedAt` logical field. */
	softDeletes: ActiveRecordSoftDeleteConfig;

	/** Returns the database connection for this model in the current app/scope. */
	getDb(): Knex;

	/** Runs work with a temporary database connection for all ActiveRecord statics. */
	withDb<TResult>(db: Knex, callback: () => TResult): TResult;

	/** Binds a default database connection to the model class. */
	useDb<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db: Knex,
	): TModel;

	/** Creates a new unsaved record bound to the model's current database. */
	create<TModel extends ActiveRecordConstructor>(
		this: TModel,
		input?: Record<string, unknown>,
		options?: Omit<ActiveRecordOptions, 'db'>,
	): ActiveRecordInstance<TModel>;

	/** Starts a field-aware query for the model. */
	query<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;

	/** Starts a query that includes soft-deleted rows. */
	withTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;

	/** Starts a query that only includes soft-deleted rows. */
	onlyTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;

	/** Starts a query that excludes soft-deleted rows. */
	withoutTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;

	/** Convenience helper for `query().where(...)`. */
	where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		criteria: Record<string, unknown>,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;
	where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		fieldName: string,
		value: unknown,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;
	where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		fieldName: string,
		operator: string,
		value: unknown,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;

	/** Finds one record by the configured primary key. */
	findByPk<TModel extends ActiveRecordConstructor>(
		this: TModel,
		id: unknown,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel> | null>;

	/** Finds one record by the configured primary key. */
	find<TModel extends ActiveRecordConstructor>(
		this: TModel,
		lookup: ActiveRecordLookup,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel> | null>;

	/** Finds one record by the configured primary key or throws an error if not found. */
	findOrFail<TModel extends ActiveRecordConstructor>(
		this: TModel,
		lookup: ActiveRecordLookup,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel>>;

	/** Hydrates a model instance from a raw database row. */
	fromDb<TModel extends ActiveRecordConstructor>(
		this: TModel,
		row: DbRow,
		db?: Knex,
	): ActiveRecordInstance<TModel>;

	/** Returns validation rules generated from model fields. */
	validationRules(options?: ActiveRecordValidationRulesOptions): ValidationRules;
};

/**
 * Minimal ActiveRecord base class.
 *
 * Subclasses define their table and fields statically. Each instance creates
 * private live field objects, and public model properties proxy through to those
 * fields.
 *
 * Example:
 *
 * ```ts
 * class User extends ActiveRecord {
 *   static table = 'users';
 *   static fields(field: FieldBuilder) {
 *     return {
 *       email: field.email({ required: true }),
 *     };
 *   }
 * }
 *
 * const user = new User();
 * user.email = 'STEVE@EXAMPLE.COM';
 * console.log(user.email); // 'steve@example.com'
 * ```
 */
export abstract class ActiveRecord {
	/** Database table name. Override in subclasses. */
	static table: string;

	/** Developer-facing model note for generated schemas and tooling. */
	static comment = '';

	/** Logical primary-key field name. Override if not `id`. */
	static primaryKey = 'id';

	/** Fields used to render row labels when this model is linked from another model. */
	static labelFields: string[] = [];

	/** Logical fields that request filling may assign. Undefined means all non-guarded fields. */
	static requestFillable?: readonly string[];

	/** Logical fields that request filling may not assign. */
	static requestGuarded: readonly string[] = [];

	/** Static field factory. Override in subclasses. */
	static fields(_field: FieldBuilder): FieldInputMap {
		return {};
	}

	/** Optional model-level database connection. Falls back to the shared app connection. */
	static db?: Knex;

	/**
	 * Whether to call `.returning('*')` after inserts/updates.
	 *
	 * This is usually desirable for PostgreSQL. Set to `false` for dialects where
	 * returning is unsupported or unwanted.
	 */
	static returning = true;

	/** Soft-delete setting. True uses the conventional `deletedAt` logical field. */
	static softDeletes: ActiveRecordSoftDeleteConfig = false;

	/** Per-record live fields, keyed by logical field name. */
	private readonly $fields: Record<string, FieldType<any, any, any, any, any>> = {};

	/** Whether the record currently represents an existing database row. */
	protected $persisted = false;

	/** Optional instance-level database connection/session. */
	protected $db?: Knex;

	constructor(
		input: Record<string, unknown> = {},
		options: ActiveRecordOptions = {},
	) {
		const Model = this.$model();

		this.$db = options.db ?? Model.db;
		this.$persisted = options.persisted ?? options.fromDb ?? false;

		for (const [fieldName, field] of Object.entries(Model.getFields())) {
			const liveField = field.clone().bindToRecord(this, fieldName);

			this.$fields[fieldName] = liveField;
			this.$installAccessor(fieldName);
		}

		if (options.fromDb) {
			this.$hydrateFromDb(input);
		} else {
			this.assign(input);
		}
	}

	/**
	 * Binds a custom default database connection to the model class.
	 *
	 * Most models can use the active app connection automatically. For tests,
	 * prefer creating an app with the test database. For scoped work such as
	 * transactions, use `withDb()`.
	 */
	static useDb<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db: Knex,
	): TModel {
		(this as unknown as ActiveRecordClass).db = db;
		return this;
	}

	/**
	 * Returns the database connection for the current ActiveRecord operation.
	 */
	static getDb(): Knex {
		return scopedDb.getStore()
			?? this.db
			?? activeAppDatabase()
			?? defaultDb();
	}

	/**
	 * Runs work with a temporary database connection for all ActiveRecord statics.
	 */
	static withDb<TResult>(db: Knex, callback: () => TResult): TResult {
		return scopedDb.run(db, callback);
	}

	/**
	 * Creates a new unsaved record bound to this model's current database.
	 */
	static create<TModel extends ActiveRecordConstructor>(
		this: TModel,
		input: Record<string, unknown> = {},
		options: Omit<ActiveRecordOptions, 'db'> = {},
	): ActiveRecordInstance<TModel> {
		return new this(input, {
			...options,
			db: ActiveRecord.getDb.call(this),
		}) as ActiveRecordInstance<TModel>;
	}

	/**
	 * Resolves the model's static field factory with the framework field helper.
	 */
	static getFields<TRecord extends ActiveRecord>(
		this: ActiveRecordClass<TRecord>,
	): FieldMap {
		return resolveModelFields(this);
	}

	/**
	 * Returns a DomForm render spec composed from this model's FieldTypes.
	 */
	static getForm<TRecord extends ActiveRecord>(
		this: ActiveRecordClass<TRecord>,
		options: ModelFormOptions = {},
	): DomFormRenderSpec {
		const children = Object.entries(this.getFields()).flatMap(([fieldName, field]) => {
			if (!options.includeGenerated && field.config.generated) return [];

			return [
				field.getFormComponentFor(this, fieldName, {
					mode: options.mode ?? 'create',
				}),
			];
		});

		return {
			component: 'DomForm',
			props: {
				name: options.name ?? this.table,
			},
			children,
		};
	}

	/**
	 * Returns search filter render specs composed from this model's FieldTypes.
	 */
	static getSearchFilters<TRecord extends ActiveRecord>(
		this: ActiveRecordClass<TRecord>,
		options: ModelFormOptions = {},
	): Record<string, FrontendComponentSpec> {
		const filters: Record<string, FrontendComponentSpec> = {};

		for (const [fieldName, field] of Object.entries(this.getFields())) {
			const component = field.getSearchFilterComponentFor(this, fieldName, {
				mode: options.mode ?? 'search',
			});

			if (component) {
				filters[fieldName] = component;
			}
		}

		return filters;
	}

	/**
	 * Looks up one resolved field definition by logical field name.
	 */
	static getField<TRecord extends ActiveRecord>(
		this: ActiveRecordClass<TRecord>,
		fieldName: string,
	): FieldType<any, any, any, any, any> {
		const field = this.getFields()[fieldName];

		if (!field) {
			throw new Error(
				`Unknown field "${fieldName}" on model ${this.name}`,
			);
		}

		return field;
	}

	/**
	 * Starts a field-aware query for this model.
	 */
	static query<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		const Model = this as unknown as ActiveRecordClass<
			ActiveRecordInstance<TModel>
		>;
		const connection = db ?? ActiveRecord.getDb.call(this);

		return new ActiveQueryBuilder<ActiveRecordInstance<TModel>>(
			Model,
			connection,
		);
	}

	/**
	 * Starts a query that includes soft-deleted rows.
	 */
	static withTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		return (
			ActiveRecord.query.call(this, db) as ActiveQueryBuilder<
				ActiveRecordInstance<TModel>
			>
		).withTrashed();
	}

	/**
	 * Starts a query that only includes soft-deleted rows.
	 */
	static onlyTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		return (
			ActiveRecord.query.call(this, db) as ActiveQueryBuilder<
				ActiveRecordInstance<TModel>
			>
		).onlyTrashed();
	}

	/**
	 * Starts a query that excludes soft-deleted rows.
	 */
	static withoutTrashed<TModel extends ActiveRecordConstructor>(
		this: TModel,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		return (
			ActiveRecord.query.call(this, db) as ActiveQueryBuilder<
				ActiveRecordInstance<TModel>
			>
		).withoutTrashed();
	}

	/**
	 * Convenience helper for `Model.query().where(...)`.
	 */
	static where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		criteria: Record<string, unknown>,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;
	static where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		fieldName: string,
		value: unknown,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;
	static where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		fieldName: string,
		operator: string,
		value: unknown,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>>;
	static where<TModel extends ActiveRecordConstructor>(
		this: TModel,
		fieldNameOrCriteria: string | Record<string, unknown>,
		operatorOrValue?: unknown,
		value?: unknown,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		const query = ActiveRecord.query.call(this) as ActiveQueryBuilder<
			ActiveRecordInstance<TModel>
		>;

		if (typeof fieldNameOrCriteria === 'object' && fieldNameOrCriteria !== null) {
			return query.where(fieldNameOrCriteria);
		}

		return arguments.length === 3
			? query.where(fieldNameOrCriteria, String(operatorOrValue), value)
			: query.where(fieldNameOrCriteria, operatorOrValue);
	}

	/**
	 * Finds one record by the configured primary key.
	 */
	static async findByPk<TModel extends ActiveRecordConstructor>(
		this: TModel,
		id: unknown,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel> | null> {
		const query = ActiveRecord.query.call(this, db) as ActiveQueryBuilder<
			ActiveRecordInstance<TModel>
		>;

		return query.wherePk(id).first();
	}

	/**
	 * Finds one record by the configured primary key or field criteria.
	 */
	static async find<TModel extends ActiveRecordConstructor>(
		this: TModel,
		lookup: ActiveRecordLookup,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel> | null> {
		return ActiveRecord.queryForLookup.call(this, lookup, db).first() as Promise<
			ActiveRecordInstance<TModel> | null
		>;
	}

	/**
	 * Finds one record by the configured primary key or field criteria.
	 *
	 * Throws a `RecordNotFoundError` if no matching row exists.
	 */
	static async findOrFail<TModel extends ActiveRecordConstructor>(
		this: TModel,
		lookup: ActiveRecordLookup,
		db?: Knex,
	): Promise<ActiveRecordInstance<TModel>> {
		const record = await ActiveRecord.find.call(this, lookup, db) as
			| ActiveRecordInstance<TModel>
			| null;

		if (!record) {
			throw new RecordNotFoundError(this.name, lookup);
		}

		return record;
	}

	private static queryForLookup<TModel extends ActiveRecordConstructor>(
		this: TModel,
		lookup: ActiveRecordLookup,
		db?: Knex,
	): ActiveQueryBuilder<ActiveRecordInstance<TModel>> {
		const query = ActiveRecord.query.call(this, db) as ActiveQueryBuilder<
			ActiveRecordInstance<TModel>
		>;

		if (isLookupCriteria(lookup)) {
			if (Object.keys(lookup).length === 0) {
				throw new Error('At least one lookup field is required.');
			}

			return query.where(lookup);
		}

		return query.wherePk(lookup);
	}

	/**
	 * Hydrates a model instance from a raw database row.
	 */
	static fromDb<TModel extends ActiveRecordConstructor>(
		this: TModel,
		row: DbRow,
		db?: Knex,
	): ActiveRecordInstance<TModel> {
		return new this(row, {
			db,
			fromDb: true,
			persisted: true,
		}) as ActiveRecordInstance<TModel>;
	}

	/**
	 * Returns Laravel-style validation rules generated from this model's fields.
	 */
	static validationRules<TRecord extends ActiveRecord>(
		this: ActiveRecordClass<TRecord>,
		options: ActiveRecordValidationRulesOptions = {},
	): ValidationRules {
		const rules: ValidationRules = {};

		for (const [fieldName, field] of Object.entries(this.getFields())) {
			if (!shouldIncludeFieldValidationRules(this, fieldName, field, options)) continue;

			rules[fieldName] = field.getValidationRules({
				model: this,
				fieldName,
			});
		}

		return rules;
	}

	/**
	 * Assigns app/input values by logical field name.
	 *
	 * Unknown keys are ignored. Use `set(fieldName, value)` if you want an error
	 * for unknown fields.
	 */
	assign(input: Record<string, unknown>): this {
		for (const fieldName of Object.keys(this.$fields)) {
			if (Object.prototype.hasOwnProperty.call(input, fieldName)) {
				this.$set(fieldName, input[fieldName]);
			}
		}

		return this;
	}

	/**
	 * Assigns request/form values using logical model field names.
	 */
	assignFromRequest(input: unknown, options: ActiveRecordRequestOptions = {}): this {
		return this.setFromRequest(input, options);
	}

	/**
	 * Fills this record from request/form values using logical model field names.
	 *
	 * Unknown keys are ignored. Primary/generated/guarded fields are skipped by
	 * default, and model/request fillable config controls what may be assigned.
	 */
	setFromRequest(input: unknown, options: ActiveRecordRequestOptions = {}): this {
		const requestInput = recordFromUnknown(input);

		for (const [fieldName, field] of Object.entries(this.$fields)) {
			if (!this.$canFillFromRequest(fieldName, field, options)) continue;
			if (!Object.prototype.hasOwnProperty.call(requestInput, fieldName)) continue;

			this.$set(fieldName, requestInput[fieldName]);
		}

		return this;
	}

	/**
	 * Fills this record from request/form values using a request-key to model-field map.
	 */
	setFromRequestWithMap(
		input: unknown,
		dataToFieldMap: ActiveRecordRequestMap,
		options: ActiveRecordRequestOptions = {},
	): this {
		const requestInput = recordFromUnknown(input);
		const mappedInput: Record<string, unknown> = {
			...requestInput,
		};

		for (const [dataKey, fieldName] of Object.entries(dataToFieldMap)) {
			if (Object.prototype.hasOwnProperty.call(requestInput, dataKey)) {
				mappedInput[fieldName] = requestInput[dataKey];
			}
		}

		return this.setFromRequest(mappedInput, options);
	}

	/**
	 * Dynamically sets a field by logical name.
	 *
	 * Useful for runtime/database-stored schemas where TypeScript cannot know the
	 * field names at compile time.
	 */
	set(fieldName: string, value: unknown): this {
		this.$set(fieldName, value);
		return this;
	}

	/**
	 * Dynamically gets a field by logical name.
	 */
	get(fieldName: string): unknown {
		return this.$get(fieldName);
	}

	/**
	 * Dynamically binds this record instance to a database connection/session.
	 */
	setDb(db: Knex): this {
		this.$db = db;
		return this;
	}

	/**
	 * Returns true if the model has the given logical field.
	 */
	hasField(fieldName: string): boolean {
		return Boolean(this.$fields[fieldName]);
	}

	/**
	 * Returns the bound runtime field for framework-level hydration helpers.
	 */
	getBoundField(fieldName: string): FieldType<any, any, any, any, any> {
		return this.$field(fieldName);
	}

	/**
	 * Validates fields and stores field errors on each field state.
	 */
	async validate(options: { onlyDirty?: boolean } = {}): Promise<boolean> {
		for (const field of Object.values(this.$fields)) {
			if (options.onlyDirty && !field.dirty) {
				continue;
			}

			await field.validateField();
		}

		return !this.hasErrors();
	}

	/**
	 * Clears all current validation errors.
	 */
	clearErrors(): void {
		for (const field of Object.values(this.$fields)) {
			field.clearErrors();
		}
	}

	/**
	 * Returns true if any field currently has validation errors.
	 */
	hasErrors(): boolean {
		return this.getErrors().length > 0;
	}

	/**
	 * Returns all field errors on this record.
	 */
	getErrors(): FieldError[] {
		const errors: FieldError[] = [];

		for (const field of Object.values(this.$fields)) {
			errors.push(...field.errors);
		}

		return errors;
	}

	/**
	 * Returns current validation errors for one field.
	 */
	getFieldErrors(fieldName: string): FieldError[] {
		return this.$field(fieldName).errors;
	}

	/**
	 * Returns database insert/update data for the record.
	 *
	 * This calls every field's `getDataForDb()` method. This is where passwords
	 * are hashed, JSON fields are stringified, link fields produce foreign keys,
	 * and compound fields can return multiple columns.
	 */
	async getDataForDb(
		options: Partial<DbWriteOptions> = {},
	): Promise<DbWriteData> {
		const writeOptions = {
			isInsert: options.isInsert ?? !this.$persisted,
			onlyDirty: options.onlyDirty ?? false,
			valueOptions: options.valueOptions,
		};

		const row: DbWriteData = {};

		for (const field of Object.values(this.$fields)) {
			const fieldData = await field.getBoundDataForDb(writeOptions);

			Object.assign(row, fieldData);
		}

		return row;
	}

	/**
	 * Inserts or updates this record.
	 *
	 * Validation runs before any SQL is executed. On validation failure this throws
	 * `RecordValidationError` containing all field errors.
	 */
	async save(): Promise<this> {
		const Model = this.$model();
		const connection = this.$db ?? Model.getDb();

		const isInsert = !this.$persisted;
		const valid = await this.validate({ onlyDirty: false });

		if (!valid) {
			throw new RecordValidationError(this.getErrors());
		}

		const row = await this.getDataForDb({
			isInsert,
			onlyDirty: !isInsert,
			valueOptions: {
				db: connection,
				dialect: databaseDialectForConnection(connection),
			},
		});

		if (isInsert) {
			const query = connection(Model.table).insert(row);
			const result = shouldUseReturningRows(Model, connection)
				? await query.returning('*')
				: await query;

			const createdRow = Array.isArray(result) ? result[0] : undefined;

			if (createdRow && typeof createdRow === 'object') {
				this.$hydrateFromDb(createdRow as DbRow);
			}

			this.$persisted = true;
			this.$markClean();

			return this;
		}

		if (Object.keys(row).length === 0) {
			return this;
		}

		const query = connection(Model.table)
			.where(this.$primaryKeyWhere())
			.update(row);

		const result = shouldUseReturningRows(Model, connection)
			? await query.returning('*')
			: await query;

		const updatedRow = Array.isArray(result) ? result[0] : undefined;

		if (updatedRow && typeof updatedRow === 'object') {
			this.$hydrateFromDb(updatedRow as DbRow);
		}

		this.$markClean();

		return this;
	}

	/**
	 * Deletes the current database row.
	 *
	 * Models with `softDeletes` enabled update their delete timestamp instead of
	 * physically removing the row.
	 */
	async delete(db?: Knex): Promise<number> {
		if (modelUsesSoftDeletes(this.$model())) {
			return this.softDelete(db);
		}

		return this.forceDelete(db);
	}

	/**
	 * Physically deletes the current database row.
	 */
	async forceDelete(db?: Knex): Promise<number> {
		const Model = this.$model();
		const connection = db ?? this.$db ?? Model.getDb();

		const count = await connection(Model.table)
			.where(this.$primaryKeyWhere())
			.delete();

		this.$persisted = false;

		return Number(count);
	}

	/**
	 * Restores the current soft-deleted database row.
	 */
	async restore(db?: Knex): Promise<number> {
		const Model = this.$model();
		const connection = db ?? this.$db ?? Model.getDb();
		const softDeleteField = requireSoftDeleteField(Model);
		const updatedAt = new Date();
		const count = await connection(Model.table)
			.where(this.$primaryKeyWhere())
			.whereNotNull(softDeleteField.column)
			.update(getSoftDeleteWriteData(Model, null, updatedAt));
		const restoredCount = Number(count);

		if (restoredCount > 0) {
			this.$setSoftDeleteFieldValues(null, updatedAt);
			this.$persisted = true;
			this.$markClean();
		}

		return restoredCount;
	}

	/**
	 * Returns true when this soft-deletable record has been trashed.
	 */
	trashed(): boolean {
		const softDeleteField = requireSoftDeleteField(this.$model());
		const value = this.$get(softDeleteField.fieldName);

		return value !== null && value !== undefined;
	}

	/**
	 * Returns hydrated backend values keyed by logical field name.
	 */
	toAppData(): Record<string, unknown> {
		const data: Record<string, unknown> = {};

		for (const [fieldName, field] of Object.entries(this.$fields)) {
			if (field.config.hidden) continue;

			data[fieldName] = field.value;
		}

		return data;
	}

	/**
	 * Serialises this record using each field's display value.
	 */
	toDisplayData(): Record<string, unknown> {
		const data: Record<string, unknown> = {};

		for (const [fieldName, field] of Object.entries(this.$fields)) {
			const value = field.getBoundDisplayValue();

			if (value !== undefined) {
				data[fieldName] = value;
			}
		}

		return data;
	}

	/**
	 * JSON transport alias for display data.
	 */
	toJSON(): Record<string, unknown> {
		return this.toDisplayData();
	}

	/**
	 * Returns true if this record was loaded from or saved to the database.
	 */
	isPersisted(): boolean {
		return this.$persisted;
	}

	/**
	 * Returns whether one field or any field has unsaved in-memory changes.
	 *
	 * @param fieldName - Optional logical field name to inspect.
	 * @returns True when the selected field scope contains unsaved changes.
	 */
	isDirty(fieldName?: string): boolean {
		if (fieldName !== undefined) {
			return this.$field(fieldName).dirty;
		}

		return Object.values(this.$fields).some(field => field.dirty);
	}

	/**
	 * Protected field getter used by generated accessors and `get()`.
	 */
	protected $get(fieldName: string): unknown {
		return this.$field(fieldName).value;
	}

	/**
	 * Protected field setter used by generated accessors and `set()`.
	 */
	protected $set(fieldName: string, value: unknown): void {
		this.$field(fieldName).value = value;
	}

	/**
	 * Hydrates all fields from a raw database row.
	 */
	protected $hydrateFromDb(row: DbRow): void {
		for (const field of Object.values(this.$fields)) {
			field.hydrate(row);
		}

		this.$persisted = true;
	}

	/**
	 * Marks all fields as clean after a successful save/hydration.
	 */
	protected $markClean(): void {
		for (const field of Object.values(this.$fields)) {
			field.markBoundClean();
		}
	}

	/**
	 * Returns a database where-clause object for the primary key.
	 */
	protected $primaryKeyWhere(): Record<string, unknown> {
		const Model = this.$model();
		const pkName = Model.primaryKey;
		const pkField = this.$field(pkName);
		const pkValue = this.$get(pkName);

		return {
			[pkField.column]: pkField.getBoundQueryValue(pkValue),
		};
	}

	/**
	 * Returns one of this record's live field objects.
	 */
	protected $field(fieldName: string): FieldType<any, any, any, any, any> {
		const field = this.$fields[fieldName];

		if (!field) {
			throw new Error(`Unknown field "${fieldName}"`);
		}

		return field;
	}

	/**
	 * Soft deletes the current database row.
	 */
	private async softDelete(db?: Knex): Promise<number> {
		const Model = this.$model();
		const connection = db ?? this.$db ?? Model.getDb();
		const deletedAt = new Date();
		const count = await connection(Model.table)
			.where(this.$primaryKeyWhere())
			.update(getSoftDeleteWriteData(Model, deletedAt, deletedAt));
		const deletedCount = Number(count);

		if (deletedCount > 0) {
			this.$setSoftDeleteFieldValues(deletedAt, deletedAt);
			this.$markClean();
		}

		return deletedCount;
	}

	/**
	 * Mirrors soft-delete timestamp writes into this record's live field state.
	 */
	private $setSoftDeleteFieldValues(
		deletedAt: Date | null,
		updatedAt: Date,
	): void {
		const Model = this.$model();
		const softDeleteField = requireSoftDeleteField(Model);
		const ignoredFieldNames = new Set([softDeleteField.fieldName]);

		this.$set(softDeleteField.fieldName, deletedAt);

		for (const fieldName of getAutomaticUpdateTimestampFieldNames(Model, ignoredFieldNames)) {
			this.$set(fieldName, updatedAt);
		}
	}

	/**
	 * Returns the static model class for this instance.
	 */
	private $model<TRecord extends ActiveRecord>(): ActiveRecordClass<TRecord> {
		return this.constructor as ActiveRecordClass<TRecord>;
	}

	private $canFillFromRequest(
		fieldName: string,
		field: FieldType<any, any, any, any, any>,
		options: ActiveRecordRequestOptions,
	): boolean {
		if (!options.includePrimary && field.config.primary) return false;
		if (!options.includeGenerated && field.config.generated) return false;

		const Model = this.$model();
		const fillable = options.fillable ?? Model.requestFillable;
		const guarded = options.guarded ?? Model.requestGuarded ?? [];

		if (fillable && !fillable.includes(fieldName)) return false;
		if (guarded.includes(fieldName)) return false;

		return true;
	}

	/**
	 * Defines an instance getter/setter for a configured field.
	 */
	private $installAccessor(fieldName: string): void {
		if (
			Object.prototype.hasOwnProperty.call(this, fieldName)
			|| this.$hasModelAccessor(fieldName)
		) {
			return;
		}

		Object.defineProperty(this, fieldName, {
			enumerable: true,
			configurable: true,

			get: () => this.$get(fieldName),

			set: value => {
				this.$set(fieldName, value);
			},
		});
	}

	/**
	 * Checks whether a model class owns a custom accessor for a field.
	 *
	 * Explicit model accessors may wrap the underlying field through `$get`
	 * and `$set` when a domain value needs a stable model-owned interface.
	 *
	 * @param fieldName - Logical field name being installed.
	 * @returns True when a subclass prototype defines a getter or setter.
	 */
	private $hasModelAccessor(fieldName: string): boolean {
		let prototype = Object.getPrototypeOf(this);

		while (prototype && prototype !== ActiveRecord.prototype) {
			const descriptor = Object.getOwnPropertyDescriptor(prototype, fieldName);

			if (descriptor?.get || descriptor?.set) return true;

			prototype = Object.getPrototypeOf(prototype);
		}

		return false;
	}
}

function shouldUseReturningRows(
	Model: ActiveRecordClass,
	connection: Knex,
): boolean {
	if (Model.returning === false) return false;

	return supportsReturningRows(connection);
}

function supportsReturningRows(connection: Knex): boolean {
	return databaseDialectForConnection(connection).supportsReturningRows;
}

function shouldIncludeFieldValidationRules(
	Model: ActiveRecordClass,
	fieldName: string,
	field: FieldType<any, any, any, any, any>,
	options: ActiveRecordValidationRulesOptions,
): boolean {
	if (!options.includeHidden && field.config.hidden) return false;
	if (!options.includePrimary && field.config.primary) return false;
	if (!options.includeGenerated && field.config.generated) return false;

	const fillable = options.fillable ?? Model.requestFillable;
	const guarded = options.guarded ?? Model.requestGuarded ?? [];

	if (fillable && !fillable.includes(fieldName)) return false;
	if (guarded.includes(fieldName)) return false;

	return true;
}

function isLookupCriteria(input: ActiveRecordLookup): input is Record<string, unknown> {
	return isRecord(input)
		&& !(input instanceof Date);
}

type ResolvedFieldInput<TInput> =
	TInput extends FieldType<any, any, any, any, any>
		? TInput
		: TInput extends FieldClass<infer TField>
			? TField
			: TInput extends FieldDefinition<infer TField>
				? TField
				: never;

type ModelFieldInputs<TModel extends { fields(field: FieldBuilder): FieldInputMap }> =
	ReturnType<TModel['fields']>;

export namespace ActiveRecord {
	export type InferInput<TModel extends { fields(field: FieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ModelFieldInputs<TModel>]:
			FieldInputValue<ResolvedFieldInput<ModelFieldInputs<TModel>[fieldName]>>;
	};

	export type InferValue<TModel extends { fields(field: FieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ModelFieldInputs<TModel>]:
			FieldValue<ResolvedFieldInput<ModelFieldInputs<TModel>[fieldName]>>;
	};

	export type InferDbRow<TModel extends { fields(field: FieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ModelFieldInputs<TModel>]:
			FieldDbValue<ResolvedFieldInput<ModelFieldInputs<TModel>[fieldName]>>;
	};

	export type InferDisplay<TModel extends { fields(field: FieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ModelFieldInputs<TModel>]:
			FieldDisplayValue<ResolvedFieldInput<ModelFieldInputs<TModel>[fieldName]>>;
	};
}
