import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkAppBoundaries, describeAppMap, formatAppBoundaries, formatAppMap, writeAppTypes } from '@db3.ai/app/apps';
import { writeAppMap } from '@db3.ai/app/apps/commands';

const temporary: string[] = [];
afterEach(async () => { for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true }); });

/** Writes a project of apps from a map of relative paths to file contents. */
async function project(files: Record<string, unknown>) {
	const root = await mkdtemp(join(tmpdir(), 'db3-boundaries-'));
	temporary.push(root);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content));
	}
	return root;
}

const machines = {
	'apps/machines/manifest.json': { name: 'Machines', version: '1.0.0', contract: 'contract.ts' },
	'apps/machines/contract.ts': 'export default interface Machines { online(id: string): Promise<boolean> }\n',
	'apps/machines/App.ts': "throw new Error('never loaded');\n",
	'apps/machines/server/models/Machine.ts': 'export class Machine {}\n',
};

it('passes an app that imports a required app\'s contract and nothing else', async () => {
	const root = await project({
		...machines,
		'apps/releases/manifest.json': { name: 'Releases', version: '1.0.0', requires: { machines: 1 } },
		'apps/releases/App.ts': "import type Machines from '../machines/contract';\nimport { helper } from './server/helper';\n",
		'apps/releases/server/helper.ts': "export const helper = 1;\nconst later = () => import('../../machines/contract.js');\n",
	});
	const report = checkAppBoundaries(root);
	expect(report.problems).toEqual([]);
	expect(report.apps).toEqual([{ id: 'machines', contract: 'apps/machines/contract.ts', requires: [], services: [] }, { id: 'releases', contract: null, requires: ['machines'], services: [] }]);
	expect(formatAppBoundaries(report)).toBe('App boundaries hold: 2 apps, 1 with contracts.');
});

it('reports imports past a contract, of an undeclared app, of an app with no contract, and a missing contract file', async () => {
	const root = await project({
		...machines,
		'apps/releases/manifest.json': { name: 'Releases', version: '1.0.0' },
		'apps/releases/App.ts': [
			"import { Machine } from '../machines/server/models/Machine';",
			"import type Machines from '../machines/contract';",
			"export {",
			"\tnothing,",
			"} from '../billing/App';",
			'',
		].join('\n'),
		'apps/billing/manifest.json': { name: 'Billing', version: '1.0.0', contract: 'contract.ts' },
		'apps/billing/App.ts': "import '../flows/App.vue';\n",
		'apps/flows/manifest.json': { name: 'Flows', version: '1.0.0' },
		'apps/flows/App.ts': '',
	});
	const { problems } = checkAppBoundaries(root);
	expect(problems.map(({ app, file, line, target }) => ({ app, file, line, target }))).toEqual([
		{ app: 'billing', file: 'apps/billing/manifest.json', line: 0, target: undefined },
		{ app: 'billing', file: 'apps/billing/App.ts', line: 1, target: 'flows' },
		{ app: 'releases', file: 'apps/releases/App.ts', line: 1, target: 'machines' },
		{ app: 'releases', file: 'apps/releases/App.ts', line: 2, target: 'machines' },
		{ app: 'releases', file: 'apps/releases/App.ts', line: 3, target: 'billing' },
	]);
	expect(problems[0]!.message).toContain('does not exist');
	expect(problems[1]!.message).toContain('has no contract');
	expect(problems[2]!.message).toContain("only \"machines\"'s contract apps/machines/contract.ts may be imported");
	expect(problems[3]!.message).toContain('add "machines" to requires or optional');
	expect(formatAppBoundaries(checkAppBoundaries(root))).toMatch(/^apps\/billing\/manifest\.json {2}billing: .*\n[\s\S]*5 app boundary problems\.$/);
});

it('types an app with a contract by that contract, and other apps by their service class', async () => {
	const root = await project({ ...machines, 'apps/releases/manifest.json': { name: 'Releases', version: '1.0.0' }, 'apps/releases/App.ts': '' });
	await writeAppTypes(root);
	const types = await readFile(join(root, '.db3/apps.d.ts'), 'utf8');
	expect(types).toContain('readonly machines?: import("./../apps/machines/contract.js").default;');
	expect(types).toContain('readonly releases?: InstanceType<typeof import("./../apps/releases/App.js").default>;');
});

