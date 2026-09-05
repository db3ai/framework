import { app } from '@db3.ai/app/server';
import { WriteDailySummaryJob } from './WriteDailySummaryJob';

/**
 * Registers one daily report in each scheduler and queue-worker process.
 *
 * Call once at boot. Resolving scheduler also attaches the queue lifecycle
 * recorder, so workers update occurrence history after processing the job.
 */
export function registerDailySummary(): void {
	app().queue.registerJob(WriteDailySummaryJob);
	app().scheduler.job(WriteDailySummaryJob).dailyAt('09:00').timezone('UTC');
}
