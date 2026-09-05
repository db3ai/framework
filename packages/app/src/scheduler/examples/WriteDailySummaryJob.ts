import { QueueableJob } from '@db3.ai/app/queue';
import { app } from '@db3.ai/app/server';

/** A small application job showing scheduled work performed by the queue. */
export class WriteDailySummaryJob extends QueueableJob {
	static readonly jobName = 'write-daily-summary';

	/** Creates a zero-argument job with a serializable empty payload. */
	constructor() {
		super({});
	}

	/** Writes a replaceable summary; repeated attempts do not append duplicates. */
	async handle(): Promise<void> {
		await app().storage.write('reports/latest.txt', 'Daily summary ready');
	}
}
