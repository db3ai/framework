/**
 * Stable marker identifying framework serializer payloads.
 */
export const SERIALIZED_VALUE_FORMAT = 'platform.serialized-object' as const;

/**
 * Current framework serializer wire-format version.
 */
export const SERIALIZED_VALUE_VERSION = 1 as const;

/**
 * Reserved object key used only for framework-owned serialized references.
 *
 * Application constructor state cannot use this key because it would be
 * ambiguous with framework metadata during restoration.
 */
export const SERIALIZED_REFERENCE_KEY = '$platform' as const;

/**
 * Marker value identifying one serialized ActiveRecord reference.
 */
export const SERIALIZED_ACTIVE_RECORD_TYPE = 'active-record' as const;

/**
 * Primitive values supported by ordinary JSON without coercion.
 */
export type SerializedPrimitive = null | string | boolean | number;

/**
 * Registered ActiveRecord identity stored inside otherwise ordinary JSON.
 */
export interface SerializedActiveRecordReference {
	/** Reserved framework reference discriminator. */
	[SERIALIZED_REFERENCE_KEY]: typeof SERIALIZED_ACTIVE_RECORD_TYPE;
	/** Stable application-registered model key. */
	model: string;
	/** JSON-safe logical primary-key value. */
	id: string | number;
}

/**
 * Plain serialized object containing application-owned constructor state.
 */
export interface SerializedObject {
	[key: string]: SerializedValue;
}

/**
 * JSON value supported inside serialized constructor state.
 *
 * ActiveRecord references are the only framework-specific extension.
 */
export type SerializedValue =
	| SerializedPrimitive
	| SerializedValue[]
	| SerializedObject
	| SerializedActiveRecordReference;

/**
 * Versioned root-class envelope produced by `Serializer.serialize()`.
 */
export interface SerializedValueEnvelope extends Record<string, unknown> {
	/** Stable framework serializer format marker. */
	format: typeof SERIALIZED_VALUE_FORMAT;
	/** Wire-format version used to interpret the constructor state. */
	version: typeof SERIALIZED_VALUE_VERSION;
	/** Stable registry key for the root application class. */
	name: string;
	/** Serialized constructor state for the registered root class. */
	state: SerializedValue;
}
