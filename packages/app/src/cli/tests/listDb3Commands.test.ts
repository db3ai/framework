import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cli, listDb3Commands } from '@db3.ai/app/cli';

describe('visual command discovery', () => {
	it('returns detached serializable metadata without creating an app', async () => {
		const runner = new Cli({ createApp: () => { throw new Error('Must not boot'); }, commands: [{ name: 'test:run', description: 'Test', arguments: [{ name: 'value', required: true }], run() {} }] });
		const commands = runner.commands();
		expect(commands).toEqual([{ name: 'test:run', description: 'Test', arguments: [{ name: 'value', required: true }], interactive: false }]);
		commands[0]!.name = 'changed';
		expect(runner.commands()[0]!.name).toBe('test:run');
	});

	it('loads app and built-in descriptions, reports invalid registries and does not bootstrap', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-catalog-'));
		try {
			await mkdir(join(directory, 'server'));
			await writeFile(join(directory, 'server/cli.config.mjs'), `export default { createApp() { throw new Error('Must not boot'); }, commands: [{ name: 'demo:inspect', description: 'Inspect', run() {} }] };`);
			const commands = await listDb3Commands({ directory });
			expect(commands.map(command => command.name)).toEqual(['repl', 'queue:make-job', 'demo:inspect']);
			expect(commands[0]!.interactive).toBe(true);
			await writeFile(join(directory, 'server/cli.config.mjs'), 'export default {};');
			await expect(listDb3Commands({ directory })).rejects.toThrow('commands array');
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
});
