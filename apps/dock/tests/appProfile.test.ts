import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { missingProfileScripts, parseAppProfile } from '../shared/appProfile.js';
import { ProjectStore } from '../server/projects/ProjectStore.js';
import { createFixtureProject, type FixtureProject } from './fixtures/createFixtureProject.js';

describe('parseAppProfile', () => {
	it('fills in defaults and infers missing kinds from the name', () => {
		const profile = parseAppProfile({ version: 1, name: 'demo-app', processes: [{ name: 'web', script: 'start', dev: 'dev' }, { name: 'queue', script: 'queue', args: ['queue:work'] }] });
		expect(profile).toEqual({
			version: 1,
			name: 'demo-app',
			processes: [
				{ name: 'web', kind: 'web', script: 'start', dev: 'dev', args: [] },
				{ name: 'queue', kind: 'queue', script: 'queue', args: ['queue:work'] },
			],
			env: { required: [], optional: [] },
		});
	});

	it('reads the starter profile', async () => {
		const profile = parseAppProfile(JSON.parse(await readFile(new URL('../../starter/db3.app.json', import.meta.url), 'utf8')));
		expect(profile.processes.map(process => [process.name, process.kind, process.dev ?? process.script])).toEqual([
			['web', 'web', 'dev'],
			['queue', 'queue', 'queue'],
			['scheduler', 'scheduler', 'scheduler'],
		]);
		expect(profile.database).toEqual({ engine: 'mariadb', migrate: 'db:migrate' });
		const starter = JSON.parse(await readFile(new URL('../../starter/package.json', import.meta.url), 'utf8'));
		expect(missingProfileScripts(profile, Object.keys(starter.scripts))).toEqual([]);
	});

	it('names the field at fault', () => {
		expect(() => parseAppProfile({ version: 2 })).toThrow('db3.app.json: "version" must be 1.');
		expect(() => parseAppProfile({ version: 1, name: 'Demo', processes: [] })).toThrow(/"name" must be lower-case/);
		expect(() => parseAppProfile({ version: 1, name: 'demo', processes: [] })).toThrow(/at least one process/);
		expect(() => parseAppProfile({ version: 1, name: 'demo', processes: [{ name: 'web', script: 'start', port: 0 }] })).toThrow(/"processes\[0\].port"/);
		expect(() => parseAppProfile({ version: 1, name: 'demo', processes: [{ name: 'web', script: 'a' }, { name: 'web', script: 'b' }] })).toThrow(/used twice/);
		expect(() => parseAppProfile({ version: 1, name: 'demo', processes: [{ name: 'web', script: 'a' }], env: { required: ['api key'] } })).toThrow(/"env.required"/);
	});

	it('lists scripts the project does not define', () => {
		const profile = parseAppProfile({ version: 1, name: 'demo', build: { script: 'build' }, processes: [{ name: 'web', script: 'start', dev: 'dev' }] });
		expect(missingProfileScripts(profile, ['dev'])).toEqual(['"build.script" runs script "build"', 'process "web" runs script "start"']);
	});
});

describe('ProjectStore with db3.app.json', () => {
	let fixture: FixtureProject;

	beforeEach(async () => {
		fixture = await createFixtureProject();
	});

	afterEach(async () => {
		await fixture.dispose();
	});

	it('takes processes from the profile instead of script names', async () => {
		await writeFile(join(fixture.path, 'db3.app.json'), JSON.stringify({
			version: 1,
			name: 'demo-app',
			processes: [
				{ name: 'web', script: 'dev' },
				{ name: 'emails', kind: 'queue', script: 'queue', args: ['queue:work', '--queues=emails'] },
				{ name: 'scheduler', kind: 'scheduler', script: 'scheduler', args: ['scheduler:work'] },
			],
		}));
		const store = new ProjectStore(fixture.configFile);
		const project = await store.addProject(fixture.path);
		expect(project.processes.map(process => [process.name, process.script, process.kind, process.args])).toEqual([
			['web', 'dev', 'web', []],
			['emails', 'queue', 'queue', ['queue:work', '--queues=emails']],
			// The fixture's scheduler script already runs scheduler:work.
			['scheduler', 'scheduler', 'scheduler', []],
		]);
	});

	it('rejects a profile that names a missing script', async () => {
		await writeFile(join(fixture.path, 'db3.app.json'), JSON.stringify({ version: 1, name: 'demo-app', processes: [{ name: 'web', script: 'start' }] }));
		await expect(new ProjectStore(fixture.configFile).addProject(fixture.path)).rejects.toThrow('db3.app.json: process "web" runs script "start", which package.json does not define.');
	});

	it('rejects a profile that is not JSON', async () => {
		await writeFile(join(fixture.path, 'db3.app.json'), '{');
		await expect(new ProjectStore(fixture.configFile).addProject(fixture.path)).rejects.toThrow('db3.app.json: not valid JSON.');
	});
});
