import type { Knex } from 'knex';
import type { ActiveRecord, ActiveRecordClass } from '../ActiveRecord';
import {
	DbRow,
	DbSchemaPart,
	DbWriteData,
	DbWriteOptions,
	FieldConfig,
	FieldContext,
	FieldError,
	FieldRenderOptions,
	FieldType,
	fieldSchemaIndexes,
} from '../FieldType';
import { RecordNotFoundError } from '../errors';

/**
 * Lightweight reference to another ActiveRecord.
 *
 * A link field stores this instead of implicitly loading related records. This
 * avoids hidden N+1 queries while still giving a convenient `load()` method.
 */
export class EntityRef<TRecord extends ActiveRecord> {
	/**
	 * Returns the primary-key value from a nullable entity reference.
	 *
	 * @param ref - Entity reference to read.
	 * @param message - Error message when the reference or id is missing.
	 * @returns Primary-key value stored on the reference.
	 */
	static idOrFail<TRecord extends ActiveRecord>(
		ref: EntityRef<TRecord> | null | undefined,
		message = 'Entity reference id is required.',
	): unknown {
		if (!ref) throw new Error(message);

		return ref.idOrFail(message);
	}

	/**
	 * Returns the primary-key value from a nullable entity reference as a string.
	 *
	 * @param ref - Entity reference to read.
	 * @param message - Error message when the reference or id is missing.
	 * @returns Primary-key value converted to a string.
	 */
	static stringIdOrFail<TRecord extends ActiveRecord>(
		ref: EntityRef<TRecord> | null | undefined,
		message = 'Entity reference id is required.',
	): string {
		return String(EntityRef.idOrFail(ref, message));
	}

	constructor(
		/** Target model class. */
		public readonly target: () => ActiveRecordClass<TRecord>,

		/** Primary-key value of the target record. */
		public readonly id: unknown,

		/** Optional already-loaded record. */
		private loadedRecord?: TRecord | null,
	) { }

	/**
	 * Returns the primary-key value stored on this reference.
	 *
	 * @param message - Error message when the id is missing.
	 * @returns Primary-key value stored on the reference.
	 */
	idOrFail(message = 'Entity reference id is required.'): unknown {
		if (this.id === null || this.id === undefined) {
			throw new Error(message);
		}

		return this.id;
	}

	/**
	 * Returns the primary-key value stored on this reference as a string.
	 *
	 * @param message - Error message when the id is missing.
	 * @returns Primary-key value converted to a string.
	 */
	stringIdOrFail(message = 'Entity reference id is required.'): string {
		return String(this.idOrFail(message));
	}

	/**
	 * Returns true if the referenced record has already been loaded.
	 *
	 * @returns True when a loaded-record state is present.
	 */
	isLoaded(): boolean {
		return this.loadedRecord !== undefined;
	}

	/**
	 * Returns the loaded record if available, otherwise null.
	 *
	 * @returns Loaded record or null.
	 */
	getLoaded(): TRecord | null {
		return this.loadedRecord ?? null;
	}

	/**
	 * Explicitly loads the referenced record.
	 *
	 * @param db - Optional database connection/session.
	 * @returns Referenced record or null when it cannot be found.
	 */
	async load(db?: Knex): Promise<TRecord | null> {
		if (this.loadedRecord !== undefined) {
			return this.loadedRecord;
		}

		this.loadedRecord = await this.target().findByPk(this.id, db);
		return this.loadedRecord;
	}

	/**
	 * Explicitly loads the referenced record and fails when it cannot be found.
	 *
	 * @returns Referenced record.
	 */
	async loadOrFail(): Promise<TRecord> {
		const record = await this.load();

		if (!record) {
			throw new RecordNotFoundError(this.target().name, this.id);
		}

		return record;
	}
}

/**
 * Per-record state for a link field.
 */
export interface LinkFieldState<TRecord extends ActiveRecord = ActiveRecord> {
	/** Referenced primary-key value. */
	id: unknown | null;

	/** Optional already-loaded record. */
	loadedRecord: TRecord | null;

	/** Whether the optional related record was explicitly loaded. */
	loaded: boolean;

	/** Whether JSON/display output should include the loaded record. */
	displayLoaded: boolean;

	/** Whether the link changed since hydration. */
	dirty: boolean;

	/** Validation errors for this field state. */
	errors: FieldError[];
}

/**
 * Configuration for link/foreign-key fields.
 */
