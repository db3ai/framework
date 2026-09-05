import { ActiveRecord, type ActiveRecordClass } from '../db';
import type { Serializable } from './Serializable';
import { SerializationRegistryError, type SerializationRegistryEntryType } from './SerializationRegistryError';
import type * as serialization from './contracts';

/**
 * Application-scoped allowlist for serializable roots and ActiveRecord models.
 *
 * Payloads contain only stable names. Resolution always uses an exact instance
 * prototype, so an unregistered subclass cannot inherit a durable identity.
 */
export class SerializationRegistry {
	readonly #classes = new Map<string, serialization.SerializableClass>();
	readonly #classNames = new Map<object, string>();
	readonly #models = new Map<string, ActiveRecordClass>();
	readonly #modelNames = new Map<object, string>();

	/**
	 * Creates a registry from application serializer options.
	 *
	 * @param options - Initial root classes and ActiveRecord models.
	 */
	constructor(options: Pick<serialization.SerializerOptions, 'classes' | 'models'> = {}) {
		for (const [name, Class] of Object.entries(options.classes ?? {})) {
			this.registerClass(name, Class);
		}

		for (const [name, Model] of Object.entries(options.models ?? {})) {
			this.registerModel(name, Model);
		}
	}

	/**
	 * Registers a stable root-class name.
	 *
	 * @param name - Durable class key.
	 * @param Class - Constructor accepting the state returned by `toJSON()`.
	 * @returns This registry.
	 */
	registerClass(name: string, Class: serialization.SerializableClass): this {
		const key = registryName(name, 'class');

		if (
			typeof Class !== 'function'
			|| !Class.prototype
			|| typeof Class.prototype.toJSON !== 'function'
		) {
			throw new SerializationRegistryError(
				'class',
				`"${key}" must reference a constructor with a toJSON() method.`,
			);
		}

		this.#register('class', key, Class, this.#classes, this.#classNames);

		return this;
	}

	/**
	 * Registers a stable ActiveRecord model name.
	 *
	 * @param name - Durable model key.
	 * @param Model - Concrete ActiveRecord model.
	 * @returns This registry.
	 */
	registerModel(name: string, Model: ActiveRecordClass): this {
		const key = registryName(name, 'model');

		if (
			typeof Model !== 'function'
			|| !(Model.prototype instanceof ActiveRecord)
		) {
			throw new SerializationRegistryError(
				'model',
				`"${key}" must reference an ActiveRecord subclass.`,
			);
		}

		this.#register('model', key, Model, this.#models, this.#modelNames);

		return this;
	}

	/**
	 * Returns the stable name for a serializable instance's exact prototype.
	 *
	 * @param value - Root instance to resolve.
	 * @returns Registered name, or null.
	 */
	nameForSerializable(value: Serializable): string | null {
		return this.#classNames.get(Object.getPrototypeOf(value)) ?? null;
	}

	/**
	 * Returns the registered class for a serializable instance.
	 *
	 * @param value - Root instance to resolve.
	 * @returns Registered constructor, or null.
	 */
	classForSerializable(value: Serializable): serialization.SerializableClass | null {
		const name = this.nameForSerializable(value);

		return name ? this.classForName(name) : null;
	}

	/**
	 * Resolves a root class by its durable name.
	 *
	 * @param name - Durable class name.
	 * @returns Registered constructor, or null.
	 */
	classForName(name: string): serialization.SerializableClass | null {
		return this.#classes.get(name) ?? null;
	}

	/**
	 * Returns the registered model for a record instance.
	 *
	 * @param record - ActiveRecord instance to resolve.
	 * @returns Registered model, or null.
	 */
	modelForRecord(record: ActiveRecord): ActiveRecordClass | null {
		const name = this.#modelNames.get(Object.getPrototypeOf(record));

		return name ? this.modelForName(name) : null;
	}

	/**
	 * Returns the stable name for an exact ActiveRecord model.
	 *
	 * @param Model - Model constructor to resolve.
	 * @returns Registered name, or null.
	 */
	nameForModel(Model: ActiveRecordClass): string | null {
		return this.#modelNames.get(Model.prototype) ?? null;
	}

	/**
	 * Resolves an ActiveRecord model by its durable name.
	 *
	 * @param name - Durable model name.
	 * @returns Registered model, or null.
	 */
	modelForName(name: string): ActiveRecordClass | null {
		return this.#models.get(name) ?? null;
	}

	/**
	 * Adds an exact name/prototype pair or rejects an ambiguous registration.
	 *
	 * @param entryType - Registry category.
	 * @param name - Validated durable name.
	 * @param Class - Constructor being registered.
	 * @param entries - Name-to-constructor map.
	 * @param names - Prototype-to-name map.
	 */
	#register<TClass extends Function>(
		entryType: SerializationRegistryEntryType,
		name: string,
		Class: TClass & { prototype: object },
		entries: Map<string, TClass>,
		names: Map<object, string>,
	): void {
		const existingClass = entries.get(name);
		const existingName = names.get(Class.prototype);

		if (existingClass && existingClass !== Class) {
			throw new SerializationRegistryError(
				entryType,
				`the stable name "${name}" is already used by ${existingClass.name}.`,
			);
		}

		if (existingName && existingName !== name) {
			throw new SerializationRegistryError(
				entryType,
				`${Class.name} is already registered as "${existingName}".`,
			);
		}

		entries.set(name, Class);
		names.set(Class.prototype, name);
	}
}

/**
 * Validates one durable registry name.
 *
 * @param value - Candidate name.
 * @param entryType - Registry category.
 * @returns Trimmed stable name.
 */
function registryName(value: string, entryType: SerializationRegistryEntryType): string {
	const name = typeof value === 'string' ? value.trim() : '';

	if (
		!name
		|| name.length > 200
		|| !/^[A-Za-z0-9@._:/-]+$/.test(name)
	) {
		throw new SerializationRegistryError(
			entryType,
			'stable names must contain only letters, numbers, @, dot, underscore, colon, slash, and dash, up to 200 characters.',
		);
	}

	return name;
}
