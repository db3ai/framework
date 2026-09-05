/**
 * Constructor-backed object that exposes its complete durable state.
 *
 * The returned state must contain only JSON values and registered
 * ActiveRecord instances. Deserialization passes the restored state back to
 * the registered class constructor.
 *
 * @template TState - Complete state accepted by the concrete class constructor.
 */
export interface Serializable<TState = unknown> {
	/**
	 * Returns the complete state needed to reconstruct this object.
	 *
	 * @returns Constructor state containing JSON values and registered records.
	 */
	toJSON(): TState;
}
