import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DockEvent, GitBranch } from '../shared/contracts.js';
import { Dock } from '../server/Dock.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { parseHead, readGitBranch } from '../server/projects/readGitBranch.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('parseHead', () => {
	it('reads a branch, including one with slashes', () => {
		expect(parseHead('ref: refs/heads/main\n')).toEqual({ name: 'main', detached: false });
		expect(parseHead('ref: refs/heads/claude/dock-git-branch\n')).toEqual({ name: 'claude/dock-git-branch', detached: false });
	});

	it('shortens a detached commit and ignores anything else', () => {
		expect(parseHead(`${SHA}\n`)).toEqual({ name: '0123456', detached: true });
		expect(parseHead('garbage')).toBeNull();
	});
});

describe('readGitBranch', () => {
	let fixture: FixtureProject;

	beforeEach(async () => {
		fixture = await createFixtureProject();
	});

	afterEach(async () => {
		await fixture.dispose();
	});

	it('returns null outside a git repository', async () => {
		expect(await readGitBranch(fixture.path)).toBeNull();
	});

	it('finds the repository from a nested project folder', async () => {
		await mkdir(join(fixture.root, '.git'));
		await writeFile(join(fixture.root, '.git', 'HEAD'), 'ref: refs/heads/feature/x\n');
		expect(await readGitBranch(join(fixture.path, 'server'))).toEqual({ name: 'feature/x', detached: false });
	});

	it('follows a worktree gitdir pointer', async () => {
		const worktreeGit = join(fixture.root, 'main-repo', '.git', 'worktrees', 'demo');
		await mkdir(worktreeGit, { recursive: true });
		await writeFile(join(worktreeGit, 'HEAD'), 'ref: refs/heads/review\n');
		await writeFile(join(fixture.path, '.git'), 'gitdir: ../main-repo/.git/worktrees/demo\n');
		expect(await readGitBranch(fixture.path)).toEqual({ name: 'review', detached: false });
	});
});

describe('Dock branches', () => {
	let fixture: FixtureProject;
	let dock: Dock;
	let events: DockEvent[];
	let branch: GitBranch | null;

	beforeEach(async () => {
		fixture = await createFixtureProject();
		branch = { name: 'main', detached: false };
		dock = new Dock(new ProjectStore(fixture.configFile), {
			sampleEveryMs: 0,
			discoverEveryMs: 0,
			scan: async () => ({ jobs: [], ports: new Map() }),
			listProxies: async () => [],
			readBranch: async () => branch,
		});
		await dock.open();
		events = [];
		dock.subscribe(event => events.push(event));
	});

	afterEach(async () => {
		await dock.close();
		await fixture.dispose();
	});

	it('includes each project branch in state and broadcasts a checkout', async () => {
		const project = await dock.addProject(fixture.path);
		expect(dock.state().branches).toEqual({ [project.id]: { name: 'main', detached: false } });

		events = [];
		await dock.discover();
		expect(events.some(event => event.type === 'branches')).toBe(false);

		branch = { name: 'review', detached: false };
		await dock.discover();
		expect(events).toContainEqual({ type: 'branches', branches: { [project.id]: { name: 'review', detached: false } } });
	});
});
