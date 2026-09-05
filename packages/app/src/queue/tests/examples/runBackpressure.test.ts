import { expect, it } from 'vitest';
import { runBackpressure } from '../../examples/runBackpressure';

it('defers without spending a try, recovers when ready and stops at the app deadline', async () => {
	expect(await runBackpressure()).toEqual({ first: 'deferred', second: 'deferred', attemptsAfterDeferral: 0, recovered: 'succeeded', expired: 'failed', remainingJobs: 0, failures: 1 });
});
