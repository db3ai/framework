import type * as queue from './contracts';

/**
 * Typed asynchronous lifecycle dispatcher owned by one Queue instance.
 *
 * Queue transitions are already durable when events are published. Listener
 * failures are therefore reported independently and never reject the queue
 * operation that produced the event.
 */
export class QueueEvents {
	readonly #listeners = new Set<queue.QueueLifecycleListener>();

	/**
	 * Creates a queue event dispatcher.
	 *
	 * @param onListenerError - Reporter for isolated listener failures.
	 */
	constructor(
		private readonly onListenerError: queue.QueueLifecycleErrorHandler,
	) {}

	/**
	 * Subscribes to every queue lifecycle event.
	 *
	 * @param listener - Listener invoked for subsequent lifecycle events.
	 * @returns Function that removes the listener.
	 */
	subscribe(listener: queue.QueueLifecycleListener): () => void {
		this.#listeners.add(listener);

		return () => {
			this.#listeners.delete(listener);
		};
	}

	/**
	 * Publishes one event and waits for every current listener to settle.
	 *
	 * @param event - Immutable lifecycle event to publish.
	 */
	async publish(event: queue.QueueLifecycleEvent): Promise<void> {
		const listeners = [...this.#listeners];
		const results = await Promise.allSettled(
			listeners.map(async listener => listener(event)),
		);

		for (const result of results) {
			if (result.status === 'fulfilled') continue;

			this.onListenerError({
				source: 'listener',
				event,
				error: result.reason,
			});
		}
	}
}
