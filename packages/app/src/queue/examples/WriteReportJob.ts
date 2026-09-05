import { QueueableJob } from '@db3.ai/app/queue';
import { app } from '@db3.ai/app/server';

/** Immutable report revision selected and authorized by the application. */
export interface WriteReportData extends Record<string, unknown> {
	/** Safe storage identifier, including a revision when the source can change. */
	reportId: string;
}

/** Rebuilds a local report without appending duplicate output on another attempt. */
export class WriteReportJob extends QueueableJob<WriteReportData> {
	static readonly jobName = 'reports.write.v1';

	/**
	 * Validates both newly dispatched and restored payloads.
	 *
	 * @param data - Trusted report identity; never a caller-supplied storage path.
	 */
	constructor(data: WriteReportData) {
		if (!data || typeof data.reportId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(data.reportId)) {
			throw new Error('reportId must contain 1–64 lowercase letters, digits or hyphens, starting with a letter or digit.');
		}
		super(data);
	}

	/**
	 * Reads the immutable source and replaces the report at its stable destination.
	 *
	 * Missing source bytes throw normally, allowing Queue to apply its retry policy.
	 * Replacement is repeatable, not an atomic file/database transaction or a
	 * substitute for provider idempotency when sending mail or charging money.
	 */
	async handle(): Promise<void> {
		const source = await app().storage.readToString(`sources/${this.data.reportId}.txt`);
		await app().storage.write(`reports/${this.data.reportId}.txt`, `Report: ${source.trim()}\n`);
	}
}
