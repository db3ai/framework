import type { FlowBlockMetadata, FlowDefinition } from '@db3.ai/app/flows';
import { compatibleInsertionBlocks, insertBlockOnConnection } from '@db3.ai/flow-designer';
import { describe, expect, it } from 'vitest';

const definition: FlowDefinition = {
	schemaVersion: 1,
	id: '01KXDVYBN18TMZ7RC67RDS7XVC',
	name: 'Insertion Test',
	inputs: {
		state: { type: 'json', required: true },
	},
	outputs: {
		state: { type: 'json', required: true },
	},
	blocks: [
		{
			id: '01KXDVYBN2VVA31PMQ510M1X12',
			type: 'test.source',
			position: { x: 100, y: 80 },
		},
		{
			id: '01KXDVYBN3R8HX3Y6YW1VXDM36',
			type: 'test.target',
			position: { x: 700, y: 180 },
		},
	],
	connections: [
		{
			id: '01KXDVYBN40YQRQJV06M6BR80Y',
			sourceBlockId: '01KXDVYBN2VVA31PMQ510M1X12',
			sourcePort: 'state',
			targetBlockId: '01KXDVYBN3R8HX3Y6YW1VXDM36',
			targetPort: 'state',
		},
	],
};

const blocks: FlowBlockMetadata[] = [
	{
		type: 'test.source',
		name: 'Source',
		inputs: { state: { type: 'json', required: true } },
		outputs: { state: { type: 'json', required: true } },
	},
	{
		type: 'test.target',
		name: 'Target',
		inputs: { state: { type: 'json', required: true } },
		outputs: { state: { type: 'json', required: true } },
	},
	{
		type: 'control.wait-json',
		name: 'Wait for JSON',
		insertable: true,
		inputs: { state: { type: 'json', required: true } },
		outputs: { state: { type: 'json', required: true } },
		config: {
			milliseconds: { type: 'number', required: true, default: 500 },
		},
	},
	{
		type: 'test.string-only',
		name: 'String only',
		inputs: { value: { type: 'string', required: true } },
		outputs: { value: { type: 'string', required: true } },
	},
];

describe('flow designer graph operations', () => {
	it('lists blocks that can preserve a selected connection contract', () => {
		const compatible = compatibleInsertionBlocks(definition, definition.connections[0], blocks);

		expect(compatible.map(block => block.type)).toContain('control.wait-json');
		expect(compatible.map(block => block.type)).not.toContain('test.string-only');
	});

	it('rewires a selected connection through an inserted block', () => {
		const wait = blocks.find(block => block.type === 'control.wait-json');

		expect(wait).toBeDefined();

		const result = insertBlockOnConnection(definition, definition.connections[0].id, wait!, blocks);
		const inserted = result.definition.blocks.find(block => block.id === result.blockId);

		expect(result.definition.blocks).toHaveLength(3);
		expect(result.definition.connections).toHaveLength(2);
		expect(inserted).toEqual(expect.objectContaining({
			type: 'control.wait-json',
			config: { milliseconds: 500 },
			position: { x: 400, y: 130 },
		}));
		expect(result.definition.connections).toEqual([
			expect.objectContaining({
				sourceBlockId: definition.blocks[0].id,
				targetBlockId: result.blockId,
				targetPort: 'state',
			}),
			expect.objectContaining({
				sourceBlockId: result.blockId,
				sourcePort: 'state',
				targetBlockId: definition.blocks[1].id,
			}),
		]);
	});
});
