import 'dotenv/config';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Cli, defineCommand } from '@db3.ai/app/cli';
import { App, app } from '@db3.ai/app/server';
import { createQueueCommands } from '@db3.ai/app/queue/commands';
import { WriteReportJob } from './WriteReportJob';

/**
 * Composes a report CLI using the framework's declared queue commands and worker alias.
 * @param createApplication - Lazy application factory with migrated queue tables and report storage.
 * @returns Embedded runner that owns one application and awaits worker drain before closing it.
 */
export function createReportCli(createApplication: () => App): Cli {
	return new Cli({
		createApp: createApplication,
		/** Registers report work only when an operational queue command requests preparation. */
		prepareApp(application) { application.queue.registerJob(WriteReportJob); },
		commands: [...createQueueCommands({ workers: { reports: { queues: ['reports'] } } }), defineCommand({
			name: 'report:seed', description: 'Write the fixed sample report input.',
			/** Uses the same ordinary storage operation as a non-console caller. */
			async handle() { await app().storage.write('sources/weekly-v1.txt', 'Three notes ready'); return 'Sample source ready.'; },
		})],
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const runner = createReportCli(() => new App({
		queue: { driver: 'database' },
		storage: { disks: { local: { driver: 'local', root: resolve(process.env.REPORT_STORAGE_ROOT || 'data/queue-reports') } } },
	}));
	process.exitCode = await runner.run(process.argv.slice(2));
}
