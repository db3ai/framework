import type { Serializable } from '../Serializable';

/**
 * Constructor for a registered object whose complete runtime state is exposed
 * through `toJSON()`.
 *
 * @template TState - Complete constructor state owned by the class.
 * @template TInstance - Concrete serializable instance.
 */
export interface SerializableClass<
	TState = any,
	TInstance extends Serializable<TState> = Serializable<TState>,
> {
	/** Runtime class name used only for diagnostics. */
	readonly name: string;

	/** Exact instance prototype associated with this constructor. */
	readonly prototype: TInstance;

	/**
	 * Reconstructs an instance from fully restored constructor state.
	 *
	 * @param state - State previously returned by the instance's `toJSON()` method.
	 */
	new(state: TState): TInstance;
}
