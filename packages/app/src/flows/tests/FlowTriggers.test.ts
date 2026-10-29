import { ulid } from '@db3.ai/pure/ulid';
import { describe, expect, it } from 'vitest';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE, FLOW_SYSTEM_BLOCKS, FLOW_TRIGGER_PORT, FlowBlockRegistry, FlowCompiler, defineBlock, type FlowExecutionDefinition } from '../index';
import { addPaletteBlock } from '../../../../flow-designer/src/graphOperations';

const webhook = defineBlock({ type: 'test.webhook', kind: 'trigger', name: 'Webhook', inputs: {}, outputs: { [FLOW_TRIGGER_PORT]: { type: 'object' } } });

/** Builds a resolved input/output graph using real structural block contracts. */
function fixture(): FlowExecutionDefinition {
	const input = ulid(); const output = ulid();
	const values = { text: { type: 'string' as const, required: true } };
	return {
		schemaVersion: 1, id: ulid(), name: 'Triggered flow', inputs: values, outputs: values,
		blocks: [{ id: input, type: FLOW_INPUT_BLOCK_TYPE, position: { x: 0, y: 0 } }, { id: output, type: FLOW_OUTPUT_BLOCK_TYPE, position: { x: 300, y: 0 } }],
		connections: [{ id: ulid(), sourceBlockId: input, sourcePort: 'text', targetBlockId: output, targetPort: 'text' }],
		resolvedBlocks: { [input]: { inputs: values, outputs: values }, [output]: { inputs: values, outputs: values } }, nestedDefinitions: {},
	};
}

/** Compiles with the actual system blocks and a handler-free external source. */
function compile(definition: FlowExecutionDefinition) {
	return new FlowCompiler(new FlowBlockRegistry([...FLOW_SYSTEM_BLOCKS, webhook])).compile(definition);
}

/** Adds two independent source blocks through the same helper used by the palette and canvas. */
function triggered(): FlowExecutionDefinition {
	const source = fixture();
	const first = addPaletteBlock(source, webhook);
	const second = addPaletteBlock(first.definition, webhook);
	return { ...second.definition, resolvedBlocks: source.resolvedBlocks, nestedDefinitions: {} };
}

describe('trigger blocks', () => {
	it('keeps multiple source blocks in the snapshot but starts execution at Flow Input', () => {
		const definition = triggered();
		const plan = compile(definition);
		expect(plan.definition.blocks).toHaveLength(4);
		expect(plan.blocks.map(block => block.instance.type)).toEqual([FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE]);
		expect(plan.root.incoming).toEqual([]);
		expect(plan.root.block.inputs).toEqual(definition.inputs);
		expect(definition.connections.filter(connection => connection.targetPort === FLOW_TRIGGER_PORT)).toHaveLength(2);
	});

	it('preserves direct programmatic entry when a flow has no trigger blocks', () => {
		const plan = compile(fixture());
		expect(plan.root.instance.type).toBe(FLOW_INPUT_BLOCK_TYPE);
		expect(plan.blocks).toHaveLength(2);
	});

	it.each(['disconnected', 'action target', 'wrong source port', 'wrong target port', 'incoming connection', 'multiple outputs'])('rejects a trigger with %s', fault => {
		const definition = triggered();
		const link = definition.connections[1];
		if (fault === 'disconnected') definition.connections.splice(1, 1);
		if (fault === 'action target') link.targetBlockId = definition.blocks[1].id;
		if (fault === 'wrong source port') link.sourcePort = 'text';
		if (fault === 'wrong target port') link.targetPort = 'text';
		if (fault === 'incoming connection') definition.connections.push({ ...link, id: ulid(), sourceBlockId: definition.blocks[0].id, sourcePort: 'text', targetBlockId: link.sourceBlockId });
		if (fault === 'multiple outputs') definition.connections.push({ ...link, id: ulid() });
		expect(() => compile(definition)).toThrow(/Each trigger/);
	});

	it('requires a Flow Input before adding external sources', () => {
		const definition = fixture();
		definition.blocks.shift();
		expect(() => addPaletteBlock(definition, webhook)).toThrow(/Flow Input/);
	});
});
