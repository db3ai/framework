import {
	FieldInput,
	FieldType,
} from '../FieldType';

export function createField<TField extends FieldType<any, any, any, any, any>>(
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
