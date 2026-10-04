import type { QueueableJobContext, QueueableJobFailureContext, QueueableJobRetryContext, SerializedQueueableJob } from './QueueableJob';

/** Execution and delivery contract shared by command jobs and persisted runnable records. */
export interface QueueableJobContract {
	/** Serializes delivery data; persisted runs send only their identity and generation. */
	serialize(): SerializedQueueableJob;
	/** Performs application work after the queue has claimed delivery. */
	handle(context: QueueableJobContext): Promise<void>;
	/** Observes a committed retry; important state must not depend solely on this hook. */
	onRetry(context: QueueableJobRetryContext): Promise<void>;
	/** Observes a committed terminal failure. */
	onFinalFailure(context: QueueableJobFailureContext): Promise<void>;
}
