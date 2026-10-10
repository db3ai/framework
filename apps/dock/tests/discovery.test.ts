import { spawn, type ChildProcess } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Dock } from '../server/Dock.js';
import { npmRunLeaders, parseElapsed, parseLsofNames, parsePs, type ExternalProcess } from '../server/processes/listExternalProcesses.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

describe('outside-job parsing', () => {
	it('keeps only npm run group leaders', () => {
		const rows = parsePs([
			'64240 64240    03:12 npm run queue   ',
			'64293 64240    03:11 npm run queue:work      ',
			'64353 64240    03:11 queue-worker     ',
			'53756 53699 01-02:03:04 npm run server:dev   ',
			'59625 59625    10:00 npm run dev:scout',
		].join('\n'));
		expect(npmRunLeaders(rows).map(row => [row.pid, row.script])).toEqual([[64240, 'queue'], [59625, 'dev:scout']]);
		expect(rows[3]!.elapsedMs).toBe(((26 * 60 + 3) * 60 + 4) * 1000);
	});

	it('parses elapsed times and lsof fields', () => {
		expect(parseElapsed('05')).toBe(5000);
		expect(parseElapsed('01:05')).toBe(65000);
		expect(parseElapsed('2-00:00:01')).toBe((2 * 86400 + 1) * 1000);
		expect(parseLsofNames('p1\nfcwd\nn/Users/a\np2\nn*:5173\nn127.0.0.1:4000\n')).toEqual(new Map([[1, ['/Users/a']], [2, ['*:5173', '127.0.0.1:4000']]]));
	});
});

describe('Dock.discover', () => {
	let fixture: FixtureProject;
	let dock: Dock;
	let jobs: ExternalProcess[];
	const started: ChildProcess[] = [];

	/** Starts a long-running job the way a terminal would: its own process group, not a Dock child. */
	function startOutsideJob(): ChildProcess {
		const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: fixture.path, detached: true, stdio: 'ignore' });
		started.push(child);
		return child;
	}

	beforeEach(async () => {
		fixture = await createFixtureProject();
		jobs = [];
		dock = new Dock(new ProjectStore(fixture.configFile), { sampleEveryMs: 0, discoverEveryMs: 0, process: { killAfterMs: 2000 }, scan: async () => ({ jobs, ports: new Map() }), listProxies: async () => [] });
		await dock.open();
	});

	afterEach(async () => {
		await dock.close();
		for (const child of started.splice(0)) {
			try {
				process.kill(-child.pid!, 'SIGKILL');
			} catch {
				// Already stopped by the test.
			}
		}
		await fixture.dispose();
	});

	function snapshot(id: string) {
		return dock.state().processes.find(process => process.id === id)!;
	}

	it('shows a job started outside Dock as its matching process', async () => {
		const project = await dock.addProject(fixture.path);
		const queue = project.processes.find(process => process.script === 'queue')!;
		const job = startOutsideJob();
		jobs = [{ pid: job.pid!, script: 'queue', cwd: fixture.path, startedAt: Date.now() - 60_000, ports: [] }];
		await dock.discover();

		expect(snapshot(queue.id)).toMatchObject({ status: 'running', pid: job.pid, external: true });
		expect(dock.output(queue.id).map(chunk => chunk.data).join('')).toContain('Found running outside Dock');
		// Starting again does not run a duplicate.
		dock.start(queue.id);
		expect(snapshot(queue.id).pid).toBe(job.pid);

		jobs = [];
		await dock.discover();
		expect(snapshot(queue.id)).toMatchObject({ status: 'stopped', external: false });
	});

	it('adds a session-only entry for an extra worker and removes it when it ends', async () => {
		const project = await dock.addProject(fixture.path);
		const first = startOutsideJob();
		const second = startOutsideJob();
		jobs = [
			{ pid: first.pid!, script: 'queue', cwd: fixture.path, startedAt: Date.now(), ports: [] },
			{ pid: second.pid!, script: 'queue', cwd: fixture.path, startedAt: Date.now(), ports: [] },
		];
		await dock.discover();
		const queues = dock.store.get(project.id).processes.filter(process => process.script === 'queue');
		expect(queues).toHaveLength(2);
		expect(queues[1]).toMatchObject({ saved: false, discovered: true });
		expect(queues.map(process => snapshot(process.id).pid).sort()).toEqual([first.pid, second.pid].sort());

		jobs = [jobs[0]!];
		await dock.discover();
		expect(dock.store.get(project.id).processes.filter(process => process.script === 'queue')).toHaveLength(1);
	});

	it('ignores jobs in other folders and its own children', async () => {
		const project = await dock.addProject(fixture.path);
		const dev = project.processes.find(process => process.script === 'dev')!;
		dock.start(dev.id);
		const ownPid = snapshot(dev.id).pid!;
		jobs = [
			{ pid: ownPid, script: 'dev', cwd: fixture.path, startedAt: Date.now(), ports: [] },
			{ pid: 999999, script: 'queue', cwd: fixture.root, startedAt: Date.now(), ports: [] },
		];
		await dock.discover();
		expect(snapshot(dev.id).external).toBe(false);
		const queue = project.processes.find(process => process.script === 'queue')!;
		expect(snapshot(queue.id).status).toBe('stopped');
	});

	it('stops an outside job, or restarts it inside Dock', async () => {
		const project = await dock.addProject(fixture.path);
		const dev = project.processes.find(process => process.script === 'dev')!;
		const job = startOutsideJob();
		jobs = [{ pid: job.pid!, script: 'dev', cwd: fixture.path, startedAt: Date.now(), ports: [8045] }];
		await dock.discover();
		expect(snapshot(dev.id).port).toBe(8045);

		await dock.restart(dev.id);
		expect(job.exitCode !== null || job.signalCode !== null).toBe(true);
		expect(snapshot(dev.id)).toMatchObject({ status: 'running', external: false });
		expect(snapshot(dev.id).pid).not.toBe(job.pid);
		expect(dock.output(dev.id).map(chunk => chunk.data).join('')).toContain('Restarting inside Dock…');

		await dock.stop(dev.id);
		const other = startOutsideJob();
		jobs = [{ pid: other.pid!, script: 'dev', cwd: fixture.path, startedAt: Date.now(), ports: [] }];
		await dock.discover();
		await dock.stop(dev.id);
		expect(snapshot(dev.id)).toMatchObject({ status: 'stopped', external: false });
	});

	it('leaves outside jobs running when Dock closes', async () => {
		const project = await dock.addProject(fixture.path);
		const job = startOutsideJob();
		jobs = [{ pid: job.pid!, script: 'queue', cwd: fixture.path, startedAt: Date.now(), ports: [] }];
		await dock.discover();
		await dock.close();
		expect(() => process.kill(job.pid!, 0)).not.toThrow();
		expect(project.id).toBeTruthy();
	});
});
