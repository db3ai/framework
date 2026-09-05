import { expect, it } from 'vitest';
import { runNoteLogs } from '../../examples/runNoteLogs';

it('preserves structured context and errors while filtering levels and removing selected secrets', async () => {
	const records = await runNoteLogs();
	expect(records).toHaveLength(3);
	expect(records[0]).toMatchObject({ source: 'notes', environment: 'test', requestId: 'request-1', ownerId: 'ada', noteId: 'one', msg: 'Note saved', level: 30, integration: {} });
	expect(records[1]).toMatchObject({ msg: 'Summary failed', level: 50, err: { type: 'Error', message: 'Summary unavailable' } });
	expect(records[2]).toMatchObject({ msg: 'Diagnostics enabled', level: 20 });
	expect(JSON.stringify(records)).not.toMatch(/test-password|test-provider-key|test-token|Filtered diagnostic|Filtered after disabling/);
});
