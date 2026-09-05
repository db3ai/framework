/**
 * Runtime class token used to register a listener for one event type.
 *
 * The constructor is used only as an identity key. Applications create and
 * dispatch their event instances themselves.
 */
export interface EventConstructor<TEvent extends object = object> {
	/** Human-readable class name used in diagnostics and tooling. */
	readonly name: string;
	/** Event instance shape represented by this class token. */
	readonly prototype: TEvent;
}
