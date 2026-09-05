import type { Logger } from './Logger';

/**
 * Driver boundary used by the framework logging service.
 */
export interface LoggerDriver {
	/** Logger implementation used for record creation. */
	readonly logger: Logger;

	/**
	 * Waits until records already accepted by the driver reach its destination.
	 */
	flush(): Promise<void>;

	/**
	 * Flushes records and releases transport resources.
	 */
	close(): Promise<void>;
}
