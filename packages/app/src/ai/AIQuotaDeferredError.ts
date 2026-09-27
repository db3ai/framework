import { QueueRetryLaterError } from '@db3.ai/app/queue';

/**
 * Queue-compatible deferral raised while OpenAI account quota is unavailable.
 */
export class AIQuotaDeferredError extends QueueRetryLaterError {
	/**
	 * Creates one bounded quota deferral.
	 *
	 * @param delaySeconds - Seconds before the queued job should retry.
	 * @param retryAt - Absolute time of the scheduled retry.
	 * @param retryUntil - Absolute time after which quota retries become terminal.
	 * @param deferralCount - Number of quota deferrals recorded for this request.
	 * @param message - Provider failure message.
	 */
	constructor(
		delaySeconds: number,
		readonly retryAt: Date,
		readonly retryUntil: Date,
		readonly deferralCount: number,
		message: string,
	) {
		super(delaySeconds, message);
		this.name = 'AIQuotaDeferredError';
	}
}
