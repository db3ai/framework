import { readFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DockEvent, ProcessSnapshot } from '../shared/contracts.js';
import { stripAnsi } from '../shared/ansi.js';
import { Dock } from '../server/Dock.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { scanQueueTopology } from '../server/projects/scanQueueTopology.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

let fixture: FixtureProject;
let dock: Dock;
let events: DockEvent[];

beforeEach(async () => {
	fixture = await createFixtureProject();
	dock = new Dock(new ProjectStore(fixture.configFile), { sampleEveryMs: 0, discoverEveryMs: 0, scan: async () => ({ jobs: [], ports: new Map() }), listProxies: async () => [], process: { killAfterMs: 2000 } });
	await dock.open();
	events = [];
	dock.subscribe(event => events.push(event));
});

afterEach(async () => {
	await dock.close();
	await fixture.dispose();
});

function snapshot(id: string): ProcessSnapshot {
	return dock.state().processes.find(process => process.id === id)!;
}

async function until(check: () => boolean, ms = 15000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('Timed out waiting for condition.');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
}

function text(id: string): string {
	return stripAnsi(dock.output(id).map(chunk => chunk.data).join(''));
}

describe('Dock', () => {
	it('adds a project with its conventional scripts and persists it', async () => {
		const project = await dock.addProject(fixture.path);
		expect(project.name).toBe('demo-app');
		expect(project.processes.map(process => [process.name, process.kind, process.args])).toEqual([
			['dev', 'web', []],
			['queue', 'queue', ['queue:work']],
			['scheduler', 'scheduler', []],
		]);
		expect(events.some(event => event.type === 'state')).toBe(true);

		const saved = JSON.parse(await readFile(fixture.configFile, 'utf8'));
		expect(saved.projects[0].path).toBe(fixture.path);
		expect(saved.projects[0].processes).toHaveLength(3);

		const reopened = new ProjectStore(fixture.configFile);
		await reopened.load();
		expect(reopened.list()[0]!.processes.every(process => process.saved)).toBe(true);
		expect(await dock.addProject(fixture.path)).toEqual(project);
	});

	it('rejects folders without a package.json', async () => {
		await expect(dock.addProject(fixture.root)).rejects.toThrow(/package\.json/);
	});

	it('runs a script, detects its port, forwards stdin and stops the process group', async () => {
		const project = await dock.addProject(fixture.path);
		const dev = project.processes.find(process => process.script === 'dev')!;
		dock.start(dev.id);
		await until(() => snapshot(dev.id).port === 45173);
		expect(snapshot(dev.id).status).toBe('running');
		expect(snapshot(dev.id).pid).toBeGreaterThan(0);

		// A terminal sends Enter as a carriage return.
		dock.write(dev.id, 'hello\r');
		expect(text(dev.id)).toContain('tty:true cols:120');
		dock.resize(dev.id, 90, 20);
		await until(() => text(dev.id).includes('resize:90x20'));
		await until(() => text(dev.id).includes('echo:hello'));
		expect(events.some(event => event.type === 'output' && event.processId === dev.id)).toBe(true);

		await dock.stop(dev.id);
		expect(snapshot(dev.id)).toMatchObject({ status: 'stopped', pid: null, port: null });

		// Ctrl-C typed into the terminal interrupts it: stopped, not crashed.
		dock.start(dev.id);
		await until(() => snapshot(dev.id).port === 45173);
		dock.write(dev.id, '\u0003');
		await until(() => snapshot(dev.id).status !== 'running');
		expect(snapshot(dev.id).status).toBe('stopped');
		expect(text(dev.id)).toContain('Interrupted.');
		expect(text(dev.id)).toContain('Stopped.');
	});

	it('marks a failing process as crashed with its exit code', async () => {
		const project = await dock.addProject(fixture.path);
		const queue = project.processes.find(process => process.script === 'queue')!;
		dock.start(queue.id);
		await until(() => snapshot(queue.id).status === 'crashed');
		expect(snapshot(queue.id).exitCode).toBe(1);
		expect(text(queue.id)).toContain('args:queue:work');
		expect(text(queue.id)).toContain('boom');
		expect(text(queue.id)).toContain('Exited with code 1.');
	});

	it('adds several session-only workers and starts them', async () => {
		const project = await dock.addProject(fixture.path);
		const added = await dock.addProcesses(project.id, {
			script: 'queue',
			args: ['queue:work', '--queues=emails'],
			name: 'queue · emails',
			kind: 'queue',
			count: 2,
			save: false,
			start: true,
		});
		expect(added).toHaveLength(2);
		const names = dock.store.get(project.id).processes.slice(-2).map(process => process.name);
		expect(names).toEqual(['queue · emails #1', 'queue · emails #2']);
		await until(() => added.every(process => snapshot(process.id).status === 'crashed'));
		expect(text(added[0]!.id)).toContain('args:queue:work --queues=emails');

		const saved = JSON.parse(await readFile(fixture.configFile, 'utf8'));
		expect(saved.projects[0].processes).toHaveLength(3);

		await dock.removeProcess(added[0]!.id);
		expect(dock.state().processes.some(process => process.id === added[0]!.id)).toBe(false);
	});

	it('restarts a running process', async () => {
		const project = await dock.addProject(fixture.path);
		const dev = project.processes.find(process => process.script === 'dev')!;
		dock.start(dev.id);
		await until(() => snapshot(dev.id).port !== null);
		const firstPid = snapshot(dev.id).pid;
		await dock.restart(dev.id);
		await until(() => snapshot(dev.id).port !== null);
		expect(snapshot(dev.id).status).toBe('running');
		expect(snapshot(dev.id).pid).not.toBe(firstPid);
		expect(text(dev.id)).toContain('Restarting…');
	});

	it('stops everything on close', async () => {
		const project = await dock.addProject(fixture.path);
		await dock.projectAction(project.id, 'start');
		const dev = project.processes.find(process => process.script === 'dev')!;
		await until(() => snapshot(dev.id).port !== null);
		await dock.close();
		expect(snapshot(dev.id).status).toBe('stopped');
	});
});

describe('scanQueueTopology', () => {
	it('finds literal queue names and worker pools', async () => {
		expect(await scanQueueTopology(fixture.path)).toEqual({
			queues: ['default', 'article-images', 'articles', 'emails', 'reports'],
			pools: ['content', 'general'],
		});
	});
});
