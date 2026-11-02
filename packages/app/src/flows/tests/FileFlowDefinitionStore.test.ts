import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ulid } from '@db3.ai/pure/ulid';
import { afterEach, describe, expect, it } from 'vitest';

import { FileFlowDefinitionStore, FlowDefinitionConflictError, type FlowGraphDefinition } from '../index';

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => rm(root, {
		force: true,
		recursive: true,
	})));
});

/**
 * Creates a temporary file store for one test.
 *
 * @returns Temporary root and file definition store.
 */
async function createStore(): Promise<{
	root: string;
	store: FileFlowDefinitionStore;
}> {
	const root = await mkdtemp(join(tmpdir(), 'platform-flows-'));

	roots.push(root);

	return {
		root,
		store: new FileFlowDefinitionStore({ root }),
	};
}

/**
 * Creates a minimal one-step flow.
 *
 * @param name - Flow name.
 * @returns Flow file.
 */
function definition(name = 'file-example'): FlowGraphDefinition {
	return {
		schemaVersion: 2,
		id: ulid(),
		name,
		inputs: { value: { type: 'string', required: true } },
		outputs: { value: { type: 'string', value: '{{pass.value}}' } },
		steps: { pass: { type: 'test.passthrough', config: { value: '{{input.value}}' } } },
		edges: [['input', 'pass']],
	};
}

describe('FileFlowDefinitionStore', () => {
	it('writes deterministic project JSON and reads it by flow id', async () => {
		const { root, store } = await createStore();
		const flow = definition();
		const stored = await store.write(flow);
		const loaded = await store.read(flow.id);
		const content = await import('node:fs/promises').then(fs => fs.readFile(join(root, 'file-example.flow.json'), 'utf8'));

		expect(stored.path).toBe('file-example.flow.json');
		expect(stored.revision).toMatch(/^[a-f0-9]{64}$/);
		expect(loaded?.definition).toEqual(flow);
		expect(content).toMatch(/^\{\n\t"schemaVersion": 2,/);
		expect(content.endsWith('\n')).toBe(true);
	});

	it('prevents a stale editor revision from overwriting external changes', async () => {
		const { root, store } = await createStore();
		const flow = definition();
		const stored = await store.write(flow);
		const path = join(root, stored.path!);

		await writeFile(path, `${JSON.stringify({ ...flow, description: 'External edit' }, null, '\t')}\n`, 'utf8');

		await expect(store.write({
			...flow,
			description: 'Editor edit',
		}, {
			expectedRevision: stored.revision,
		})).rejects.toBeInstanceOf(FlowDefinitionConflictError);
	});

	it('retains the original source path when a flow name changes', async () => {
		const { store } = await createStore();
		const flow = definition('original-name');
		const first = await store.write(flow);
		const second = await store.write({
			...flow,
			name: 'renamed-flow',
		}, {
			expectedRevision: first.revision,
		});

		expect(second.path).toBe('original-name.flow.json');
		const summary = (await store.list())[0];

		expect(summary.name).toBe('renamed-flow');
		expect(summary.inputs).toEqual(flow.inputs);
		expect(summary.outputs).toEqual({ value: { type: 'string' } });
	});

	it('rejects paths outside the configured project root', async () => {
		const { store } = await createStore();

		await expect(store.write(definition(), {
			path: '../outside.flow.json',
		})).rejects.toThrow(/safe relative path/);
	});

	it('does not overwrite a different flow occupying the requested path', async () => {
		const { store } = await createStore();
		const first = definition('shared');
		const second = definition('shared');

		await store.write(first);

		await expect(store.write(second)).rejects.toThrow(/already used/);
	});
});
