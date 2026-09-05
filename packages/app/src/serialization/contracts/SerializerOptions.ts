import type { ActiveRecordClass } from '../../db';
import type { SerializableClass } from './SerializableClass';

/**
 * Framework serializer configuration supplied when creating an application.
 */
export interface SerializerOptions {
	/**
	 * Stable class keys mapped to constructors that accept their `toJSON()` state.
	 */
	classes?: Record<string, SerializableClass>;

	/**
	 * ActiveRecord models available for identity-based restoration.
	 *
	 * Explicit stable keys keep durable payloads independent of table names.
	 */
	models?: Record<string, ActiveRecordClass>;
}
