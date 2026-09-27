import { expect, it } from 'vitest';
import { runTextFlow } from '../../examples/runTextFlow';

it('runs a persisted graph, captures safe progress and repairs failed work through explicit replay', async () => {
	expect(await runTextFlow()).toEqual({ status: 'completed', output: { text: 'CLIENT NOTE' }, steps: 2, logged: true, failure: 'failed', failureMessage: 'Note text cannot be blank.', repaired: { text: 'FIXED NOTE' }, latest: { text: 'Updated: CLIENT NOTE' }, replayLinked: true });
}, 30_000);
