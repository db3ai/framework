import { ActiveRecord, RecordNotFoundError } from '../db';
import type { Serializable } from './Serializable';
import { SerializationError, type SerializationOperation } from './SerializationError';
import { SerializationRegistry } from './SerializationRegistry';
import {
	SERIALIZED_ACTIVE_RECORD_TYPE,
	SERIALIZED_REFERENCE_KEY,
	SERIALIZED_VALUE_FORMAT,
	SERIALIZED_VALUE_VERSION,
	type SerializedActiveRecordReference,
	type SerializedObject,
	type SerializedPrimitive,
	type SerializedValue,
	type SerializedValueEnvelope,
} from './contracts';
import type * as serialization from './contracts';

const OBJECT_PATH_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

interface TraversalContext {
	readonly ancestors: Map<object, string>;
}

interface RestoreContext {
	readonly activeRecords: Map<string, Promise<ActiveRecord>>;
}

/**
 * Serializes one registered root constructor using JSON state plus model refs.
 *
 * @example
 * const payload = app().serializer.serialize(job);
 * const restored = await app().serializer.deserialize(
 * 	JSON.parse(JSON.stringify(payload)),
 * );
 */
export class Serializer implements serialization.SerializerService {
	readonly registry: SerializationRegistry;

	/**
	 * Creates an application-scoped serializer.
	 *
	 * @param options - Registered root classes and ActiveRecord models.
	 */
	constructor(options: serialization.SerializerOptions = {}) {
		this.registry = new SerializationRegistry(options);
	}

	/**
	 * Serializes one registered root object.
	 *
	 * @param value - Object whose `toJSON()` result matches its constructor input.
	 * @returns Versioned JSON-safe envelope.
	 */
	serialize(value: Serializable): SerializedValueEnvelope {
		if (!value || typeof value !== 'object') {
			throw failure(
				'serialize',
				'unregistered_class',
				'$',
				'root value must be a registered serializable object.',
			);
		}

		const name = this.registry.nameForSerializable(value);
		const Class = this.registry.classForSerializable(value);

		if (!name || !Class) {
			throw failure(
				'serialize',
				'unregistered_class',
				'$',
				'root object class is not registered.',
			);
		}

		let state: unknown;

		try {
			state = Class.prototype.toJSON.call(value);
		} catch (error) {
			throw failure(
				'serialize',
				'invalid_value',
				'$.state',
				`${Class.name}.toJSON() could not produce constructor state.`,
				error,
			);
		}

		const envelope: SerializedValueEnvelope = {
			format: SERIALIZED_VALUE_FORMAT,
			version: SERIALIZED_VALUE_VERSION,
			name,
			state: this.#normalizeValue(
				state,
				'$.state',
				{
					ancestors: new Map(),
				},
				'serialize',
			),
		};