it('refuses a contract path that leaves the app folder', async () => {
	const root = await project({ 'apps/machines/manifest.json': { name: 'Machines', version: '1.0.0', contract: '../elsewhere.ts' }, 'apps/machines/App.ts': '' });
	expect(() => checkAppBoundaries(root)).toThrow('App entries must remain inside their app directory.');
});

it('maps apps, their dependencies and each contract\'s calls, and says when a saved map is stale', async () => {
	const root = await project({
		'apps/machines/manifest.json': { name: 'Machines', version: '1.0.0', apiVersion: 2, description: 'Computers that run apps.', contract: 'contract.ts' },
		'apps/machines/contract.ts': [
			"import type { Thing } from 'somewhere';",
			'/** Not the contract. */',
			'export interface Helper { skipped(): void }',
			'/** What Machines promises. */',
			'export default interface Machines {',
			'\t/** Whether a machine answered lately. Second sentence. */',
			'\tonline(machine: string): Promise<boolean>;',
			'\t/**',
			'\t * Sends one message | waits for the answer.',
			'\t * @param message - What to send.',
			'\t */',
			'\tsend<T>(machine: string, message: { kind: string; data: Record<string, T> }, ...rest: Array<() => void>): Promise<Map<string, T>>',
			'\treadonly version: number;',
			'\twatch(listener: (event: { at: number }) => void, options?: { once: boolean }): () => void;',
			'}',
			'',
		].join('\n'),
		'apps/machines/App.ts': '',
		'apps/releases/manifest.json': { name: 'Releases', version: '1.0.0', requires: { machines: 2 }, optional: { billing: 1 } },
		'apps/releases/App.ts': '',
	});
	const map = describeAppMap(root);
	expect(map).toEqual([
		{ id: 'machines', name: 'Machines', description: 'Computers that run apps.', apiVersion: 2, requires: [], optional: [], usedBy: ['releases'], contract: 'apps/machines/contract.ts', contractName: 'Machines', calls: [
			{ name: 'online', parameters: ['machine'], summary: 'Whether a machine answered lately.' },
			{ name: 'send', parameters: ['machine', 'message', '...rest'], summary: 'Sends one message | waits for the answer.' },
			{ name: 'watch', parameters: ['listener', 'options'], summary: '' },
		], services: [] },
		{ id: 'releases', name: 'Releases', description: '', apiVersion: 1, requires: ['machines'], optional: ['billing'], usedBy: [], contract: null, contractName: null, calls: [], services: [] },
	]);
	const text = formatAppMap(map);
	expect(text).toContain('machines["Machines<br/>contract v2 · 3 calls"]');
	expect(text).toContain('releases["Releases<br/>no contract"]');
	expect(text).toContain('releases -->|requires| machines');
	expect(text).toContain('releases -.->|optional| billing');
	expect(text).toContain('| `send(machine, message, ...rest)` | Sends one message \\| waits for the answer. |');
	expect(text).toContain('- Uses: `machines`, `billing` (optional)');
	expect(text).toContain('- Used by: `releases`');
	expect(text).toContain("All 2 apps keep to each other's contracts.");
	const crossing = formatAppMap(map, [{ app: 'releases', file: 'apps/releases/App.ts', line: 4, target: 'machines', message: 'Imports apps/machines/App.' }]);
	expect(crossing).toContain('releases -.->|crosses the boundary| machines');
	expect(crossing).toContain('1 place in the code does not conform yet:\n\n- `apps/releases/App.ts` (releases): Imports apps/machines/App.');

	await writeFile(join(root, 'apps/NOTES.md'), '# My notes\n');
	expect(writeAppMap(root, 'apps/NOTES.md')).toEqual({ current: false, message: 'apps/NOTES.md exists and is not a generated app map. Name another file: db3 apps:map <file>.' });
	expect(await readFile(join(root, 'apps/NOTES.md'), 'utf8')).toBe('# My notes\n');
	expect(writeAppMap(root, 'apps/README.md', true)).toEqual({ current: false, message: 'apps/README.md is out of date. Run db3 apps:map and commit it.' });
	expect(writeAppMap(root, 'apps/README.md')).toEqual({ current: true, message: 'Wrote apps/README.md.' });
	expect(await readFile(join(root, 'apps/README.md'), 'utf8')).toBe(text);
	expect(writeAppMap(root, 'apps/README.md', true).current).toBe(true);
	await writeFile(join(root, 'apps/machines/contract.ts'), 'export default interface Machines { online(machine: string): Promise<boolean> }\n');
	expect(writeAppMap(root, 'apps/README.md', true).current).toBe(false);
});

