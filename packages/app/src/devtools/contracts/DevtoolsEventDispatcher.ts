/**
 * Environment values shared by framework instrumentation that streams events
 * to the local development service.
 */
export interface DevtoolsEnvironment {
	NODE_ENV?: string;
	PLATFORM_DEVTOOLS_API_PORT?: string;
	PLATFORM_DEVTOOLS_EVENTS_URL?: string;
	PLATFORM_DEVTOOLS_HOST?: string;
}

/**
 * Configuration for a bounded, best-effort HTTP event dispatcher.
 */
export interface HttpEventDispatcherOptions {
	/** HTTP endpoint that accepts `{ events: [...] }` JSON batches. */
	url?: string;
	/** Maximum events sent in one request. */
	batchSize?: number;
	/** Maximum time an event waits before its batch is sent. */
	flushIntervalMs?: number;
	/** Pause before later batches are attempted after a failed request. */
	retryAfterMs?: number;
	/** Maximum time allowed for one ingestion request. */
	requestTimeoutMs?: number;
	/** Maximum unsent events retained before the oldest event is discarded. */
	maxPendingEvents?: number;
	/** Additional HTTP headers included with every ingestion request. */
	headers?: Record<string, string>;
	/** Fetch implementation used by tests or alternate runtimes. */
	fetch?: typeof fetch;
}

/**
 * Callable event sink with explicit flushing and shutdown lifecycle controls.
 *
 * Delivery is intentionally best-effort: a failed batch is discarded so
 * development instrumentation cannot hold an application process open.
 */
export interface DevtoolsEventDispatcher<TEvent extends object> {
	/**
	 * Queues one event for asynchronous delivery.
	 *
	 * @param event - Structured framework event to send.
	 */
	(event: TEvent): void;

	/**
	 * Sends the next pending batch when the dispatcher is available.
	 */
	flush(): Promise<void>;

	/**
	 * Stops accepting events and attempts to drain the bounded queue.
	 */
	close(): Promise<void>;
}
