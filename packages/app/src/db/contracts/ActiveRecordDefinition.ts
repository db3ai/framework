import type { ActiveRecord, ActiveRecordOptions } from '../ActiveRecord';
import type { FieldInputMap, FieldInputValue, FieldValue } from '../FieldType';
import type { FieldBuilder } from '../fields/field';

/** A model constructor whose fields can be extended by `ActiveRecord.define()`. */
export type ActiveRecordDefinitionBase = (abstract new (input?: Record<string, unknown>, options?: ActiveRecordOptions) => ActiveRecord) & {
	/** Existing field factory, including definitions inherited by the model. */
	fields(field: FieldBuilder): FieldInputMap;
};

/** Field definitions known statically; a dynamic base contributes no inferred keys. */
export type ActiveRecordDefinedFields<TBase extends ActiveRecordDefinitionBase> =
	string extends keyof ReturnType<TBase['fields']> ? {} : ReturnType<TBase['fields']>;

/** Complete field map after a definition replaces matching inherited fields. */
export type ActiveRecordMergedFields<TBase extends ActiveRecordDefinitionBase, TFields extends FieldInputMap> =
	Omit<ActiveRecordDefinedFields<TBase>, keyof TFields> & TFields;

/**
 * Schema options for an inferred model. Omitted settings inherit from the base.
 * Fields use the same builder, field classes and configured definitions as
 * ordinary static `fields()` declarations.
 */
export interface ActiveRecordDefinition<TFields extends FieldInputMap> {
	table?: string;
	primaryKey?: string;
	comment?: string;
	labelFields?: string[];
	requestFillable?: readonly string[];
	requestGuarded?: readonly string[];
	returning?: boolean;
	softDeletes?: typeof ActiveRecord.softDeletes;
	/** Supplies this layer's fields; inherited names replace the whole definition. */
	fields(field: FieldBuilder): TFields;
}

/**
 * Rejects overrides that change application or input types, and fields that
 * collide with existing non-field members. Inherited methods can therefore
 * continue to use the properties they were written against.
 */
export type ActiveRecordFieldOverrides<TBase extends ActiveRecordDefinitionBase, TFields extends FieldInputMap> = {
	[TKey in keyof TFields]: [ActiveRecord.ResolvedField<TFields[TKey]>] extends [never]
		? never
		: TKey extends keyof ActiveRecordDefinedFields<TBase>
		? SameFieldBoundary<TFields[TKey], ActiveRecordDefinedFields<TBase>[TKey]>
		: TKey extends keyof InstanceType<TBase> ? never : TFields[TKey];
};

/** Compares both directions because inherited methods may read and write values. */
type SameFieldBoundary<TField, TParent> =
	[FieldValue<ActiveRecord.ResolvedField<TField>>, FieldInputValue<ActiveRecord.ResolvedField<TField>>] extends
	[FieldValue<ActiveRecord.ResolvedField<TParent>>, FieldInputValue<ActiveRecord.ResolvedField<TParent>>]
		? [FieldValue<ActiveRecord.ResolvedField<TParent>>, FieldInputValue<ActiveRecord.ResolvedField<TParent>>] extends
		[FieldValue<ActiveRecord.ResolvedField<TField>>, FieldInputValue<ActiveRecord.ResolvedField<TField>>] ? TField : never
		: never;

/**
 * Inferred subclass with the original static methods and a single constructor
 * signature. Keeping statics generic in their receiver preserves later ordinary
 * subclasses, their custom methods, and further calls to `define()`.
 */
export type DefinedActiveRecord<TBase extends ActiveRecordDefinitionBase, TFields extends FieldInputMap> =
	Omit<TBase, 'prototype' | 'fields'> & {
		/** Creates a record in memory; persistence still requires `save()`. */
		new(input?: Partial<ActiveRecord.InferInput<{ fields: (field: FieldBuilder) => ActiveRecordMergedFields<TBase, TFields> }>>, options?: ActiveRecordOptions): InstanceType<TBase> & ActiveRecord.InferValue<{ fields: (field: FieldBuilder) => ActiveRecordMergedFields<TBase, TFields> }>;
		/** Preserves concrete field types for inference and future bound-field APIs. */
		fields(field: FieldBuilder): ActiveRecordMergedFields<TBase, TFields>;
	};