		return envelope;
	}

	/**
	 * Restores one validated serializer envelope.
	 *
	 * @param payload - Unknown durable payload.
	 * @returns Reconstructed registered root object.
	 */
	async deserialize<TInstance extends Serializable = Serializable>(payload: unknown): Promise<TInstance> {
		const envelope = this.#validateEnvelope(payload);
		const Class = this.registry.classForName(envelope.name);

		if (!Class) {
			throw failure(
				'deserialize',
				'unregistered_class',
				'$.name',
				'serialized root class is not registered.',
			);
		}

		const state = await this.#restoreValue(envelope.state, '$.state', {
			activeRecords: new Map(),
		});

		try {
			const restored = new Class(state);

			if (Object.getPrototypeOf(restored) !== Class.prototype) {
				throw new TypeError('Constructor returned a different runtime type.');
			}

			return restored as TInstance;
		} catch (error) {
			throw failure(
				'deserialize',
				'class_construction_failed',
				'$',
				`${Class.name} could not be reconstructed from serialized state.`,
				error,
			);
		}
	}

	/**
	 * Normalizes runtime state or validates wire state through one JSON traversal.
	 *
	 * @param value - Runtime or wire value.
	 * @param path - Current diagnostic path.
	 * @param context - Active-path cycle tracking.
	 * @param operation - Active serializer direction.
	 * @returns Canonical serialized value.
	 */
	#normalizeValue(
		value: unknown,
		path: string,
		context: TraversalContext,
		operation: SerializationOperation,
	): SerializedValue {
		if (isSerializedPrimitive(value)) {
			if (
				typeof value === 'number'
				&& (!Number.isFinite(value) || Object.is(value, -0))
			) {
				throw failure(
					operation,
					operation === 'serialize' ? 'invalid_value' : 'invalid_payload',
					path,
					'JSON numbers must be finite and cannot be negative zero.',
				);
			}

			return value;
		}

		if (typeof value !== 'object' || value === null) {
			throw failure(
				operation,
				operation === 'serialize' ? 'unsupported_type' : 'invalid_payload',
				path,
				operation === 'serialize'
					? `${runtimeType(value)} values are not valid JSON constructor state.`
					: 'serialized constructor state must contain only JSON values and ActiveRecord references.',
			);
		}

		if (operation === 'serialize' && value instanceof ActiveRecord) {
			return this.#serializeActiveRecord(value, path);
		}

		if (Array.isArray(value)) {
			return this.#withAncestor(operation, value, path, context, () => {
				return arrayValues(value, path, operation).map((item, index) => {
					return this.#normalizeValue(
						item,
						`${path}[${index}]`,
						context,
						operation,
					);
				});
			});
		}

		const entries = plainObjectEntries(value, path, operation);
		const hasReferenceMarker = entries.some(([key]) => {
			return key === SERIALIZED_REFERENCE_KEY;
		});

		if (hasReferenceMarker) {
			if (operation === 'deserialize') {
				return this.#validateActiveRecordReference(entries, path);
			}

			throw failure(
				'serialize',
				'invalid_value',
				objectPath(path, SERIALIZED_REFERENCE_KEY),
				`"${SERIALIZED_REFERENCE_KEY}" is reserved for framework references.`,
			);
		}

		return this.#withAncestor(operation, value, path, context, () => {
			return Object.fromEntries(entries.map(([key, item]) => {
				return [
					key,
					this.#normalizeValue(
						item,
						objectPath(path, key),
						context,
						operation,
					),
				];
			})) as SerializedObject;
		});
	}

	/**
	 * Reduces one clean persisted model to its durable identity.
	 *
	 * @param record - ActiveRecord to serialize.
	 * @param path - Current diagnostic path.
	 * @returns Registered model reference.
	 */
	#serializeActiveRecord(record: ActiveRecord, path: string): SerializedActiveRecordReference {
		const Model = this.registry.modelForRecord(record);
		const model = Model ? this.registry.nameForModel(Model) : null;

		if (!Model || !model) {
			throw failure(
				'serialize',
				'unregistered_model',
				path,
				'ActiveRecord model is not registered.',
			);
		}

		if (!record.isPersisted()) {
			throw failure(
				'serialize',
				'unsaved_active_record',
				path,
				`${Model.name} is not persisted.`,
			);
		}

		let id: unknown;

		try {
			id = record.get(Model.primaryKey);
		} catch (error) {
			throw failure(
				'serialize',
				'invalid_value',
				`${path}.id`,
				`${Model.name} does not expose its configured primary key.`,
				error,
			);
		}

		if (!isSerializedPrimaryKey(id)) {
			throw failure(
				'serialize',
				'invalid_value',
				`${path}.id`,
				`${Model.name} requires a string or safe-integer primary key.`,
			);
		}

		if (record.isDirty()) {
			throw failure(
				'serialize',
				'dirty_active_record',
				path,
				`${Model.name} has unsaved changes.`,
			);
		}

		if (Model.softDeletes && record.trashed()) {
			throw failure(
				'serialize',
				'trashed_active_record',
				path,
				`${Model.name} is soft deleted.`,
			);
		}

		return {
			[SERIALIZED_REFERENCE_KEY]: SERIALIZED_ACTIVE_RECORD_TYPE,
			model,
			id,
		};
	}

	/**
	 * Validates the envelope before any model lookup or constructor call.
	 *
	 * @param payload - Unknown durable payload.
	 * @returns Canonical serializer envelope.
	 */
	#validateEnvelope(payload: unknown): SerializedValueEnvelope {
		const envelope = dataObject(plainObjectEntries(payload, '$', 'deserialize'));

		requireExactKeys(envelope, ['format', 'version', 'name', 'state'], '$');

		if (envelope.format !== SERIALIZED_VALUE_FORMAT) {
			throw failure(
				'deserialize',
				'invalid_payload',
				'$.format',
				`expected format "${SERIALIZED_VALUE_FORMAT}".`,
			);
		}

		if (envelope.version !== SERIALIZED_VALUE_VERSION) {
			throw failure(
				'deserialize',
				'unsupported_version',
				'$.version',
				'serializer version is not supported.',
			);
		}

		if (typeof envelope.name !== 'string') {
			throw failure(
				'deserialize',
				'invalid_payload',
				'$.name',
				'serialized root class name must be a string.',
			);
		}

		if (!this.registry.classForName(envelope.name)) {
			throw failure(
				'deserialize',
				'unregistered_class',
				'$.name',
				'serialized root class is not registered.',
			);
		}

		const canonical: SerializedValueEnvelope = {
			format: SERIALIZED_VALUE_FORMAT,
			version: SERIALIZED_VALUE_VERSION,
			name: envelope.name,
			state: this.#normalizeValue(
				envelope.state,
				'$.state',
				{
					ancestors: new Map(),
				},
				'deserialize',
			),
		};

		return canonical;
	}

	/**
	 * Validates one framework ActiveRecord marker without querying the database.
	 *
	 * @param entries - Candidate reference properties.
	 * @param path - Current diagnostic path.
	 * @returns Canonical registered model reference.
	 */
	#validateActiveRecordReference(
		entries: Array<[string, unknown]>,
		path: string,
	): SerializedActiveRecordReference {
		const reference = dataObject(entries);

		requireExactKeys(
			reference,
			[SERIALIZED_REFERENCE_KEY, 'model', 'id'],
			path,
		);

		if (reference[SERIALIZED_REFERENCE_KEY] !== SERIALIZED_ACTIVE_RECORD_TYPE) {
			throw failure(
				'deserialize',
				'invalid_payload',
				objectPath(path, SERIALIZED_REFERENCE_KEY),
				'framework reference type is not supported.',
			);
		}

		if (
			typeof reference.model !== 'string'
			|| !this.registry.modelForName(reference.model)
		) {
			throw failure(
				'deserialize',
				typeof reference.model === 'string'
					? 'unregistered_model'
					: 'invalid_payload',
				`${path}.model`,
				typeof reference.model === 'string'
					? 'serialized ActiveRecord model is not registered.'
					: 'serialized model name must be a string.',
			);
		}

		if (!isSerializedPrimaryKey(reference.id)) {
			throw failure(
				'deserialize',
				'invalid_payload',
				`${path}.id`,
				'serialized ActiveRecord id must be a string or safe integer.',
			);
		}

		return {
			[SERIALIZED_REFERENCE_KEY]: SERIALIZED_ACTIVE_RECORD_TYPE,
			model: reference.model,
			id: reference.id,
		};
	}

	/**
	 * Restores canonical state, resolving ActiveRecord references as needed.
	 *
	 * @param value - Canonical serialized value.
	 * @param path - Current diagnostic path.
	 * @param context - Per-operation model identity cache.
	 * @returns Restored runtime value.
	 */
	async #restoreValue(
		value: SerializedValue,
		path: string,
		context: RestoreContext,
	): Promise<unknown> {
		if (isSerializedPrimitive(value)) return value;

		if (Array.isArray(value)) {
			return await Promise.all(value.map((item, index) => {
				return this.#restoreValue(item, `${path}[${index}]`, context);
			}));
		}

		if (isActiveRecordReference(value)) {
			return await this.#restoreActiveRecord(value, path, context);
		}

		return Object.fromEntries(await Promise.all(
			Object.entries(value).map(async ([key, item]) => {
				return [
					key,
					await this.#restoreValue(item, objectPath(path, key), context),
				];
			}),
		));
	}

	/**
	 * Reloads one registered model while preserving repeated-reference identity.
	 *
	 * @param reference - Validated model reference.
	 * @param path - Current diagnostic path.
	 * @param context - Per-operation model identity cache.
	 * @returns Current persisted model.
	 */
	async #restoreActiveRecord(
		reference: SerializedActiveRecordReference,
		path: string,
		context: RestoreContext,
	): Promise<ActiveRecord> {
		const Model = this.registry.modelForName(reference.model);

		if (!Model) {
			throw failure(
				'deserialize',
				'unregistered_model',
				`${path}.model`,
				'serialized ActiveRecord model is not registered.',
			);
		}

		const cacheKey = JSON.stringify([
			reference.model,
			typeof reference.id,
			reference.id,
		]);
		let restored = context.activeRecords.get(cacheKey);

		if (!restored) {
			restored = Promise.resolve()
				.then(async () => {
					const record = await Model.findOrFail(reference.id);

					if (Object.getPrototypeOf(record) !== Model.prototype) {
						throw new TypeError('Model lookup returned a different runtime type.');
					}

					return record;
				})
				.catch(error => {
					const notFound = error instanceof RecordNotFoundError;

					throw failure(
						'deserialize',
						notFound
							? 'active_record_not_found'
							: 'active_record_restore_failed',
						path,
						notFound
							? 'registered ActiveRecord row no longer exists.'
							: 'registered ActiveRecord row could not be restored.',
						error,
					);
				});
			context.activeRecords.set(cacheKey, restored);
		}

		return await restored;
	}

	/**
	 * Traverses a container while rejecting cycles on the active path.
	 *
	 * @param operation - Active serializer direction.
	 * @param value - Container being entered.
	 * @param path - Current diagnostic path.
	 * @param context - Cycle tracking.
	 * @param callback - Nested traversal.
	 * @returns Nested traversal result.
	 */
	#withAncestor<TResult>(
		operation: SerializationOperation,
		value: object,
		path: string,
		context: TraversalContext,
		callback: () => TResult,
	): TResult {
		const previousPath = context.ancestors.get(value);

		if (previousPath !== undefined) {
			throw failure(
				operation,
				'circular_reference',
				path,
				`value contains a cycle back to ${previousPath}.`,
			);
		}

		context.ancestors.set(value, path);

		try {
			return callback();
		} finally {
			context.ancestors.delete(value);
		}
	}

}

