import {
	DbRow,
	FieldConfig,
	type FieldClass,
	type FieldDbValue,
	type FieldDefinition,
	type FieldDisplayValue,
	type FieldInputMap,
	type FieldInputValue,
	type FieldMap,
	FieldType,
	type FieldValue,
} from './FieldType';
import type {
	ActiveRecordClass,
} from './ActiveRecord';
import {
	field,
	type FieldBuilder,
} from './fields/field';

export interface ProjectionSourceFieldOptions {
	/** Row key used when a query aliases the source column. */
	alias?: string;

	/** Explicit row key. Defaults to `alias`, then the source field's DB column. */
	column?: string;

	/** Projection-only default used when the row omits the projected column. */
	default?: FieldConfig['default'];
}

export interface ProjectionFromModelOptions {
	/** Optional logical fields to include from the source model. Defaults to all fields. */
	fields?: readonly string[];

	/** Optional logical fields to omit from the source model. */
	except?: readonly string[];

	/** Prefix for projected logical field names. */
	prefix?: string;

	/** Per-field aliases used by the query row. */
	aliases?: Record<string, string>;

	/** Per-field projection defaults. */
	defaults?: Record<string, FieldConfig['default']>;
}

export interface ProjectionFieldBuilder extends FieldBuilder {
	from<
		TModel extends { fields(field: FieldBuilder): FieldInputMap } & ActiveRecordClass,
		TFieldName extends keyof ModelFieldInputs<TModel> & string,
	>(
		Model: TModel,
		fieldName: TFieldName,
		options?: ProjectionSourceFieldOptions,
	): ResolvedFieldInput<ModelFieldInputs<TModel>[TFieldName]>;

	fromModel<TModel extends ActiveRecordClass>(
		Model: TModel,
		options?: ProjectionFromModelOptions,
	): FieldInputMap;
}

export type ActiveProjectionConstructor<TProjection extends ActiveProjection = ActiveProjection> = {
	new(row?: DbRow): TProjection;
};

export type ActiveProjectionClass<TProjection extends ActiveProjection = ActiveProjection> =
	ActiveProjectionConstructor<TProjection> & {
		readonly name: string;
		table: string;
		primaryKey: string;
		fields(field: ProjectionFieldBuilder): FieldInputMap;
		getFields(): FieldMap;
		fromDb<TClass extends ActiveProjectionConstructor>(
			this: TClass,
			row: DbRow,
		): InstanceType<TClass>;
		fromDbRows<TClass extends ActiveProjectionConstructor>(
			this: TClass,
			rows: readonly DbRow[],
		): InstanceType<TClass>[];
	};

const resolvedProjectionFields = new WeakMap<ActiveProjectionClass, FieldMap>();

export abstract class ActiveProjection {
	static table = 'projection';
	static primaryKey = 'id';

	static fields(_field: ProjectionFieldBuilder): FieldInputMap {
		return {};
	}

	private readonly $fields: Record<string, FieldType<any, any, any, any, any>> = {};

	constructor(row: DbRow = {}) {
		const Projection = this.$projection();

		for (const [fieldName, field] of Object.entries(Projection.getFields())) {
			const liveField = field.clone().bindToRecord(Projection, this, fieldName);

			this.$fields[fieldName] = liveField;
			this.$installAccessor(fieldName);
		}

		this.setFromDb(row);
	}

	static getFields<TProjection extends ActiveProjection>(
		this: ActiveProjectionClass<TProjection>,
	): FieldMap {
		const cached = resolvedProjectionFields.get(this);

		if (cached) {
			return cached;
		}

		const fields: FieldMap = {};

		for (const [fieldName, fieldInput] of Object.entries(this.fields(projectionField))) {
			fields[fieldName] = resolveProjectionFieldInput(fieldInput).bindToModel(
				this,
				fieldName,
			);
		}

		resolvedProjectionFields.set(this, fields);

		return fields;
	}

	static fromDb<TClass extends ActiveProjectionConstructor>(
		this: TClass,
		row: DbRow,
	): InstanceType<TClass> {
		return new this(row) as InstanceType<TClass>;
	}

	static fromDbRows<TClass extends ActiveProjectionConstructor>(
		this: TClass,
		rows: readonly DbRow[],
	): InstanceType<TClass>[] {
		return rows.map(row => new this(row) as InstanceType<TClass>);
	}

