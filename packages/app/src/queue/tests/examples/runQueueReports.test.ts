import { expect, it } from 'vitest';
import { runQueueReports } from '../../examples/runQueueReports';
import { WriteReportJob } from '../../examples/WriteReportJob';
import expected from '../../examples/outputs/queue-reports.json';

it('restores SQL work in a new App, repairs a failure, drains a worker and avoids duplicate output', async () => {
	expect(await runQueueReports()).toEqual(expected);
});

it('rejects unsafe report identities when constructing or restoring a job', () => {
	for (const reportId of ['', '../secret', '/absolute', 'A'.repeat(65)]) {
		expect(() => new WriteReportJob({ reportId })).toThrow('reportId');
		expect(() => WriteReportJob.fromJSON({ reportId })).toThrow('reportId');
	}
});