/**
 * Creates one path-aware serializer error.
 *
 * @param operation - Active serializer direction.
 * @param code - Stable failure category.
 * @param path - Diagnostic path.
 * @param message - Safe explanation.
 * @param cause - Optional lower-level error.
 * @returns Structured serializer error.
 */
function failure(
	operation: SerializationOperation,
	code: ConstructorParameters<typeof SerializationError>[0]['code'],
	path: string,
	message: string,
	cause?: unknown,
): SerializationError {
	return new SerializationError({
		operation,
		code,
		path,
		message,
		cause,
	});
}

/**
 * Identifies ordinary JSON primitive values.
 *
 * @param value - Unknown value.
 * @returns Whether the value is a JSON primitive.
 */
function isSerializedPrimitive(value: unknown): value is SerializedPrimitive {
	return (
		value === null
		|| typeof value === 'string'
		|| typeof value === 'boolean'
		|| typeof value === 'number'
	);
}

/**
 * Identifies supported JSON-safe model primary keys.
 *
 * @param value - Unknown primary key.
 * @returns Whether the value is a non-empty string or safe integer.
 */
function isSerializedPrimaryKey(value: unknown): value is string | number {
	return (
		(typeof value === 'string' && value.length > 0)
		|| (
			typeof value === 'number'
			&& Number.isSafeInteger(value)
			&& !Object.is(value, -0)
		)
	);
}

