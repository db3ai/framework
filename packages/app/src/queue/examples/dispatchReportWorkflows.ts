import { app } from '@db3.ai/app/server';
import type { QueueJobId } from '@db3.ai/app/queue';
import { GenerateReportJob } from './GenerateReportJob';

/**
 * Dispatches report jobs as an ordered pipeline.
 *
 * Each job is persisted only after its predecessor succeeds. A terminal failure
 * therefore prevents the remaining reports from being dispatched.
 *
 * @param reportIds - Report identifiers to process in order.
 * @returns Driver-owned identifier for the first queued job.
 */
export async function dispatchReportPipeline(reportIds: string[]): Promise<QueueJobId> {
	if (reportIds.length === 0) {
		throw new Error('A report pipeline requires at least one report.');
	}

	return app().queue.chain(
		reportIds.map(reportId => new GenerateReportJob({ reportId })),
		{
			queue: 'reports',
		},
	);
}

/**
 * Dispatches report jobs independently so workers can process them in parallel.
 *
 * @param reportIds - Report identifiers that do not depend on one another.
 * @returns Driver-owned identifiers for every queued job.
 */
export async function dispatchReportBatch(reportIds: string[]): Promise<QueueJobId[]> {
	return app().queue.batch(
		reportIds.map(reportId => new GenerateReportJob({ reportId })),
		{
			queue: 'reports',
		},
	);
}
