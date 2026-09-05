import { expect, it } from 'vitest';
import { runQueueWorkflows } from '../../examples/runQueueWorkflows';

it('rejects an empty chain, then processes sequential and independent jobs on real SQL', async () => {
	expect(await runQueueWorkflows()).toEqual({
		invalidRejected: true, afterInvalid: 0, chainInitial: 1, chainRemaining: 1,
		batchInitial: 2, batchIds: 2, statuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded'], remaining: 0,
	});
});
