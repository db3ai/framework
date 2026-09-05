import { app } from '@db3.ai/app/server';
import { QueueableJob } from '@db3.ai/app/queue';

/**
 * Durable data required to generate one application report.
 */
export interface GenerateReportJobData extends Record<string, unknown> {
	/** Stable application-owned report identifier. */
	reportId: string;
}

/**
 * Example application job restored from its JSON-safe queue payload.
 */
export class GenerateReportJob extends QueueableJob<GenerateReportJobData> {
	/**
	 * Creates a report job after validating its durable payload.
	 *
	 * @param data - Report identity persisted with the queued job.
	 */
	constructor(data: GenerateReportJobData) {
		if (typeof data.reportId !== 'string' || data.reportId.trim() === '') {
			throw new Error('GenerateReportJob requires a report id.');
		}

		super(data);
	}

	/**
	 * Generates the report through services resolved from the active application.
	 */
	async handle(): Promise<void> {
		app().log.info({
			reportId: this.data.reportId,
		}, 'Generating report');
	}
}
