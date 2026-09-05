import {
	isFinallyPromise,
	normalizeDatabaseComment,
	startCase,
} from '@db3.ai/pure';
import type { Knex } from 'knex';
import { isDeepStrictEqual } from 'node:util';
import type { ValidationRule } from '../validation';
import type {
	DatabaseDialect,
	DatabaseValueOptions,
} from './dialects';
import { resolveDatabaseDialect } from './dialects';

/**
 * Generic database row shape returned by the SQL driver.
 */
export type DbRow = Record<string, unknown>;

/**
 * Partial database row used for inserts and updates.
 *
 * A field returns an object instead of a scalar because some fields may map to
 * multiple database columns. For example, a map/location field could return
 * `{ location_lat, location_lng }`.
 */
export type DbWriteData = Record<string, unknown>;

/**
 * A structured validation error attached to a specific model field.
 */
export interface FieldError {
	/** Logical field name on the model, for example `email` or `password`. */
	field: string;

	/** Human-readable error message. */
	message: string;

	/** Stable machine-readable error code, for example `required`. */
	code?: string;

	/** Offending value, where safe to expose. Avoid storing secrets here. */
	value?: unknown;

	/** Extra structured data for UI/API consumers. */
	details?: unknown;
}

/**
 * Error thrown by `ActiveRecord.save()` when one or more fields are invalid.
 */
export class RecordValidationError extends Error {
	constructor(public readonly errors: FieldError[]) {
		super('Record validation failed');
		this.name = 'RecordValidationError';
	}
}

export type FieldDefault =
	| null
	| string
	| number
	| boolean
	| Record<string, unknown>
	| unknown[];

export type FieldDefaultFactory = () => unknown;

export type GeneratedValue =
	| boolean
	| 'db'
	| 'ulid'
	| 'uuid-v4'
	| 'now';

export interface FrontendComponentSpec {
	component: string;
	props: Record<string, unknown>;
}

export interface DomFormRenderSpec {
	component: 'DomForm';
	props: Record<string, unknown>;
	children: FrontendComponentSpec[];
}

export interface FieldFrontendConfig {
	component?: string;
	props?: Record<string, unknown>;
	searchComponent?: string;
	searchProps?: Record<string, unknown>;
}

export interface FieldRenderOptions {
	mode?: 'create' | 'edit' | 'search';
}

/**
 * Core configuration shared by all fields.
 *
 * Concrete field types should extend this with their own options.
 */
export interface FieldConfig {
	/** Database column name. Defaults to the model field name. */
	column?: string;

	/** Developer-facing note for generated models and schema tooling. */
	comment?: string;

	/** Whether the field must have a non-empty value. */
	required?: boolean;

	/** Whether the field is the model primary key. */
	primary?: boolean;

	/** Whether the value should be omitted from `toJSON()`. */
	hidden?: boolean;

	/** Whether normal ActiveRecord fetches should include this field's columns. */
	selectedByDefault?: boolean;

	/** Whether the generated database schema should include a unique constraint. */
	unique?: boolean;

	/** Whether the generated database schema should include an index on this field's primary column. */
	index?: boolean;

	/** Optional name for the generated single-column index. */
	indexName?: string;

	/** Additional generated database schema indexes for this field. */
	indexes?: DbIndexSpec[];

	/** Optional human-friendly label for UI/admin/form generation. */
	label?: string;

	/** Static default value or runtime factory. Use static values for serializable config. */
	default?: FieldDefault | FieldDefaultFactory;

	/** Named generation strategy. This is serializable and lets the field/framework decide how to generate the value. */
	generated?: GeneratedValue;

	/** Frontend rendering hints composed by FieldType render helpers. */
	frontend?: FieldFrontendConfig;
}

export type FieldClass<TField extends FieldType<any, any, any, any, any> = FieldType<any, any, any, any, any>> =
	new (config?: any) => TField;

export interface FieldDefinition<TField extends FieldType<any, any, any, any, any> = FieldType<any, any, any, any, any>> {
	type: FieldClass<TField>;
	config: ConstructorParameters<FieldClass<TField>>[0];
}

export type FieldInput<TField extends FieldType<any, any, any, any, any> = FieldType<any, any, any, any, any>> =
	| FieldClass<TField>
	| FieldDefinition<TField>
	| TField;

export type FieldInputMap = Record<string, FieldInput<any>>;