/**
 * Identifies a canonical ActiveRecord reference.
 *
 * @param value - Canonical serialized object.
 * @returns Whether the framework marker is an ActiveRecord reference.
 */
function isActiveRecordReference(
	value: SerializedObject | SerializedActiveRecordReference,
): value is SerializedActiveRecordReference {
	return value[SERIALIZED_REFERENCE_KEY] === SERIALIZED_ACTIVE_RECORD_TYPE;
}

/**
 * Reads a dense array using normal JSON-visible index values.
 *
 * @param value - Candidate array.
 * @param path - Current diagnostic path.
 * @param operation - Active serializer direction.
 * @returns Values in index order.
 */
function arrayValues(
	value: unknown[],
	path: string,
	operation: SerializationOperation,
): unknown[] {
	const values: unknown[] = [];

	for (let index = 0; index < value.length; index += 1) {
		if (!Object.hasOwn(value, index)) {
			throw failure(
				operation,
				operation === 'serialize' ? 'unsupported_type' : 'invalid_payload',
				`${path}[${index}]`,
				'arrays must be dense.',
			);
		}

		values.push(value[index]);
	}

	return values;
}

/**
 * Reads normal JSON-visible properties from an ordinary object.
 *
 * @param value - Candidate object.
 * @param path - Current diagnostic path.
 * @param operation - Active serializer direction.
 * @returns Enumerable string-keyed entries.
 */
