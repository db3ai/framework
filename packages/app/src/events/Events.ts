import type * as events from './contracts';

type StoredEventListener = events.EventListener<object>;

/**
 * Typed in-process dispatcher for application and framework events.
 *
 * Event classes are runtime keys, so listeners infer the correct event shape
 * without requiring a global string-to-payload registry. Dispatch is
 * intentionally synchronous from the caller's perspective: listeners run in
 * registration order and asynchronous listeners are awaited.
 *
 * @example
 * const unsubscribe = app().events.listen(WebsiteCrawled, async event => {
 * 	await indexWebsite(event.websiteId);
 * });
 *
 * await app().events.dispatch(new WebsiteCrawled(websiteId));
 * unsubscribe();
 */
export class Events {
	readonly #listeners = new Map<
		events.EventConstructor,
		Set<StoredEventListener>
	>();

	/**
	 * Registers a listener for exactly one event class.
	 *
	 * Subclasses are independent event types and do not automatically invoke
	 * listeners registered for a parent class.
	 *
	 * @param eventType - Event class used as the listener key.
	 * @param listener - Consumer invoked for subsequent event instances.
	 * @returns Idempotent function that removes this registration.
	 */
	listen<TEvent extends object>(
		eventType: events.EventConstructor<TEvent>,
		listener: events.EventListener<TEvent>,
	): events.EventUnsubscribe {
		const key: events.EventConstructor = eventType;
		const listeners = this.#listeners.get(key) ?? new Set<StoredEventListener>();
		const storedListener: StoredEventListener = event => {
			return listener(event as TEvent);
		};
		let subscribed = true;

		listeners.add(storedListener);
		this.#listeners.set(key, listeners);

		return () => {
			if (!subscribed) return;

			subscribed = false;
			listeners.delete(storedListener);

			if (listeners.size === 0) {
				this.#listeners.delete(key);
			}
		};
	}

	/**
	 * Registers a listener that removes itself before its first invocation.
	 *
	 * Removing the registration before calling the listener guarantees that
	 * overlapping dispatches cannot invoke the one-shot listener twice.
	 *
	 * @param eventType - Event class used as the listener key.
	 * @param listener - Consumer invoked at most once.
	 * @returns Idempotent function that removes the pending registration.
	 */
	once<TEvent extends object>(
		eventType: events.EventConstructor<TEvent>,
		listener: events.EventListener<TEvent>,
	): events.EventUnsubscribe {
		let unsubscribe: events.EventUnsubscribe = () => {};
		const oneShotListener: events.EventListener<TEvent> = event => {
			unsubscribe();

			return listener(event);
		};

		unsubscribe = this.listen(eventType, oneShotListener);

		return unsubscribe;
	}

	/**
	 * Dispatches one class instance to its current listeners.
	 *
	 * Listeners run sequentially in registration order. If a listener throws or
	 * rejects, dispatch rejects immediately and later listeners are not invoked.
	 * Callers therefore control whether listener completion is part of their
	 * operation or should be delegated to a durable queued job.
	 *
	 * @param event - Class instance containing event data.
	 */
	async dispatch<TEvent extends object>(event: TEvent): Promise<void> {
		const eventType = eventConstructor(event);
		const listeners = this.#listeners.get(eventType);

		if (!listeners) return;

		for (const listener of [...listeners]) {
			await listener(event);
		}
	}

	/**
	 * Returns whether an event class currently has one or more listeners.
	 *
	 * @param eventType - Exact event class to inspect.
	 * @returns True when at least one listener is registered.
	 */
	hasListeners<TEvent extends object>(
		eventType: events.EventConstructor<TEvent>,
	): boolean {
		return (this.#listeners.get(eventType)?.size ?? 0) > 0;
	}

	/**
	 * Removes every listener registered for one event class.
	 *
	 * @param eventType - Exact event class whose registrations should be removed.
	 */
	forget<TEvent extends object>(
		eventType: events.EventConstructor<TEvent>,
	): void {
		this.#listeners.delete(eventType);
	}

	/**
	 * Removes all listener registrations owned by this dispatcher.
	 */
	clear(): void {
		this.#listeners.clear();
	}
}

/**
 * Resolves and validates the exact runtime class for an event instance.
 *
 * Plain objects are rejected because every object literal shares the `Object`
 * constructor and would therefore collapse unrelated event types together.
 *
 * @param event - Candidate event instance.
 * @returns Concrete class token used to look up listeners.
 */
function eventConstructor<TEvent extends object>(
	event: TEvent,
): events.EventConstructor<TEvent> {
	const prototype = Object.getPrototypeOf(event) as {
		constructor?: unknown;
	} | null;
	const eventType = prototype?.constructor;

	if (typeof eventType !== 'function' || eventType === Object) {
		throw new TypeError(
			'Events must be class instances. Define an event class and dispatch a new instance.',
		);
	}

	return eventType as unknown as events.EventConstructor<TEvent>;
}
