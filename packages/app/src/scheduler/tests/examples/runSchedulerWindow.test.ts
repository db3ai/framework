import { expect, it } from 'vitest';
import { runSchedulerWindow } from '../../examples/runSchedulerWindow';

it('runs the elapsed-window example through real SQL dispatch and execution', async () => {
	expect(await runSchedulerWindow()).toEqual([
		{ name: 'first-summary', scheduledFor: '2026-01-01T09:00:00.000Z', status: 'succeeded' },
		{ name: 'second-summary', scheduledFor: '2026-01-01T09:00:00.000Z', status: 'succeeded' },
		{ name: 'next-summary', scheduledFor: '2026-01-01T09:01:00.000Z', status: 'succeeded' },
	]);
});
