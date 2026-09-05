import type { ActiveRecordClass } from './ActiveRecord';
import type {
	DbWriteData,
	FieldType,
} from './FieldType';

export type ActiveRecordSoftDeleteConfig = boolean | string;

export type ActiveRecordSoftDeleteScope = 'without' | 'with' | 'only';

export interface ActiveRecordSoftDeleteField {
	fieldName: string;
	field: FieldType<any, any, any, any, any>;
	column: string;
}

export const DEFAULT_SOFT_DELETE_FIELD = 'deletedAt';

/**
 * Returns true when the model has soft deletes enabled.
 */
export function modelUsesSoftDeletes(Model: ActiveRecordClass): boolean {
	return resolveSoftDeleteFieldName(Model) !== null;
}

/**
 * Returns the configured soft-delete timestamp field for a model, when enabled.
 */
export function getSoftDeleteField(
	Model: ActiveRecordClass,
): ActiveRecordSoftDeleteField | null {
	const fieldName = resolveSoftDeleteFieldName(Model);

	if (!fieldName) {
		return null;
	}

	const field = Model.getFields()[fieldName];

	if (!field) {
		throw new Error(
			`Model ${Model.name} enables soft deletes with field "${fieldName}", but that field is not defined.`,
		);
	}

	return {
		fieldName,
		field,
		column: field.column,
	};
}

/**
 * Returns the configured soft-delete field or throws when the model is not soft deletable.
 */
export function requireSoftDeleteField(
	Model: ActiveRecordClass,
): ActiveRecordSoftDeleteField {
	const softDeleteField = getSoftDeleteField(Model);

	if (!softDeleteField) {
		throw new Error(`Model ${Model.name} does not use soft deletes.`);
	}

	return softDeleteField;
}

/**
 * Builds field-aware update data for soft delete or restore operations.
 */
export function getSoftDeleteWriteData(
	Model: ActiveRecordClass,
	deletedAt: Date | null,
	updatedAt = new Date(),
): DbWriteData {
	const softDeleteField = requireSoftDeleteField(Model);
	const ignoredFieldNames = new Set([softDeleteField.fieldName]);

	return {
		[softDeleteField.column]: softDeleteField.field.getQueryValue(deletedAt as any),
		...getAutomaticUpdateTimestampWriteData(
			Model,
			updatedAt,
			ignoredFieldNames,
		),
	};
}

/**
 * Returns logical timestamp field names that should update on row updates.
 */
export function getAutomaticUpdateTimestampFieldNames(
	Model: ActiveRecordClass,
	ignoredFieldNames: ReadonlySet<string> = new Set(),
): string[] {
	return Object.entries(Model.getFields())
		.flatMap(([fieldName, field]) => {
			if (ignoredFieldNames.has(fieldName)) return [];
			if (!isAutomaticUpdateTimestampField(field)) return [];

			return [fieldName];
		});
}

/**
 * Builds update timestamp columns for soft delete and restore writes.
 */
function getAutomaticUpdateTimestampWriteData(
	Model: ActiveRecordClass,
	updatedAt: Date,
	ignoredFieldNames: ReadonlySet<string>,
): DbWriteData {
	const row: DbWriteData = {};

	for (const fieldName of getAutomaticUpdateTimestampFieldNames(Model, ignoredFieldNames)) {
		const field = Model.getField(fieldName);

		row[field.column] = field.getQueryValue(updatedAt as any);
	}

	return row;
}

/**
 * Resolves the model's soft-delete config to a logical timestamp field name.
 */
function resolveSoftDeleteFieldName(Model: ActiveRecordClass): string | null {
	const config = Model.softDeletes;

	if (!config) {
		return null;
	}

	if (config === true) {
		return DEFAULT_SOFT_DELETE_FIELD;
	}

	if (typeof config === 'string' && config.trim()) {
		return config.trim();
	}

	throw new Error(
		`Model ${Model.name} has an invalid soft delete configuration.`,
	);
}

/**
 * Returns true when a field should receive update timestamps automatically.
 */
function isAutomaticUpdateTimestampField(
	field: FieldType<any, any, any, any, any>,
): boolean {
	const config = field.config as {
		auto?: unknown;
	};

	return config.auto === 'update' || config.auto === 'both';
}