it('keeps services inside an app to each other\'s contracts, and maps them', async () => {
	const root = await project({
		'apps/cloud/manifest.json': { name: 'Cloud', version: '1.0.0' },
		'apps/cloud/App.ts': "import { Sessions } from './services/access/Sessions';\nimport { Builds } from './services/builds/Builds';\n",
		'apps/cloud/server/routes.ts': "import type Access from '../services/access/contract';\nimport { Session } from '../services/access/models/Session';\n",
		'apps/cloud/tests/Access.test.ts': "import { Sessions } from '../services/access/Sessions';\n",
		'apps/cloud/services/access/contract.ts': 'export default interface Access {\n\t/** Who a token acts as. */\n\tauthenticate(token: string): Promise<string>;\n}\n',
		'apps/cloud/services/access/Sessions.ts': "import type Access from './contract';\nimport { Session } from './models/Session';\n",
		'apps/cloud/services/access/models/Session.ts': 'export class Session {}\n',
		'apps/cloud/services/builds/Builds.ts': "import type Access from '../access/contract';\nimport { Sessions } from '../access/Sessions';\n",
		'apps/cloud/services/releases/contract.ts': "import type Access from '../access/contract';\nexport default interface Releases {}\n",
	});
	const report = checkAppBoundaries(root);
	expect(report.apps).toEqual([{ id: 'cloud', contract: null, requires: [], services: ['access', 'builds', 'releases'] }]);
	expect(report.problems.map(({ file, line, service, message }) => ({ file, line, service, message }))).toEqual([
		{ file: 'apps/cloud/services/builds', line: 0, service: 'builds', message: 'Service "builds" has no contract.ts.' },
		{ file: 'apps/cloud/server/routes.ts', line: 2, service: 'access', message: 'Imports apps/cloud/services/access/models/Session; only service "access"\'s contract apps/cloud/services/access/contract.ts may be imported.' },
		{ file: 'apps/cloud/services/builds/Builds.ts', line: 2, service: 'access', message: 'Imports apps/cloud/services/access/Sessions; only service "access"\'s contract apps/cloud/services/access/contract.ts may be imported.' },
	]);
	const [cloud] = describeAppMap(root);
	expect(cloud!.services).toEqual([
		{ id: 'access', contract: 'apps/cloud/services/access/contract.ts', contractName: 'Access', calls: [{ name: 'authenticate', parameters: ['token'], summary: 'Who a token acts as.' }], uses: [] },
		{ id: 'builds', contract: null, contractName: null, calls: [], uses: ['access'] },
		{ id: 'releases', contract: 'apps/cloud/services/releases/contract.ts', contractName: 'Releases', calls: [], uses: ['access'] },
	]);
	const text = formatAppMap([cloud!], report.problems);
	expect(text).toContain('\tsubgraph cloud["Cloud<br/>no contract"]\n\t\tcloud__access(["access<br/>1 call"])');
	expect(text).toContain('\t\tcloud__builds --> cloud__access');
	expect(text).toContain('### access (service in `cloud`)\n\n- Uses: no other service\n- Used by: `builds`, `releases`');
	expect(text).toContain('3 places in the code do not conform yet:');
	expect(text).not.toContain('crosses the boundary');
});