export interface LinkFieldConfig<TRecord extends ActiveRecord> extends FieldConfig {
	/** Target model class. Wrapped in a function to allow circular model refs. */
	target: () => ActiveRecordClass<TRecord>;

	/** Name of the local FK column. Defaults to `${fieldName}_id`. */
	column?: string;

	/** Optional ON DELETE action for schema generation. */
	onDelete?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';

	/** Optional ON UPDATE action for schema generation. */
	onUpdate?: 'CASCADE' | 'RESTRICT' | 'SET NULL' | 'NO ACTION';
}

/**
 * Link/foreign-key field.
 *
 * App-facing values accepted by `setValue()`:
 * - an ID value
 * - an ActiveRecord-like object with the target primary-key property
 * - an `EntityRef`
 *
 * Normal reads return an `EntityRef`, not the loaded record. Loading is explicit:
 *
 * ```ts
 * const author = await post.author.load();
 * ```
 */
export class LinkField<TRecord extends ActiveRecord> extends FieldType<
	EntityRef<TRecord> | null,
	unknown | null,
	unknown | null,
	unknown,
	LinkFieldState<TRecord>
> {
	constructor(public override readonly config: LinkFieldConfig<TRecord>) {
		super(config);
	}

	/**
	 * Creates link-specific per-record state.
	 */
	override createState(): LinkFieldState<TRecord> {
		return {
			id: null,
			loadedRecord: null,
			loaded: false,
			displayLoaded: false,
			dirty: false,
			errors: [],
		};
	}

	/**
	 * Default FK column convention: `author` -> `author_id`.
	 */
	override getColumn(ctx?: FieldContext): string {
		return this.withContext(ctx, () => {
			return this.config.column ?? `${this.fieldName}_id`;
		});
	}

	protected override defaultFormComponent(): string {
		return 'DomSelect';
	}

	protected override defaultSearchFilterComponent(): string | null {
		return 'DomSelect';
	}

	protected override defaultFormComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		return {
			...super.defaultFormComponentProps(options),
			options: [],
		};
	}

	protected override defaultSearchFilterComponentProps(options: FieldRenderOptions): Record<string, unknown> {
		return {
			...super.defaultSearchFilterComponentProps(options),
			options: [],
		};
	}

	/**
	 * Stores the referenced primary-key value and optional loaded record.
	 */
	override setValue(
		state: LinkFieldState<TRecord>,
		input: unknown,
		ctx?: FieldContext,
	): void {
		return this.withContext(ctx, () => {
			if (input === null || input === undefined || input === '') {
				state.id = null;
				state.loadedRecord = null;
				state.loaded = false;
				state.displayLoaded = false;
				state.dirty = true;
				return;
			}

			if (input instanceof EntityRef) {
				state.id = input.id;
				state.loadedRecord = input.getLoaded() as TRecord | null;
				state.loaded = input.isLoaded();
				state.displayLoaded = false;
				state.dirty = true;
				return;
			}

			if (typeof input === 'object') {
				const Target = this.config.target();
				const id = (input as any)[Target.primaryKey];

				if (id !== undefined && id !== null) {
					state.id = id;
					state.loadedRecord = input as TRecord;
					state.loaded = true;
					state.displayLoaded = false;
					state.dirty = true;
					return;
				}
			}

			state.id = input;
			state.loadedRecord = null;
			state.loaded = false;
			state.displayLoaded = false;
			state.dirty = true;
		});
	}

	/**
	 * Returns a lightweight reference object for app reads.
	 */
	override getValue(
		state: LinkFieldState<TRecord>,
		ctx?: FieldContext,
	): EntityRef<TRecord> | null {
		return this.withContext(ctx, () => {
			if (state.id === null || state.id === undefined) {
				return null;
			}

			return new EntityRef<TRecord>(
				this.config.target,
				state.id,
				state.loaded ? state.loadedRecord : undefined,
			);
		});
	}

	/**
	 * Hydrates the FK value from the database row.
	 */
	override setFromDb(
		state: LinkFieldState<TRecord>,
		row: DbRow,
		ctx?: FieldContext,
	): void {
		return this.withContext(ctx, () => {
			state.id = row[this.column] ?? null;
			state.loadedRecord = null;
			state.loaded = false;
			state.displayLoaded = false;
			state.dirty = false;
			state.errors = [];
		});
	}

	/**
	 * Validates required link fields.
	 */
	override async validate(
		state: LinkFieldState<TRecord>,
		ctx?: FieldContext,
	): Promise<FieldError[]> {
		return this.withContext(ctx, async () => {
			state.errors = [];

			if (this.config.required && (state.id === null || state.id === undefined)) {
				state.errors.push({
					field: this.fieldName,
					message: `${this.fieldName} is required`,
					code: 'required',
				});
			}

			return state.errors;
		});
	}

	/**
	 * Returns FK database data.
	 */
	override getDataForDb(
		state: LinkFieldState<TRecord>,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override getDataForDb(
		state: LinkFieldState<TRecord>,
		ctx: FieldContext,
		options: DbWriteOptions,
	): Promise<DbWriteData>;
	override async getDataForDb(
		state: LinkFieldState<TRecord>,
		ctxOrOptions: FieldContext | DbWriteOptions,
		options?: DbWriteOptions,
	): Promise<DbWriteData> {
		const args = this.resolveDbWriteArgs(ctxOrOptions, options);

		return this.withContext(args.ctx, async () => {
			if (args.options.onlyDirty && !state.dirty) {
				return {};
			}

			return {
				[this.column]: state.id,
			};
		});
	}

	/**
	 * Marks the FK as clean after save.
	 */
	override markClean(state: LinkFieldState<TRecord>): void {
		state.dirty = false;
		state.errors = [];
	}

	/**
	 * Stores a loaded relation for JSON/display output without dirtying the FK.
	 */
	setBoundLoadedRecord(record: TRecord | null): void {
		this.state.loadedRecord = record;
		this.state.loaded = true;
		this.state.displayLoaded = true;
	}

	/**
	 * Serialises link fields as IDs unless the relation was explicitly included.
	 */
	override getDisplayValue(state: LinkFieldState<TRecord>): unknown {
		if (this.config.hidden) {
			return undefined;
		}

		if (state.displayLoaded) {
			return state.loadedRecord?.toJSON() ?? null;
		}

		return state.id;
	}

	/**
	 * Converts query input to a FK ID.
	 */
	override getQueryValue(input: unknown): unknown {
		if (input instanceof EntityRef) {
			return input.id;
		}

		if (input && typeof input === 'object') {
			const Target = this.config.target();
			const id = (input as any)[Target.primaryKey];

			if (id !== undefined && id !== null) {
				return id;
			}
		}

		return input;
	}

	/**
	 * Describes the FK column and foreign-key metadata.
	 */
	override getDbSchema(ctx?: FieldContext): DbSchemaPart {
		return this.withContext(ctx, () => {
			const dialect = this.schemaDialect();
			const Target = this.config.target();
			const targetPkField = Target.getField(Target.primaryKey);
			const column = this.getColumn(ctx);
			const targetColumn = targetPkField.getColumnFor(Target, Target.primaryKey);

			// Use the target PK schema as a rough type source. Most simple PK fields have
			// one column, which is enough for the initial dev-sync implementation.
			const targetColumnSpec = targetPkField.getDbSchemaFor(Target, Target.primaryKey).columns?.[0];

			return this.completeDbSchema({
				columns: [
					{
						name: column,
						type: foreignKeyColumnType(targetColumnSpec?.type, dialect.columnTypes.varchar(255)),
						nullable: !this.config.required,
						unique: this.config.unique,
					},
				],
				indexes: fieldSchemaIndexes(column, {
					...this.config,
					index: this.config.index ?? true,
				}),
				foreignKeys: [
					{
						column,
						referencesTable: Target.table,
						referencesColumn: targetColumn,
						onDelete: this.config.onDelete,
						onUpdate: this.config.onUpdate,
					},
				],
			}, ctx);
		});
	}
}

/**
 * Converts a target primary-key column type into a safe foreign-key column type.
 *
 * Generated primary keys such as MySQL `auto_increment` or PostgreSQL
 * `bigserial` cannot be copied directly onto a referencing column.
 *
 * @param targetType - Target primary-key column type.
 * @param fallback - Fallback column type when the target type is unavailable.
 * @returns Foreign-key-safe column type.
 */
function foreignKeyColumnType(
	targetType: string | undefined,
	fallback: string,
): string {
	const type = targetType ?? fallback;
	const normalizedType = type.trim();

	if (/^bigserial$/i.test(normalizedType)) return 'bigint';
	if (/^serial$/i.test(normalizedType)) return 'integer';

	return normalizedType.replace(/\s+auto_increment\b/ig, '');
}