export type FieldMap = Record<string, FieldType<any, any, any, any, any>>;

export type FieldMapFactory = (field: any) => FieldInputMap;

/**
 * Context passed into low-level field methods.
 *
 * Record instances normally use the higher-level field instance API. This
 * context remains for schema/query work and for concrete field internals.
 */
export interface FieldContext {
	/** The model class metadata. */
	model: ModelMetadata;

	/** Database dialect used for schema/value conversion when available. */
	dialect?: DatabaseDialect;

	/** Knex table builder when schema is being applied to the database. */
	table?: Knex.TableBuilder;

	/** Options used when writing columns through `table`. */
	columnWriteOptions?: DbColumnWriteOptions;

	/** The active record instance when available. Query code may omit this. */
	record?: unknown;

	/** Logical field name on the model, for example `email`. */
	fieldName: string;
}

/**
 * Minimal model metadata required by fields.
 *
 * This avoids importing `ActiveRecord` into the field base class and keeps the
 * dependency direction simple.
 */
export interface ModelMetadata {
	/** Database table name. */
	table: string;

	/** Logical primary-key field name. */
	primaryKey: string;

	/** Static field definitions on the model class. */
	fields: FieldMapFactory;
}

/**
 * Options passed when collecting database write data from fields.
 */
export interface DbWriteOptions {
	/** True for insert, false for update. */
	isInsert: boolean;

	/** Whether clean fields should be excluded from the generated row. */
	onlyDirty: boolean;

	/** Database value conversion context for driver-specific field storage. */
	valueOptions?: DatabaseValueOptions;
}

/**
 * Basic state used by most one-column value fields.
 */
export interface BasicFieldState<TValue = unknown> {
	/** Current app-memory value. */
	value: TValue;

	/** Value originally loaded from the database or initial default. */
	originalValue: TValue;

	/** Whether the current value differs from the original value. */
	dirty: boolean;

	/** Validation errors for this field on this record. */
	errors: FieldError[];
}

/**
 * Captures a clean comparison snapshot for mutable field values.
 *
 * Ordinary JSON objects, arrays, dates, maps, and sets are cloned so in-place
 * mutations remain visible to dirty tracking. Values that cannot be cloned
 * without changing their initial semantics retain their existing identity and
 * continue to rely on explicit assignment.
 *
 * @param value - Current field value to retain as the clean baseline.
 * @returns Independent comparison snapshot when the value supports it.
 */
function snapshotFieldValue<TValue>(value: TValue): TValue {
	if (typeof value !== 'object' || value === null) {
		return value;
	}

	try {
		const snapshot = structuredClone(value);

		return isDeepStrictEqual(value, snapshot)
			? snapshot
			: value;
	} catch {
		return value;
	}
}

/**
 * Database column description produced by a field's `getDbSchema()`.
 *
 * The `type` string comes from the active dialect and is applied directly by
 * `Database` via Knex `specificType`.
 */
export interface DbColumnSpec {
	/** Database column name. */
	name: string;

	/** Database column type, e.g. `varchar(255)`, `char(26)`, `json`, or `longtext`. */
	type: string;

	/** Whether null is allowed. */
	nullable?: boolean;

	/** Whether this column is the primary key. */
	primary?: boolean;

	/** Whether this column has a unique constraint. */
	unique?: boolean;

	/** Database default value. */
	default?: unknown;

	/** Database-native column comment where supported, such as MySQL. */
	comment?: string;
}

/**
 * Options for writing a column onto a Knex table builder.
 */
export interface DbColumnWriteOptions {
	alter?: boolean;
	alterNullable?: boolean;
	alterType?: boolean;
	applyDefault?: boolean;
	applyComment?: boolean;
}

/**
 * Writes a column spec onto a Knex table builder.
 */
export function writeDbColumn(
	table: Knex.TableBuilder,
	column: DbColumnSpec,
	options: DbColumnWriteOptions = {},
): void {
	const columnBuilder = table.specificType(column.name, column.type);

	if (column.primary && !options.alter) {
		columnBuilder.primary();
	}

	if (!options.alter || options.alterNullable) {
		if (column.nullable === false || column.primary) {
			columnBuilder.notNullable();
		} else {
			columnBuilder.nullable();
		}
	}

	if (column.unique && !options.alter) {
		columnBuilder.unique();
	}

	if (column.default !== undefined && options.applyDefault !== false) {
		columnBuilder.defaultTo(column.default as any);
	}

	const comment = normalizeDatabaseComment(column.comment);

	if (comment && options.applyComment !== false) {
		columnBuilder.comment(comment);
	}

	if (options.alter) {
		columnBuilder.alter({
			alterNullable: options.alterNullable ?? false,
			alterType: options.alterType ?? false,
		});
	}
}

