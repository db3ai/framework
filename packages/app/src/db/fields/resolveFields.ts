import type {
	FieldInput,
	FieldInputMap,
	FieldMap,
	ModelMetadata,
} from '../FieldType';
import { FieldType } from '../FieldType';
import {
	field,
	type FieldBuilder,
} from './field';

export interface FieldFactoryModel {
	fields(field: FieldBuilder): FieldInputMap;
}

const resolvedFieldsByModel = new WeakMap<FieldFactoryModel, FieldMap>();

/**
 * Resolves and returns a model's static field definitions as a FieldMap.
 *
 * - Invokes the model's `fields` static method with the framework field helper.
 * - Accepts a model class or object implementing `FieldFactoryModel` & `ModelMetadata`.
 * - Each field definition is normalized to a FieldType instance and bound to the model and its logical field name.
 * - Results are cached per-model for efficiency, using a WeakMap to avoid memory leaks.
 *
 * @param Model  A model class/object implementing field factory and metadata interfaces.
 * @returns      Resolved fields as a map: { [fieldName]: FieldType }
 */
export function resolveModelFields(
	Model: FieldFactoryModel & ModelMetadata,
): FieldMap {
	const cached = resolvedFieldsByModel.get(Model);

	if (cached) {
		return cached;
	}

	const fields: FieldMap = {};

	for (const [fieldName, fieldInput] of Object.entries(Model.fields(field))) {
		fields[fieldName] = resolveFieldInput(fieldInput).bindToModel(
			Model,
			fieldName,
		);
	}

	resolvedFieldsByModel.set(Model, fields);

	return fields;
}

function resolveFieldInput<TField extends FieldType<any, any, any, any, any>>(
	input: FieldInput<TField>,
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

	throw new Error('Invalid field definition.');
}
