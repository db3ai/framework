import type { SerializationRegistry } from '../SerializationRegistry';
import type { Serializable } from '../Serializable';
import type { SerializedValueEnvelope } from './SerializedValue';

/**
 * Application serializer service for durable constructor-backed objects.
 */
export interface SerializerService {
	/** Application-scoped registered serializable classes and ActiveRecord models. */
	readonly registry: SerializationRegistry;

	/**
	 * Converts one registered object into a JSON-safe versioned envelope.
	 *
	 * @param value - Registered object whose `toJSON()` state should be serialized.
	 * @returns JSON-safe serialized value envelope.
	 */
	serialize(value: Serializable): SerializedValueEnvelope;

	/**
	 * Restores one previously serialized registered object.
	 *
	 * ActiveRecord restoration makes this operation asynchronous.
	 *
	 * @param payload - Unknown payload to validate and deserialize.
	 * @returns Restored registered object.
	 */
	deserialize<TInstance extends Serializable = Serializable>(payload: unknown): Promise<TInstance>;
}