	setFromDb(row: DbRow): this {
		for (const field of Object.values(this.$fields)) {
			field.hydrate(row);
			field.markBoundClean();
		}

		return this;
	}

	get(fieldName: string): unknown {
		return this.$field(fieldName).value;
	}

	toAppData(): Record<string, unknown> {
		const data: Record<string, unknown> = {};

		for (const [fieldName, field] of Object.entries(this.$fields)) {
			if (field.config.hidden) continue;

			data[fieldName] = field.value;
		}

		return data;
	}

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

	toJSON(): Record<string, unknown> {
		return this.toDisplayData();
	}

	protected $field(fieldName: string): FieldType<any, any, any, any, any> {
		const field = this.$fields[fieldName];

		if (!field) {
			throw new Error(`Unknown projection field "${fieldName}"`);
		}

		return field;
	}

	private $projection<TProjection extends ActiveProjection>(): ActiveProjectionClass<TProjection> {
		return this.constructor as ActiveProjectionClass<TProjection>;
	}

	private $installAccessor(fieldName: string): void {
		if (Object.prototype.hasOwnProperty.call(this, fieldName)) {
			return;
		}

		Object.defineProperty(this, fieldName, {
			enumerable: true,
			configurable: true,

			get: () => this.get(fieldName),
		});
	}
}

export const projectionField: ProjectionFieldBuilder = {
	...field,

	from(Model, fieldName, options = {}) {
		const source = Model.getField(fieldName);
		const column = options.column
			?? options.alias
			?? source.getColumnFor(Model, fieldName);

		return source.withConfig({
			column,
			default: options.default ?? source.config.default,
		}) as ResolvedFieldInput<ModelFieldInputs<typeof Model>[typeof fieldName]>;
	},

	fromModel(Model, options = {}) {
		const fields: FieldInputMap = {};
		const included = options.fields ? new Set(options.fields) : null;
		const excluded = new Set(options.except ?? []);

		for (const fieldName of Object.keys(Model.getFields())) {
			if (included && !included.has(fieldName)) continue;
			if (excluded.has(fieldName)) continue;

			const projectedName = options.prefix
				? `${options.prefix}${fieldName.slice(0, 1).toUpperCase()}${fieldName.slice(1)}`
				: fieldName;

			fields[projectedName] = projectionField.from(Model, fieldName, {
				alias: options.aliases?.[fieldName],
				default: options.defaults?.[fieldName],
			});
		}

		return fields;
	},
};

function resolveProjectionFieldInput<TField extends FieldType<any, any, any, any, any>>(
	input: FieldClass<TField> | FieldDefinition<TField> | TField,
): TField {
	if (typeof input === 'function') {
		return new input();
	}

	if (input instanceof FieldType) {
		return input.clone() as TField;
	}

	if (input && typeof input === 'object' && 'type' in input) {
		return new input.type(input.config);
	}

	throw new Error('Invalid projection field definition.');
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

type ProjectionFieldInputs<TProjection extends { fields(field: ProjectionFieldBuilder): FieldInputMap }> =
	ReturnType<TProjection['fields']>;

export namespace ActiveProjection {
	export type InferInput<TProjection extends { fields(field: ProjectionFieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ProjectionFieldInputs<TProjection>]:
			FieldInputValue<ResolvedFieldInput<ProjectionFieldInputs<TProjection>[fieldName]>>;
	};

	export type InferValue<TProjection extends { fields(field: ProjectionFieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ProjectionFieldInputs<TProjection>]:
			FieldValue<ResolvedFieldInput<ProjectionFieldInputs<TProjection>[fieldName]>>;
	};

	export type InferDbRow<TProjection extends { fields(field: ProjectionFieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ProjectionFieldInputs<TProjection>]:
			FieldDbValue<ResolvedFieldInput<ProjectionFieldInputs<TProjection>[fieldName]>>;
	};

	export type InferDisplay<TProjection extends { fields(field: ProjectionFieldBuilder): FieldInputMap }> = {
		[fieldName in keyof ProjectionFieldInputs<TProjection>]:
			FieldDisplayValue<ResolvedFieldInput<ProjectionFieldInputs<TProjection>[fieldName]>>;
	};
}
