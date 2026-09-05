/**
 * Synchronous or asynchronous consumer of one application event type.
 *
 * @param event - Event instance dispatched by application or framework code.
 */
export type EventListener<TEvent extends object> = (
	event: TEvent,
) => void | Promise<void>;
