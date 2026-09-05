import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { ActiveRecord } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { FailedJob, QueuedJob, runQueueConsole } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';
import { reportConsoleOptions } from '../../examples/reportConsole';

it('runs the report console across App lifetimes and lists failure metadata without payloads', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-queue-console-test-'));
	const output = vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	try {
		const database = await createGeneratedTestDatabase('queue_console');
		try {
			const installer = new App({ db: database.db });
			try { await installer.db.install(QueuedJob, FailedJob); } finally { await installer.close(); }

			/** Runs a finite real CLI command with a fresh application bootstrap. */
			async function execute(args: string[]): Promise<void> {
				const application = new App({ db: database.db, queue: { driver: 'database', queueMonitor: false }, storage: { disks: { local: { driver: 'local', root } } } });
				try { await runQueueConsole(reportConsoleOptions(application), args); } finally { await application.close(); }
			}

			await execute(['report:seed']);
			await execute(['queue:dispatch', 'reports.write.v1', '{"reportId":"weekly-v1"}', '--queue=reports']);
			await execute(['queue:work', '--queue=other', '--once']);
			expect(await ActiveRecord.withDb(database.db, () => QueuedJob.query().count())).toBe(1);
			await execute(['queue:work', '--queue=reports', '--once']);
			expect(await readFile(join(root, 'reports/weekly-v1.txt'), 'utf8')).toBe('Report: Three notes ready\n');

			await execute(['queue:dispatch', 'reports.write.v1', '{"reportId":"missing-v1"}', '--queue=reports', '--tries=1']);
			await execute(['queue:work', '--queue=reports', '--once']);
			await execute(['queue:failed']);
			const failures = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
			expect(failures).toHaveLength(1);
			expect(Object.keys(failures[0]).sort()).toEqual(['failedAt', 'id', 'job', 'queue']);
			expect(failures[0].job).toBe('reports.write.v1');
			expect(await ActiveRecord.withDb(database.db, () => QueuedJob.query().count())).toBe(0);
		} finally {
			await database.destroy();
		}
	} finally {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	}
});
