import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkAppBoundaries, formatAppBoundaries, writeAppTypes } from '@db3.ai/app/apps';

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
	expect(report.apps).toEqual([{ id: 'machines', contract: 'apps/machines/contract.ts', requires: [] }, { id: 'releases', contract: null, requires: ['machines'] }]);
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
