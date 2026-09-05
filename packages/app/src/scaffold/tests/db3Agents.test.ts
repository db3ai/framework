import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const commandPath = fileURLToPath(new URL('../../../bin/db3-agents.mjs', import.meta.url));

describe('db3-agents', () => {
	it('creates an idempotent root instruction scaffold', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-agents-create-'));
		const target = join(directory, 'AGENTS.md');

		expect(runScaffold(directory).status).toBe(0);
		const created = await readFile(target, 'utf8');

		expect(created).toContain('<!-- @db3.ai/app:start -->');
		expect(created).toContain("require.resolve('@db3.ai/app/agent-instructions')");

		expect(runScaffold(directory).status).toBe(0);
		expect(await readFile(target, 'utf8')).toBe(created);
		expect(runScaffold(directory, '--check').status).toBe(0);
	});

	it('preserves project guidance while appending and updating the marked block', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-agents-merge-'));
		const target = join(directory, 'AGENTS.md');

		await writeFile(target, '# Product instructions\n\n- Keep product policy local.\n', 'utf8');

		expect(runScaffold(directory).status).toBe(0);
		const merged = await readFile(target, 'utf8');

		expect(merged).toContain('# Product instructions');
		expect(merged).toContain('<!-- @db3.ai/app:start -->');

		await writeFile(
			target,
			merged.replace('This application uses `@db3.ai/app`.', 'Stale framework guidance.'),
			'utf8',
		);

		expect(runScaffold(directory, '--update').status).toBe(0);
		const updated = await readFile(target, 'utf8');

		expect(updated).toContain('# Product instructions');
		expect(updated).toContain('This application uses `@db3.ai/app`.');
		expect(updated).not.toContain('Stale framework guidance.');
	});
});

/**
 * Runs the installed-agent scaffold command against an isolated directory.
 *
 * @param directory - Temporary consumer-project root.
 * @param args - Optional scaffold command arguments.
 * @returns Completed child-process result.
 */
function runScaffold(directory: string, ...args: string[]) {
	return spawnSync(
		process.execPath,
		[
			commandPath,
			...args,
		],
		{
			cwd: directory,
			encoding: 'utf8',
		},
	);
}
