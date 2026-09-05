import { app } from '@db3.ai/app/server';
import { QueueRetryLaterError, type QueueJobId } from '@db3.ai/app/queue';
import { GenerateReportJob } from './GenerateReportJob';

/**
 * Dispatches one report with an explicit ordinary-failure retry policy.
 *
 * @param reportId - Stable application-owned report identifier.
 * @returns Driver-owned queued job identifier.
 */
export async function dispatchReportWithRetryPolicy(reportId: string): Promise<QueueJobId> {
	return app().queue.dispatch(new GenerateReportJob({ reportId }), {
		queue: 'reports',
		maxTries: 8,
		backoff: {
			strategy: 'exponential',
			initialSeconds: 15,
			maxSeconds: 900,
			jitter: true,
		},
		retryUntilSeconds: 21_600,
	});
}

/**
 * Defers the current job when a provider supplies an explicit retry delay.
 *
 * Throw this from a QueueableJob handler after detecting provider backpressure.
 * Deferral restores the claimed attempt instead of consuming an ordinary retry.
 *
 * @param delaySeconds - Provider-requested delay before another attempt.
 */
export function retryReportAfterBackpressure(delaySeconds: number): never {
	throw new QueueRetryLaterError(delaySeconds, 'The report provider requested backpressure.');
}

/**
 * Replays one terminal report failure while preserving its audit record.
 *
 * @param failedJobId - Driver-owned identifier from failedJobs().
 * @returns Driver-owned identifier for the replacement queue job.
 */
export async function retryFailedReportJob(failedJobId: QueueJobId): Promise<QueueJobId> {
	return app().queue.retryFailed(failedJobId, {
		queue: 'reports',
	});
}