/**
 * Neutral database index description.
 */
export interface DbIndexSpec {
	/** Columns included in the index. */
	columns: DbIndexColumnSpec[];

	/** Optional index name. */
	name?: string;

	/** Whether the index is unique. */
	unique?: boolean;

	/** Database index kind. Defaults to a normal scalar index. */
	type?: 'normal' | 'vector';
}

export type DbIndexColumnSpec =
	| string
	| {
		name: string;
		order?: 'asc' | 'desc';
	};

export function fieldSchemaIndexes(
	column: string,
	config: FieldConfig,
): DbIndexSpec[] | undefined {
	const indexes = [...(config.indexes ?? [])];

	if (config.index) {
		indexes.push({
			columns: [column],
			name: config.indexName,
		});
	}

	return indexes.length > 0 ? indexes : undefined;
}

/**
 * Neutral foreign-key description.
 */
export interface DbForeignKeySpec {
	/** Local database column. */
	column: string;

	/** Referenced database table. */
	referencesTable: string;

	/** Referenced database column. */
	referencesColumn: string;

	/** Optional ON DELETE action. */
	onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

	/** Optional ON UPDATE action. */
	onUpdate?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';
}

/**
 * Database schema contribution produced by a single field.
 */
export interface DbSchemaPart {
	/** Columns required by this field. */
	columns?: DbColumnSpec[];

	/** Indexes required by this field. */
	indexes?: DbIndexSpec[];

	/** Foreign keys required by this field. */
	foreignKeys?: DbForeignKeySpec[];
}

/**
 * Base class for reusable field behaviour.
 *
 * Static model fields are schema definitions. Each ActiveRecord instance creates
 * private live field objects that own their value, dirty state, errors, field
 * name, and parent record reference.
 *
 * The low-level lifecycle remains:
 *
 * - `createState()` creates per-record storage.
 * - `setValue()` handles input assignment and stores the hydrated backend value.
 * - `getValue()` handles normal property reads.
 * - `validate()` stores field errors.
 * - `getDataForDb()` returns database write data.
 * - `setFromDb()` hydrates state from a database row.
 * - `getDisplayValue()` serializes for frontend/form/API-safe output.
 */
export abstract class FieldType<
	TValue = unknown,
	TDbValue = TValue,
	TDisplayValue = TValue,
	TInput = TValue,
	TState extends { errors: FieldError[] } = BasicFieldState<TValue>,
