import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OutputChunk, ProcessSnapshot, ProjectDefinition } from '../shared/contracts.js';
import { filterProjects } from '../client/dock/filterProjects.js';
import { mergeChunks } from '../client/dock/mergeChunks.js';
import { formatDuration, initials, statusOf } from '../client/dock/presentation.js';
import { projectNav } from '../client/dock/projectNav.js';
import { isDesktopShell } from '../client/dock/useDesktop.js';

const api = vi.hoisted(() => ({
	dockApi: {
		scripts: vi.fn(),
		queues: vi.fn(),
		addProcesses: vi.fn(),
	},
}));
vi.mock('../client/api.js', () => api);

const { useAddProcess } = await import('../client/dock/useAddProcess.js');

function chunk(seq: number, data = `c${seq}`): OutputChunk {
	return { seq, data };
}

function snap(id: string, status: ProcessSnapshot['status']): ProcessSnapshot {
	return { id, projectId: 'p', status, pid: null, startedAt: null, exitCode: status === 'crashed' ? 1 : null, port: null, cpu: null, memory: null, command: '', external: false, ports: [] };
}

const projects: ProjectDefinition[] = [
	{ id: 'scout', name: 'Scout', path: '/s', processes: [
		{ id: 'a', name: 'api', script: 'api', args: [], kind: 'api', saved: true },
		{ id: 'q', name: 'queue', script: 'queue', args: ['queue:work'], kind: 'queue', saved: true },
	] },
	{ id: 'site', name: 'steve-obrien.com', path: '/w', processes: [
		{ id: 'd', name: 'dev', script: 'dev', args: [], kind: 'web', saved: true },
	] },
];

describe('mergeChunks', () => {
	it('appends in order, de-duplicates out-of-order deliveries and caps by size', () => {
		const first = mergeChunks([], [chunk(3), chunk(4)]);
		const merged = mergeChunks(first, [chunk(1), chunk(2), chunk(3)]);
		expect(merged.map(item => item.seq)).toEqual([1, 2, 3, 4]);
		expect(mergeChunks(merged, [chunk(5)], 6).map(item => item.seq)).toEqual([3, 4, 5]);
		expect(mergeChunks([], [chunk(1, 'x'.repeat(50))], 10)).toHaveLength(1);
		expect(mergeChunks(merged, [])).toBe(merged);
	});
});

describe('projectNav and filterProjects', () => {
	it('summarises health per project and overall', () => {
		const snapshots = new Map([['a', snap('a', 'running')], ['q', snap('q', 'crashed')], ['d', snap('d', 'running')]]);
		const nav = projectNav(projects, snapshots);
		expect(nav.map(item => [item.id, item.running, item.total, item.health])).toEqual([
			['all', 2, 3, 'bad'],
			['scout', 1, 2, 'bad'],
			['site', 1, 1, 'ok'],
		]);
		expect(nav[2]!.initials).toBe('SO');
	});

	it('scopes to a project and matches processes by text', () => {
		expect(filterProjects(projects, 'site', '').map(project => project.id)).toEqual(['site']);
		const queues = filterProjects(projects, 'all', 'queue:work');
		expect(queues).toHaveLength(1);
		expect(queues[0]!.processes.map(process => process.id)).toEqual(['q']);
	});
});

describe('presentation', () => {
	it('formats status and durations', () => {
		expect(statusOf({ ...snap('a', 'running'), startedAt: 0 }, 3 * 3600_000 + 12 * 60_000).label).toBe('Running · 3h 12m');
		expect(statusOf(snap('q', 'crashed'), 0)).toEqual({ label: 'Exited (1)', tone: 'bad' });
		expect(formatDuration(26 * 3600_000)).toBe('1d 2h');
		expect(initials('Scout')).toBe('S');
		expect(initials('db3.ai')).toBe('D');
	});
});

describe('useAddProcess', () => {
	afterEach(() => vi.clearAllMocks());

	it('loads scripts and queues, builds the worker command and ignores stale projects', async () => {
		let resolveSlow!: (value: unknown) => void;
		api.dockApi.scripts
			.mockImplementationOnce(() => new Promise(resolve => (resolveSlow = resolve)))
			.mockResolvedValueOnce({ scripts: [
				{ name: 'queue', body: 'tsx server/queue.ts', kind: 'queue' },
				{ name: 'scheduler', body: 'tsx server/scheduler.ts scheduler:work', kind: 'scheduler' },
			] });
		api.dockApi.queues.mockResolvedValue({ queues: ['default', 'emails', 'reports'], pools: ['general'] });

		const scope = effectScope();
		const project = ref<{ id: string; name: string } | null>({ id: 'old', name: 'Old' });
		const add = scope.run(() => useAddProcess(project))!;
		project.value = { id: 'db3', name: 'db3.ai' };
		await vi.waitFor(() => expect(add.loading.value).toBe(false));
		resolveSlow({ scripts: [] });
		await nextTick();

		expect(add.queueScript.value).toBe('queue');
		add.form.mode = 'queues';
		add.form.picked = [];
		add.toggleQueue('emails');
		add.toggleQueue('reports');
		add.form.count = 2;
		expect(add.command.value).toBe('npm run queue -- queue:work --queues=emails,reports --name=db3-ai-queue-emails-reports');

		add.form.mode = 'all';
		add.toggleQueue('reports');
		expect(add.plan.value?.args).toEqual(['queue:work', '--queues=*', '--exclude-queues=reports', '--name=db3-ai-queue-all']);

		add.form.kind = 'scheduler';
		expect(add.command.value).toBe('npm run scheduler');

		add.form.kind = 'queue';
		api.dockApi.addProcesses.mockResolvedValue({ processes: [] });
		expect(await add.submit()).toBe(true);
		expect(api.dockApi.addProcesses).toHaveBeenCalledWith('db3', expect.objectContaining({ script: 'queue', count: 2, kind: 'queue', save: true, start: true }));
		scope.stop();
	});
});

describe('isDesktopShell', () => {
	it('recognises the Electron shell', () => {
		expect(isDesktopShell('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Electron/44.4.5 Safari/537.36')).toBe(true);
		expect(isDesktopShell('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140 Safari/537.36')).toBe(false);
	});
});

describe('splitSizes', () => {
	it('moves the boundary between two panes and keeps their total', async () => {
		const { resizeAdjacent, clampSize } = await import('../client/dock/splitSizes.js');
		expect(resizeAdjacent([400, 400, 400], 0, 100, 240)).toEqual([500, 300, 400]);
		expect(resizeAdjacent([400, 400, 400], 1, -500, 240)).toEqual([400, 240, 560]);
		expect(resizeAdjacent([400, 400], 0, 1000, 240)).toEqual([560, 240]);
		expect(resizeAdjacent([300, 100], 0, -50, 240)).toEqual([200, 200]);
		expect(resizeAdjacent([400, 400], 3, 50, 240)).toEqual([400, 400]);
		expect(clampSize(50, 120, 600)).toBe(120);
		expect(clampSize(900, 120, 600)).toBe(600);
		expect(clampSize(300, 120, 80)).toBe(120);
	});
});