function plainObjectEntries(
	value: unknown,
	path: string,
	operation: SerializationOperation,
): Array<[string, unknown]> {
	if (!isPlainObject(value)) {
		throw failure(
			operation,
			operation === 'serialize' ? 'unsupported_type' : 'invalid_payload',
			path,
			operation === 'serialize'
				? `${runtimeType(value)} instances are not valid JSON constructor state.`
				: 'serialized objects must use an ordinary object prototype.',
		);
	}

	return Object.entries(value);
}

/**
 * Identifies an Object-prototype or null-prototype record.
 *
 * @param value - Unknown value.
 * @returns Whether the value is an ordinary object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
}

/**
 * Creates a prototype-safe object from data entries.
 *
 * @param entries - String-keyed entries.
 * @returns Ordinary object preserving keys such as `__proto__`.
 */
function dataObject(entries: Array<[string, unknown]>): Record<string, unknown> {
	return Object.fromEntries(entries);
}

/**
 * Requires an object to contain exactly the expected keys.
 *
 * @param value - Candidate object.
 * @param expected - Expected key names.
 * @param path - Current diagnostic path.
 */
function requireExactKeys(
	value: Record<string, unknown>,
	expected: string[],
	path: string,
): void {
	const actual = Object.keys(value);
	const keys = new Set(actual);

	if (
		actual.length !== expected.length
		|| expected.some(key => !keys.has(key))
	) {
		throw failure(
			'deserialize',
			'invalid_payload',
			path,
			`expected exactly ${expected.join(', ')}.`,
		);
	}
}

/**
 * Formats one object property as a JSONPath-like location.
 *
 * @param path - Parent path.
 * @param key - Property name.
 * @returns Child path.
 */
function objectPath(path: string, key: string): string {
	return OBJECT_PATH_KEY.test(key)
		? `${path}.${key}`
		: `${path}[${JSON.stringify(key)}]`;
}

/**
 * Returns a concise runtime type label.
 *
 * @param value - Unknown runtime value.
 * @returns Human-readable type.
 */
function runtimeType(value: unknown): string {
	if (value === null) return 'null';
	if (typeof value !== 'object') return typeof value;
	if (Array.isArray(value)) return 'Array';

	const prototype = Object.getPrototypeOf(value);
	const constructor = prototype
		&& Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;

	return typeof constructor === 'function' && constructor.name
		? constructor.name
		: 'Object';
}
