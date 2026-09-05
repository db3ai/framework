import { QueueableJob } from '@db3.ai/app/queue';
import { app } from '@db3.ai/app/server';

/** A scheduled report whose missing local input can be repaired before replay. */
export class RecoverableSummaryJob extends QueueableJob {
	static readonly jobName = 'recoverable-summary';

	/** Creates a durable empty payload; the app owns the source location. */
	constructor() {
		super({});
	}

	/** Reads the source before replacing output so failed reads cannot overwrite it. */
	async handle(): Promise<void> {
		const source = await app().storage.readToString('summary-source.txt');
		await app().storage.write('reports/recovered.txt', `Summary: ${source.trim()}`);
	}
}
