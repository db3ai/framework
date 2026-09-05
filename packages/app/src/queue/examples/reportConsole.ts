import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runQueueConsole, type QueueConsoleOptions } from '@db3.ai/app/queue';
import { App } from '@db3.ai/app/server';
import { WriteReportJob } from './WriteReportJob';

/**
 * Wires the public queue console to a bootstrapped application.
 *
 * @param application - Application with migrated queue tables and report storage.
 * @returns CLI configuration; finite commands close the App, workers drain on signals.
 */
export function reportConsoleOptions(application: App): QueueConsoleOptions {
	return {
		app: () => application,
		bootstrap: () => application.queue.registerJob(WriteReportJob),
		commands: [{
			command: 'queue:failed',
			/** Lists bounded operational metadata without exposing payloads or exceptions. */
			async run({ app }) {
				const failures = await app.queue.failedJobs(25);
				console.log(JSON.stringify(failures.map(failure => ({ id: failure.id, queue: failure.queue, job: failure.payload.job, failedAt: failure.failedAt })), null, 2));
			},
		}, {
			command: 'report:seed',
			/** Writes only the fixed sample input; never accepts a user-controlled file path. */
			async run() {
				await application.storage.write('sources/weekly-v1.txt', 'Three notes ready');
				console.log('Sample source ready: sources/weekly-v1.txt');
			},
		}],
	};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const application = new App({
		queue: { driver: 'database', queue: 'reports' },
		storage: { disks: { local: { driver: 'local', root: resolve(process.env.REPORT_STORAGE_ROOT || 'data/queue-reports') } } },
	});
	try {
		await runQueueConsole(reportConsoleOptions(application));
	} catch (error) {
		await application.close();
		throw error;
	}
}
