import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence } from '@db3.ai/app/scheduler';
import { App } from '@db3.ai/app/server';
import { registerDailySummary } from './registerDailySummary';

/**
 * Evaluates a fixed minute, processes its SQL-backed job and checks deduplication.
 *
 * This isolated lab owns its schema and files. It does not run historical
 * application schedules or wait for wall-clock time to pass.
 *
 * @returns Stable scheduling, processing and history observations.
 */
export async function runDailySummary() {
	const root = await mkdtemp(join(tmpdir(), 'db3-scheduler-guide-'));
	try {
		const database = await createGeneratedTestDatabase('scheduler_guide');
		const application = new App({ db: database.db, storage: { disks: { local: { driver: 'local', root } } } });
		try {
			await application.db.install(QueuedJob, FailedJob, ScheduledOccurrence);
			registerDailySummary();
			const minute = new Date('2026-01-01T09:00:00Z');
			const first = await application.scheduler.runDue(minute);
			const repeated = await application.scheduler.runDue(minute);
			const processed = await application.queue.workNextJob();
			if (!processed) throw new Error('The scheduled job was not available to the worker.');
			const occurrence = await ScheduledOccurrence.where('name', 'write-daily-summary').firstOrFail();
			const text = await application.storage.readToString('reports/latest.txt');
			const notDue = await application.scheduler.runDue(new Date('2026-01-01T09:01:00Z'));
			return { dispatched: first.dispatched, duplicateSkipped: repeated.skipped, processed: processed.status, occurrenceStatus: occurrence.status, text, nextMinuteDue: notDue.due };
		} finally {
			try { await application.close(); } finally { await database.destroy(); }
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runDailySummary(), null, 2));
}