> {
	private $fieldName?: string;
	private $model?: ModelMetadata;
	private $record?: unknown;
	private $state?: TState;
	private $activeContext?: FieldContext;

	constructor(public readonly config: FieldConfig = {}) { }

	/**
	 * Logical field name on the parent record.
	 */
	get name(): string {
		return this.fieldName;
	}

	/**
	 * Logical field name on the parent record/model.
	 */
	get fieldName(): string {
		return this.context.fieldName;
	}

	/**
	 * Parent model metadata.
	 */
	get model(): ModelMetadata {
		return this.context.model;
	}

	/**
	 * Parent ActiveRecord instance.
	 */
	get record(): unknown {
		const record = this.context.record;

		if (record === undefined) {
			throw new Error('Field is not bound to a record.');
		}

		return record;
	}

	public required(value: boolean = true): this {
		this.config.required = value;
		return this;
	}

	/**
	 * Primary database column for this bound field.
	 */
	get column(): string {
		return this.getColumn();
	}

	/**
	 * Current app-memory value for this bound field.
	 */
	get value(): TValue {
		return this.getValue(this.state);
	}

	set value(input: TInput) {
		this.setValue(this.state, input);
	}

	/**
	 * Whether this bound field has changed since hydration/default creation.
	 */
	get dirty(): boolean {
		return this.isDirty(this.state);
	}

	/**
	 * Current validation errors for this bound field.
	 */
	get errors(): FieldError[] {
		return this.getErrors(this.state);
	}

	/**
	 * Clears validation errors for this bound field.
	 */
	clearErrors(): void {
		this.state.errors = [];
	}

	/**
	 * Hydrates this bound field from a database row.
	 */
	hydrate(row: DbRow): void {
		this.setFromDb(this.state, row);
	}

	/**
	 * Validates this bound field.
	 */
	async validateField(): Promise<FieldError[]> {
		return this.validate(this.state);
	}

	/**
	 * Returns database write data for this bound field.
	 */
	async getBoundDataForDb(options: DbWriteOptions): Promise<DbWriteData> {
		return this.getDataForDb(this.state, options);
	}

	/**
	 * Returns a frontend/form/API-safe value for this bound field.
	 */
	getBoundDisplayValue(): TDisplayValue | undefined {
		return this.getDisplayValue(this.state);
	}

	/**
	 * Converts a query value for this bound field.
	 */
	getBoundQueryValue(input: TInput): unknown {
		return this.getQueryValue(input);
	}

	/**
	 * Marks this bound field as clean.
	 */
	markBoundClean(): void {
		this.markClean(this.state);
	}

	/**
	 * Returns the column for this field blueprint on a model.
	 */
	getColumnFor(model: ModelMetadata, fieldName: string): string {
		return this.getColumn({
			model,
			fieldName,
		});
	}

	/**
	 * Converts a query value for this field blueprint on a model.
	 */
	getQueryValueFor(
		model: ModelMetadata,
		fieldName: string,
		input: TInput,
	): unknown {
		return this.getQueryValue(input, {
			model,
			fieldName,
		});
	}

	/**
	 * Returns schema metadata for this field blueprint on a model.
	 */
	getDbSchemaFor(model: ModelMetadata, fieldName: string): DbSchemaPart {
		return this.getDbSchema({
			model,
			fieldName,
		});
	}

	/**
	 * Returns the DomStudio component spec for rendering this field in a form.
	 */
	getFormComponent(
		options: FieldRenderOptions = {},
		ctx?: FieldContext,
	): FrontendComponentSpec {
		return this.withContext(ctx, () => ({
			component: this.config.frontend?.component || this.defaultFormComponent(),
			props: {
				...this.defaultFormComponentProps(options),
				...(this.config.frontend?.props ?? {}),
			},
		}));
	}

	/**
	 * Returns the DomStudio component spec for rendering this field as a search filter.
	 */
	getSearchFilterComponent(
		options: FieldRenderOptions = {},
		ctx?: FieldContext,
	): FrontendComponentSpec | null {
		return this.withContext(ctx, () => {
			const component = this.config.frontend?.searchComponent || this.defaultSearchFilterComponent();

			if (!component) return null;

			return {
				component,
				props: {
					...this.defaultSearchFilterComponentProps(options),
					...(this.config.frontend?.searchProps ?? {}),
				},
			};
		});
	}

	/**
	 * Returns a form component spec for an unbound model field.
	 */
	getFormComponentFor(
		model: ModelMetadata,
		fieldName: string,
		options: FieldRenderOptions = {},
	): FrontendComponentSpec {
		return this.getFormComponent(options, {
			model,
			fieldName,
		});
	}

	/**
	 * Returns a search component spec for an unbound model field.
	 */
	getSearchFilterComponentFor(
		model: ModelMetadata,
		fieldName: string,
		options: FieldRenderOptions = {},
	): FrontendComponentSpec | null {
		return this.getSearchFilterComponent(options, {
			model,
			fieldName,
		});
	}

	/**
	 * Returns the primary database column for this field.
	 *
	 * Compound fields may still return additional columns from `getDataForDb()`.
	 */
	getColumn(ctx?: FieldContext): string {
		return this.withContext(ctx, () => this.config.column ?? this.fieldName);
	}

	/**
	 * Creates per-record runtime state for this field.
	 */
	createState(ctx?: FieldContext): TState {
		return this.withContext(ctx, () => {
			const value = this.getDefaultValue();

			return {
				value,
				originalValue: snapshotFieldValue(value),
				dirty: false,
				errors: [],
			} as unknown as TState;
		});
	}

	/**
	 * Handles app-level assignment, e.g. `user.email = 'x@example.com'`.
	 *
	 * Keep this mostly synchronous. Async work such as hashing should usually
	 * happen in `getDataForDb()` during save.
	 */
	setValue(state: TState, input: TInput, ctx?: FieldContext): void {
		return this.withContext(ctx, () => {
			const value = this.parse(input);

			(state as any).value = value;
			(state as any).dirty = true;
		});
	}

	/**
	 * Handles app-level property reads, e.g. `user.email`.
	 */
	getValue(state: TState, ctx?: FieldContext): TValue {
		return (state as any).value;
	}

	/**
	 * Hydrates field state from a raw database row.
	 */
	setFromDb(state: TState, row: DbRow, ctx?: FieldContext): void {
		return this.withContext(ctx, () => {
			const hasColumn = Object.prototype.hasOwnProperty.call(row, this.column);
			const dbValue = hasColumn ? row[this.column] as TDbValue : undefined;
			const value = hasColumn
				? dbValue === null || dbValue === undefined
					? this.config.default === undefined
						? this.fromDbValue(dbValue as TDbValue)
						: this.getDefaultValue()
					: this.fromDbValue(dbValue)
				: this.getDefaultValue();

			(state as any).value = value;
			(state as any).originalValue = snapshotFieldValue(value);
			(state as any).dirty = false;
			state.errors = [];
		});
	}

	/**
	 * Validates the field and stores the resulting errors on the field state.
	 */
	async validate(state: TState, ctx?: FieldContext): Promise<FieldError[]> {
		return this.withContext(ctx, async () => {
			state.errors = [];

			const errors = await this.collectErrors(state);
			state.errors.push(...errors);

			return state.errors;
		});
	}

	/**
	 * Returns current validation errors for this field state.
	 */
	getErrors(state: TState): FieldError[] {
		return state.errors;
	}

	/**
	 * Returns true if this field state currently has validation errors.
	 */
	hasErrors(state: TState): boolean {
		return state.errors.length > 0;
	}

	/**
	 * Returns true if the field has changed since hydration/default creation.
	 */
	isDirty(state: TState): boolean {
		return (
			Boolean((state as any).dirty)
			|| !isDeepStrictEqual(
				(state as any).value,
				(state as any).originalValue,
			)
		);
	}

	/**
	 * Marks the state as clean after a successful save or hydration.
	 */
	markClean(state: TState): void {
		(state as any).originalValue = snapshotFieldValue((state as any).value);
		(state as any).dirty = false;
		state.errors = [];
	}

	/**
	 * Returns database write data for this field.
	 *
	 * The default implementation maps one field to one column.
	 */
	getDataForDb(
		state: TState,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	getDataForDb(
		state: TState,
		ctx: FieldContext,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	async getDataForDb(
		state: TState,
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): Promise<DbWriteData> {
		const args = this.resolveDbWriteArgs(ctxOrOptions, options);

		return this.withContext(args.ctx, async () => {
			if (this.config.generated && this.isEmpty((state as any).value)) {
				return {};
			}

			if (args.options.onlyDirty && !this.isDirty(state)) {
				return {};
			}

			const value = this.toDbValue((state as any).value, args.options.valueOptions);

			return {
				[this.column]: value,
			};
		});
	}

	/**
	 * Returns a frontend/form/API-safe value for this field.
	 */
	getDisplayValue(state: TState, ctx?: FieldContext): TDisplayValue | undefined {
		return this.withContext(ctx, () => {
			if (this.config.hidden) {
				return undefined;
			}

			const value = this.getValue(state);

			if (this.isEmpty(value) && this.config.default !== undefined) {
				return this.toDisplayValue(this.getDefaultValue());
			}

			return this.toDisplayValue(value);
		});
	}

	/**
	 * Alias used by JSON transport. Framework docs call this display data.
	 */
	getJsonValue(state: TState, ctx?: FieldContext): TDisplayValue | undefined {
		return this.getDisplayValue(state, ctx);
	}

	/**
	 * Converts an input query value into its database representation.
	 *
	 * Query builder methods call this so `where('email', 'STEVE@EXAMPLE.COM')`
	 * can compare against the normalized database value.
	 */
	getQueryValue(input: TInput, ctx?: FieldContext): unknown {
		return this.withContext(ctx, () => this.toDbValue(this.parse(input)));
	}

	/**
	 * Returns database schema metadata for dev sync and diff tooling.
	 *
	 * When `ctx.table` is present the field also writes its column(s) onto that
	 * Knex builder using the dialect-owned SQL type string.
	 */
	getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			return this.completeDbSchema({
				columns: [
					{
						name: this.column,
						type: this.schemaDialect().columnTypes.text(),
						nullable: !this.config.required && !this.config.primary,
						primary: this.config.primary,
						unique: this.config.unique,
					},
				],
				indexes: fieldSchemaIndexes(this.column, this.config),
			}, ctx);
		});
	}

	/**
	 * Returns request/input validation rules for this field.
	 */
	getValidationRules(ctx?: FieldContext): ValidationRule[] {
		return this.withContext(ctx, () => [
			this.config.required || this.config.primary ? 'required' : 'nullable',
		]);
	}

	/**
	 * Parses app/input assignment into the field's app-memory value.
	 */
	protected parse(input: TInput): TValue {
		return input as unknown as TValue;
	}

	/**
	 * Default form component for this field type.
	 */
	protected defaultFormComponent(): string {
		return 'DomTextInput';
	}

	/**
	 * Default form props derived from FieldType config.
	 */
	protected defaultFormComponentProps(_options: FieldRenderOptions): Record<string, unknown> {
		return {
			name: this.fieldName,
			label: this.fieldLabel(),
			required: Boolean(this.config.required),
			readOnly: Boolean(this.config.primary || this.config.generated),
		};
	}

	/**
	 * Default search component for this field type.
	 */
	protected defaultSearchFilterComponent(): string | null {
		return 'DomTextInput';
	}

	/**
	 * Default search props derived from FieldType config.
	 */
	protected defaultSearchFilterComponentProps(_options: FieldRenderOptions): Record<string, unknown> {
		return {
			name: this.fieldName,
			label: this.fieldLabel(),
		};
	}

	protected fieldLabel(): string {
		return typeof this.config.label === 'string' && this.config.label.trim()
			? this.config.label.trim()
			: startCase(this.fieldName);
	}

	/**
	 * Converts a raw database value into app memory.
	 */
	protected fromDbValue(input: TDbValue): TValue {
		return input as unknown as TValue;
	}

	/**
	 * Converts an app-memory value into database storage form.
	 */
	protected toDbValue(input: TValue, _options?: DatabaseValueOptions): TDbValue {
		return input as unknown as TDbValue;
	}

	/**
	 * Converts a hydrated backend value into frontend/form display data.
	 */
	protected toDisplayValue(input: TValue): TDisplayValue {
		return input as unknown as TDisplayValue;
	}

	/**
	 * Collects validation errors for this field state.
	 *
	 * Concrete fields should call `super.collectErrors()` then append their own
	 * errors.
	 */
	protected async collectErrors(state: TState): Promise<FieldError[]> {
		const value = (state as any).value;

		if (this.config.required && this.isEmpty(value)) {
			return [
				{
					field: this.fieldName,
					message: `${this.fieldName} is required`,
					code: 'required',
					value,
				},
			];
		}

		return [];
	}

	/**
	 * Tests whether a value should count as empty for required validation.
	 */
	protected isEmpty(value: unknown): boolean {
		return value === null || value === undefined || value === '';
	}

	/**
	 * Returns the database schema default implied by the runtime field default.
	 */
	protected getDbDefaultValue(): unknown {
		if (this.config.default === undefined) {
			return undefined;
		}

		if (typeof this.config.default === 'function') {
			return undefined;
		}

		return this.toDbValue(this.config.default as TValue);
	}

	/**
	 * Context for this bound field.
	 */
	protected get context(): FieldContext {
		if (this.$activeContext) {
			return {
				...this.$activeContext,
				record: this.$activeContext.record ?? this.$record,
			};
		}

		return {
			model: this.requireModel(),
			record: this.$record,
			fieldName: this.requireFieldName(),
		};
	}

	/**
	 * Dialect for schema generation, falling back to the configured connection.
	 */
	protected schemaDialect(): DatabaseDialect {
		return this.context.dialect ?? resolveDatabaseDialect();
	}

	/**
	 * Returns schema metadata and optionally writes columns onto `ctx.table`.
	 */
	protected completeDbSchema(part: DbSchemaPart, ctx?: FieldContext): DbSchemaPart {
		if (ctx?.table) {
			for (const column of part.columns ?? []) {
				writeDbColumn(ctx.table, column, ctx.columnWriteOptions);
			}
		}

		return part;
	}

	/**
	 * State for this bound field.
	 */
	protected get state(): TState {
		if (!this.$state) {
			throw new Error('Field is not bound to a record.');
		}

		return this.$state;
	}

	/**
	 * Attaches this field instance to a model without creating record state.
	 */
	bindToModel(
		model: ModelMetadata,
		fieldName: string,
	): this {
		this.$model = model;
		this.$fieldName = fieldName;

		return this;
	}

	/**
	 * Returns an unbound copy of this field definition.
	 */
	clone(): this {
		const Field = this.constructor as FieldClass<this>;

		return new Field(this.config);
	}

	/**
	 * Returns a cloned field definition with config overrides applied.
	 */
	withConfig(config: Partial<FieldConfig>): this {
		const Field = this.constructor as FieldClass<this>;

		return new Field({
			...this.config,
			...config,
		});
	}

	/**
	 * Attaches this field instance to a concrete ActiveRecord instance.
	 */
	bindToRecord(
		record: unknown,
		fieldName: string,
	): this;
	bindToRecord(
		model: ModelMetadata,
		record: unknown,
		fieldName: string,
	): this;
	bindToRecord(
		modelOrRecord: ModelMetadata | unknown,
		recordOrFieldName: unknown,
		fieldName?: string,
	): this {
		const hasExplicitModel = typeof fieldName === 'string';
		const resolvedModel = hasExplicitModel
			? modelOrRecord as ModelMetadata
			: this.modelFromRecord(modelOrRecord);
		const resolvedRecord = hasExplicitModel ? recordOrFieldName : modelOrRecord;
		const resolvedFieldName = hasExplicitModel
			? fieldName
			: recordOrFieldName as string;

		this.bindToModel(resolvedModel, resolvedFieldName);
		this.$record = resolvedRecord;
		this.$state = this.createState();

		return this;
	}

	protected resolveDbWriteArgs(
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): { ctx?: FieldContext; options: DbWriteOptions } {
		if (options) {
			return {
				ctx: ctxOrOptions as FieldContext,
				options,
			};
		}

		return {
			options: ctxOrOptions as DbWriteOptions,
		};
	}

	/**
	 * We are trying to deprecate this function in favour of using object functions like this.get 
	 * @param ctx @deprecated this.schemaDialect()
	 * @returns 
	 */
	protected withContext<TResult>(
		ctx: FieldContext | undefined,
		callback: () => TResult,
	): TResult {
		if (!ctx) {
			return callback();
		}

		const previousContext = this.$activeContext;

		this.$activeContext = ctx;

		try {
			const result = callback();

			if (isFinallyPromise(result)) {
				return result.finally(() => {
					this.$activeContext = previousContext;
				}) as TResult;
			}

			this.$activeContext = previousContext;
			return result;
		} catch (error) {
			this.$activeContext = previousContext;
			throw error;
		}
	}

	private modelFromRecord(record: unknown): ModelMetadata {
		const Model = (record as { constructor?: unknown })?.constructor as
			| ModelMetadata
			| undefined;

		if (!Model?.table || !Model.primaryKey) {
			throw new Error('Field record is not backed by an ActiveRecord model.');
		}

		return Model;
	}

	private requireModel(): ModelMetadata {
		if (!this.$model) {
			throw new Error('Field is not bound to a model.');
		}

		return this.$model;
	}

	private requireFieldName(): string {
		if (!this.$fieldName) {
			throw new Error('Field is not bound to a record.');
		}

		return this.$fieldName;
	}

	/**
	 * Resolves the configured default value.
	 */
	private getDefaultValue(): TValue {
		if (typeof this.config.default === 'function') {
			return (this.config.default as () => unknown)() as TValue;
		}

		return (this.config.default ?? null) as TValue;
	}
}

export type FieldValue<TField> =
	TField extends FieldType<infer TValue, any, any, any, any>
		? TValue
		: never;

export type FieldDbValue<TField> =
	TField extends FieldType<any, infer TDbValue, any, any, any>
		? TDbValue
		: never;

export type FieldDisplayValue<TField> =
	TField extends FieldType<any, any, infer TDisplayValue, any, any>
		? TDisplayValue
		: never;

export type FieldInputValue<TField> =
	TField extends FieldType<any, any, any, infer TInput, any>
		? TInput
		: never;
