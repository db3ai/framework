import { ulid } from '@db3.ai/pure';
import { RunnableJob } from './RunnableJob';
import { JobRunAttempt } from './JobRunAttempt';
import { JobRunEvent } from './JobRunEvent';

/** How long finished runs are kept. Waiting, running and blocked runs are never pruned. */
export interface JobRunRetention {
	/** Days to keep completed and cancelled runs. */
	completedDays: number;
	/** Days to keep failed runs, usually longer so failures can be investigated. */
	failedDays: number;
	/** Shorter or longer completed/cancelled windows for specific job types, e.g. every-minute schedules. */
	jobTypes?: Record<string, number>;
}

/** Framework default: a month of history, a quarter for failures. */
export const DEFAULT_JOB_RUN_RETENTION: JobRunRetention = { completedDays: 30, failedDays: 90 };

const DAY_MS = 86_400_000;
const BATCH = 500;

/**
 * Deletes finished job runs older than their retention window, with their attempts and events.
 * Run IDs are ULIDs, so age is a primary-key range and no created_at index is needed. Works in
 * small batches so it never holds long locks. Child runs are judged on their own age and status.
 *
 * @param retention - Windows to apply; defaults to DEFAULT_JOB_RUN_RETENTION.
 * @param now - Clock used for the cutoffs.
 * @returns Number of runs deleted.
 */
export async function pruneJobRuns(retention: JobRunRetention = DEFAULT_JOB_RUN_RETENTION, now = new Date()): Promise<number> {
	const overrides = Object.entries(retention.jobTypes ?? {});
	const named = overrides.map(([jobType]) => jobType);
	let deleted = 0;
	deleted += await prune(['completed', 'cancelled'], retention.completedDays, now, query => named.length ? query.whereNotIn('job_type', named) : query);
	for (const [jobType, days] of overrides) deleted += await prune(['completed', 'cancelled'], days, now, query => query.where('job_type', jobType));
	deleted += await prune(['failed'], retention.failedDays, now, query => query);
	return deleted;
}

/** Deletes one status group in id-ordered batches below the cutoff ULID. */
async function prune(statuses: string[], days: number, now: Date, scope: (query: ReturnType<typeof runs>) => ReturnType<typeof runs>): Promise<number> {
	if (!Number.isFinite(days) || days < 1) throw new Error('Job run retention must be at least one day.');
	const cutoff = cutoffId(new Date(now.getTime() - days * DAY_MS));
	let deleted = 0;
	for (;;) {
		const rows: Array<{ id: string }> = await scope(runs()).select('id').whereIn('status', statuses).where('id', '<', cutoff).orderBy('id').limit(BATCH);
		if (rows.length === 0) return deleted;
		const ids = rows.map(row => row.id);
		await JobRunEvent.query().whereIn('runId', ids).forceDelete();
		await JobRunAttempt.query().whereIn('runId', ids).forceDelete();
		deleted += await RunnableJob.query().whereIn('id', ids).forceDelete();
		if (rows.length < BATCH) return deleted;
	}
}

/** Lowest-sorting ULID at the cutoff time; every id below it was created earlier. */
function cutoffId(at: Date): string {
	return ulid(at).slice(0, 10) + '0'.repeat(16);
}

function runs() {
	return RunnableJob.query().toKnex().clear('select');
}
