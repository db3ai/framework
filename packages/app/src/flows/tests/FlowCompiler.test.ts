import { ulid } from '@db3.ai/pure/ulid';
import { describe, expect, it } from 'vitest';

import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE, FLOW_SYSTEM_BLOCKS, SUBFLOW_BLOCK_TYPE, defineBlock, FlowBlockRegistry, FlowCompiler, FlowDefinitionError, type FlowDefinition, type FlowExecutionDefinition } from '../index';

const inputBlock = defineBlock<{ name: string }, { name: string }>({
	type: 'test.input',
	name: 'Input',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		name: { type: 'string', required: true },
	},
	run: input => input,
});

const greetingBlock = defineBlock<{ name: string }, { message: string }, { template: string }>({
	type: 'test.greeting',
	name: 'Greeting',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	config: {
		template: { type: 'string', required: true, default: 'Hello, {{name}}' },
	},
	run: (input, context) => ({
		message: context.config.template.replace('{{name}}', input.name),
	}),
});

const outputBlock = defineBlock<{ message: string }, { message: string }>({
	type: 'test.output',
	name: 'Output',
	inputs: {
		message: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	run: input => input,
});

const nestedGreetingBlock = defineBlock<{ name: string }, { message: string }>({
	type: 'test.nested-greeting',
	kind: 'flow',
	name: 'Nested greeting',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
});

/**
 * Creates a valid three-step sequential flow fixture.
 *
 * @returns Flow definition and stable fixture ids.
 */
function sequentialDefinition(): {
	definition: FlowDefinition;
	ids: {
		input: string;
		greeting: string;
		output: string;
	};
} {
	const ids = {
		input: ulid(),
		greeting: ulid(),
		output: ulid(),
	};

	return {
		ids,
		definition: {
			schemaVersion: 1,
			id: ulid(),
			name: 'Greeting flow',
			inputs: {
				name: { type: 'string', required: true },
			},
			outputs: {
				message: { type: 'string', required: true },
			},
			blocks: [
				{
					id: ids.input,
					type: inputBlock.type,
					position: { x: 0, y: 0 },
				},
				{
					id: ids.greeting,
					type: greetingBlock.type,
					config: { template: 'Hello, {{name}}' },
					position: { x: 240, y: 0 },
				},
				{
					id: ids.output,
					type: outputBlock.type,
					position: { x: 480, y: 0 },
				},
			],
			connections: [
				{
					id: ulid(),
					sourceBlockId: ids.input,
					sourcePort: 'name',
					targetBlockId: ids.greeting,
					targetPort: 'name',
				},
				{
					id: ulid(),
					sourceBlockId: ids.greeting,
					sourcePort: 'message',
					targetBlockId: ids.output,
					targetPort: 'message',
				},
			],
		},
	};
}

/**
 * Creates the compiler used by the flow fixtures.
 *
 * @returns Compiler with all fixture block types registered.
 */
function compiler(): FlowCompiler {
	return new FlowCompiler(new FlowBlockRegistry([
		inputBlock,
		greetingBlock,
		nestedGreetingBlock,
		outputBlock,
	]));
}

describe('FlowCompiler', () => {
	it('compiles a connected definition into deterministic block order', () => {
		const { definition, ids } = sequentialDefinition();
		const compiled = compiler().compile(definition);

		expect(compiled.blocks.map(block => block.instance.id)).toEqual([
			ids.input,
			ids.greeting,
			ids.output,
		]);
		expect(compiled.root.instance.id).toBe(ids.input);
		expect(compiled.terminal.instance.id).toBe(ids.output);
	});

	it('rejects branching while the runtime is intentionally sequential', () => {
		const { definition, ids } = sequentialDefinition();
		const secondOutputId = ulid();

		definition.blocks.push({
			id: secondOutputId,
			type: outputBlock.type,
			position: { x: 480, y: 180 },
		});
		definition.connections.push({
			id: ulid(),
			sourceBlockId: ids.greeting,
			sourcePort: 'message',
			targetBlockId: secondOutputId,
			targetPort: 'message',
		});

		expect(() => compiler().compile(definition)).toThrowError(FlowDefinitionError);
		expect(() => compiler().compile(definition)).toThrow(/Branching|terminal block/);
	});

	it('rejects connections to undeclared ports', () => {
		const { definition } = sequentialDefinition();

		definition.connections[0].targetPort = 'missing';

		expect(() => compiler().compile(definition)).toThrow(/does not exist|not connected/);
	});

	it('rejects unknown block configuration fields', () => {
		const { definition, ids } = sequentialDefinition();
		const greeting = definition.blocks.find(block => block.id === ids.greeting);

		greeting!.config = {
			template: 'Hello',
			unexpected: true,
		};

		expect(() => compiler().compile(definition)).toThrow(/unexpected|not declared/);
	});

	it('requires a nested flow ULID on flow-backed blocks', () => {
		const { definition, ids } = sequentialDefinition();
		const greeting = definition.blocks.find(block => block.id === ids.greeting);

		greeting!.type = nestedGreetingBlock.type;
		delete greeting!.config;

		expect(() => compiler().compile(definition)).toThrow(/nested flow ULID/);

		greeting!.flowId = ulid();

		expect(() => compiler().compile(definition)).not.toThrow();
	});

	it('rejects nested flow ids on function-backed blocks', () => {
		const { definition, ids } = sequentialDefinition();
		const greeting = definition.blocks.find(block => block.id === ids.greeting);

		greeting!.flowId = ulid();

		expect(() => compiler().compile(definition)).toThrow(/Only flow-backed/);
	});

	it('compiles visible boundaries and generic subflows from resolved snapshot contracts', () => {
		const inputId = ulid();
		const subflowId = ulid();
		const outputId = ulid();
		const nestedFlowId = ulid();
		const definition: FlowExecutionDefinition = {
			schemaVersion: 1,
			id: ulid(),
			name: 'Resolved subflow parent',
			inputs: {
				request: { type: 'json', required: true },
			},
			outputs: {
				result: { type: 'json', required: true },
			},
			blocks: [
				{ id: inputId, type: FLOW_INPUT_BLOCK_TYPE, position: { x: 0, y: 0 } },
				{ id: subflowId, type: SUBFLOW_BLOCK_TYPE, flowId: nestedFlowId, position: { x: 240, y: 0 } },
				{ id: outputId, type: FLOW_OUTPUT_BLOCK_TYPE, position: { x: 480, y: 0 } },
			],
			connections: [
				{ id: ulid(), sourceBlockId: inputId, sourcePort: 'request', targetBlockId: subflowId, targetPort: 'request' },
				{ id: ulid(), sourceBlockId: subflowId, sourcePort: 'result', targetBlockId: outputId, targetPort: 'result' },
			],
			resolvedBlocks: {
				[inputId]: {
					inputs: { request: { type: 'json', required: true } },
					outputs: { request: { type: 'json', required: true } },
				},
				[subflowId]: {
					inputs: { request: { type: 'json', required: true } },
					outputs: { result: { type: 'json', required: true } },
				},
				[outputId]: {
					inputs: { result: { type: 'json', required: true } },
					outputs: { result: { type: 'json', required: true } },
				},
			},
			nestedDefinitions: {},
		};
		const compiled = new FlowCompiler(new FlowBlockRegistry(FLOW_SYSTEM_BLOCKS)).compile(definition);

		expect(compiled.root.block.outputs).toEqual(definition.inputs);
		expect(compiled.blocks[1].block.inputs).toEqual(definition.inputs);
		expect(compiled.blocks[1].block.outputs).toEqual(definition.outputs);
		expect(compiled.terminal.block.inputs).toEqual(definition.outputs);
	});
});
