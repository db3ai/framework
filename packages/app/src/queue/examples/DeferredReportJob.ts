import { QueueableJob, QueueRetryLaterError } from '@db3.ai/app/queue';
import { app } from '@db3.ai/app/server';

/** Durable application deadline, independent of Queue's ordinary retry policy. */
export interface DeferredReportData extends Record<string, unknown> {
	/** Epoch milliseconds after which this report must fail instead of deferring. */
	deadline: number;
}

/** Demonstrates controlled provider backpressure without contacting a real API. */
export class DeferredReportJob extends QueueableJob<DeferredReportData> {
	static readonly jobName = 'reports.defer-example.v1';
	/** Validates the durable deadline on both producer and worker construction. */
	constructor(data: DeferredReportData) {
		if (!data || !Number.isSafeInteger(data.deadline) || data.deadline < 1) throw new Error('A positive deadline in epoch milliseconds is required.');
		super(data);
	}
	/** Applies the application deadline before retry-later can restore an attempt. */
	async handle(): Promise<void> {
		if (Date.now() >= this.data.deadline) throw new Error('Report deadline expired.');
		if (!app().config.get<{ ready: boolean }>('reportProvider')?.ready) throw new QueueRetryLaterError(0, 'Controlled provider backpressure.');
		// Real provider success would produce a result here. This lab has no charge,
		// HTTP request or irreversible side effect, so repeated handling is safe.
	}
}
