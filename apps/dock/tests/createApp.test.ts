import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripAnsi } from '../shared/ansi.js';
import { Dock } from '../server/Dock.js';
import { generateApp, setupCommand } from '../server/projects/createApp.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';

let folder: string;
let dock: Dock;

beforeEach(async () => {
	folder = await mkdtemp(join(tmpdir(), 'dock-create-'));
	dock = new Dock(new ProjectStore(join(folder, 'dock.json')), { sampleEveryMs: 0, discoverEveryMs: 0, scan: async () => ({ jobs: [], ports: new Map() }), listProxies: async () => [], readBranch: async () => null });
	await dock.open();
});

afterEach(async () => {
	await dock.close();
	await rm(folder, { recursive: true, force: true });
});

async function until(check: () => boolean, ms = 15000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('Timed out waiting for condition.');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

describe('create app', () => {
	it('generates the starter with create-db3 and adds the processes from its app profile', async () => {
		const { project, setupProcessId } = await dock.createApp({ name: 'fresh-app', folder, database: 'docker', setup: false });
		expect(project.path).toBe(join(folder, 'fresh-app'));
		expect(project.name).toBe('fresh-app');
		expect(project.processes.map(process => [process.name, process.script])).toEqual([['web', 'dev'], ['queue', 'queue'], ['scheduler', 'scheduler']]);
		expect(JSON.parse(await readFile(join(project.path, 'db3.app.json'), 'utf8')).name).toBe('fresh-app');
		expect(setupProcessId).toBeNull();
		expect(JSON.parse(await readFile(join(project.path, 'package.json'), 'utf8')).name).toBe('fresh-app');
		// --docker gives the bundled database a generated password.
		expect(await readFile(join(project.path, '.env'), 'utf8')).toMatch(/DB_PORT=33067/);
		expect(existsSync(join(project.path, 'node_modules'))).toBe(false);
	}, 60000);

	it('rejects bad names, missing folders and existing targets before running create-db3', async () => {
		await expect(generateApp('My App', folder, 'local')).rejects.toThrow(/lowercase letter/);
		await expect(generateApp('ok', join(folder, 'missing'), 'local')).rejects.toThrow(/is not a folder/);
		await generateApp('taken', folder, 'local');
		await expect(generateApp('taken', folder, 'local')).rejects.toThrow(/already exists/);
	}, 60000);

	it('starts a session-only setup terminal that waits for the local database', async () => {
		const { project, setupProcessId } = await dock.createApp({ name: 'setup-app', folder, database: 'local', setup: true });
		const setup = project.processes.find(process => process.id === setupProcessId)!;
		expect(setup).toMatchObject({ name: 'setup', saved: false, command: setupCommand('local') });
		const output = () => stripAnsi(dock.output(setupProcessId!).map(chunk => chunk.data).join(''));
		// Under Node 22 the terminal stops at the Node 24 check instead of the prompt.
		const nodeOk = Number(process.versions.node.split('.')[0]) >= 24;
		await until(() => output().includes(nodeOk ? 'Press Enter' : 'need Node 24 or newer'));
		expect(dock.state().processes.find(process => process.id === setupProcessId)!.command).toMatch(/^\/bin\/sh -c/);
		if (nodeOk) await dock.stop(setupProcessId!);
		const saved = JSON.parse(await readFile(join(folder, 'dock.json'), 'utf8'));
		expect(saved.projects[0].processes.some((process: { name: string }) => process.name === 'setup')).toBe(false);
	}, 60000);
});
