import type { Schedule } from '@db3.ai/app/scheduler';
import { ReviewSavedOpportunitiesJob } from './jobs/ReviewSavedOpportunitiesJob.js';

/** Declares Social's recurring work; the host owns its scheduler and queue workers. */
export function schedule(schedule: Schedule): void {
	schedule.job(ReviewSavedOpportunitiesJob).hourly();
}
