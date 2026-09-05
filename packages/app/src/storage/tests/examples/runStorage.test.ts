import { expect, it } from 'vitest';
import { runStorage } from '../../examples/runStorage';

it('runs the storage guide on a real isolated local disk', async () => {
	expect(await runStorage()).toEqual({
		report: { status: 'ready' }, csv: 'name\nAda\n',
		files: ['reports/export.csv', 'reports/latest.json'],
		traversalRejected: true, deleted: true,
	});
});
