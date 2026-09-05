import { app } from '@db3.ai/app/server';
import type { QueueJobId, QueueProcessResult } from '@db3.ai/app/queue';
import { GenerateReportJob } from './GenerateReportJob';

/**
 * Registers the example job in a worker process.
 */
export function registerGenerateReportJob(): void {
	app().queue.registerJob(GenerateReportJob);
}

/**
 * Dispatches one report job through the active application queue.
 *
 * @param reportId - Stable application-owned report identifier.
 * @returns Driver-owned queued job identifier.
 */
export async function dispatchGenerateReportJob(reportId: string): Promise<QueueJobId> {
	return app().queue.dispatch(new GenerateReportJob({ reportId }));
}

/**
 * Claims and processes the next job from the default queue.
 *
 * @returns Queue result, or null when no job is available.
 */
export async function processNextReportJob(): Promise<QueueProcessResult | null> {
	return app().queue.workNextJob();
}
