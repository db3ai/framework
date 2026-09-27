import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { Log } from '@db3.ai/app/logging';

it('retains structured raw errors in a file with console disabled and closes its transport', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'db3-logs-'));
	const file = join(directory, 'nested', 'app.jsonl');
	const log = new Log({ file, console: false, devtools: false, level: 'info' });
	try {
		log.error({ err: new Error('Provider failed'), password: 'must-not-appear', incidentKey: 'failure:123' }, 'Job failed');
		await log.close();
		const record = JSON.parse((await readFile(file, 'utf8')).trim());
		expect(record).toMatchObject({ incidentKey: 'failure:123', err: { message: 'Provider failed', stack: expect.stringContaining('Provider failed') } });
		expect(record.password).toBeUndefined();
	} finally {
		await log.close();
		await rm(directory, { recursive: true, force: true });
	}
});
