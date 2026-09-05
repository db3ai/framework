/**
 * Registry entry category involved in a registration failure.
 */
export type SerializationRegistryEntryType = 'class' | 'model';

/**
 * Error raised when an application configures an invalid or ambiguous
 * serialization registry entry.
 */
export class SerializationRegistryError extends Error {
	/**
	 * Creates a serializer registry configuration failure.
	 *
	 * @param entryType - Registry category being configured.
	 * @param message - Safe explanation of the invalid registration.
	 */
	constructor(
		readonly entryType: SerializationRegistryEntryType,
		message: string,
	) {
		super(`Cannot register serialization ${entryType}: ${message}`);
		this.name = 'SerializationRegistryError';
	}
}
