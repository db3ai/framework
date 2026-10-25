import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { App } from '@db3.ai/app/server';
import { Database } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { createReportCli } from '../../examples/createReportCli';

/** The copyable report example uses the real typed parser, SQL transport and storage through the queue alias. */
it('runs the shared report CLI across application lifetimes', async () => {
	const storageRoot = await mkdtemp(join(tmpdir(), 'db3-report-cli-'));
	const generated = await createGeneratedTestDatabase('report_cli_example');
	try {
		await new Database(generated.db, { reportSchemaDiff: false }).install(QueuedJob, FailedJob);
		/** Creates one real runtime for each invocation, preserving storage between operations. */
		const createApplication = (): App => new App({ db: generated.db, log: { level: 'silent' }, queue: { queueMonitor: false }, storage: { disks: { local: { driver: 'local', root: storageRoot } } } });
		expect(await createReportCli(createApplication).run(['report:seed'])).toBe(0);
		expect(await createReportCli(createApplication).run(['queue:dispatch', 'reports.write.v1', '{"reportId":"weekly-v1"}', '--queue=reports'])).toBe(0);
		expect(await createReportCli(createApplication).run(['queue', '--pool=reports', '--once'])).toBe(0);
		expect(await readFile(join(storageRoot, 'reports/weekly-v1.txt'), 'utf8')).toBe('Report: Three notes ready\n');
	} finally { await generated.destroy(); await rm(storageRoot, { recursive: true, force: true }); }
});
