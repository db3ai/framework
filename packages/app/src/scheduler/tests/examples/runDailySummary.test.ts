import { expect, it } from 'vitest';
import { runDailySummary } from '../../examples/runDailySummary';
import { runScheduledReplay } from '../../examples/runScheduledReplay';

it('runs the scheduler guide with real SQL queue claims and occurrence history', async () => {
	expect(await runDailySummary()).toEqual({
		dispatched: 1, duplicateSkipped: 1, processed: 'succeeded', occurrenceStatus: 'succeeded',
		text: 'Daily summary ready', nextMinuteDue: 0,
	});
});

it('recovers a scheduled job while retaining the original terminal occurrence and failure', async () => {
	expect(await runScheduledReplay()).toEqual({
		originalStatus: 'failed', replacementStatus: 'succeeded', linked: true, newIdentity: true,
		text: 'Summary: Recovered', duplicateSkipped: 1, retainedFailures: 1, activeJobs: 0,
	});
});
