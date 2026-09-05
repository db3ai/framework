import { createHash } from 'node:crypto';
import { ulid } from '@db3.ai/pure/ulid';
import type { Knex } from 'knex';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Database } from '../../db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '../../db/test/db';
import { FLOW_MODELS, FLOW_REPLAY_DEFINITION, FLOW_RUN_EVENT_TYPE, FLOW_RUN_STATUS, FLOW_STEP_STATUS, FlowRun, Flows, FlowStepJob, defineBlock, type FlowDefinition, type FlowDefinitionStore, type FlowDefinitionSummary, type FlowDefinitionWriteOptions, type FlowValues, type StoredFlowDefinition } from '../index';
import { FailedJob, QueuedJob } from '../../queue';
import { App } from '../../server';

/**
 * Test app that exposes the flow service through the normal active-app seam.
 */
class FlowRuntimeTestApp extends App {
	/** Flow runtime installed by each test after its definition store is prepared. */
	flows!: Flows;
}

const inputBlock = defineBlock<{ name: string }, { name: string }>({
	type: 'demo.manual-input',
	name: 'Manual input',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		name: { type: 'string', required: true },
	},
	run: input => input,
});

const requireNameBlock = defineBlock<{ name: string }, { name: string }>({
	type: 'demo.require-name',
	name: 'Require name',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		name: { type: 'string', required: true },
	},
	run(input) {
		if (!input.name.trim()) {
			throw new Error('Name cannot be empty.');
		}

		return {
			name: input.name.trim(),
		};
	},
});

const greetingBlock = defineBlock<{ name: string }, { message: string }, { template: string }>({
	type: 'demo.build-greeting',
	name: 'Build greeting',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	config: {
		template: { type: 'string', required: true },
	},
	run: (input, context) => ({
		message: context.config.template.replace('{{name}}', input.name),
	}),
});

const tapBlock = defineBlock<{ message: string }, { message: string }, { label: string }>({
	type: 'debug.tap',
	name: 'Tap',
	inputs: {
		message: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	config: {
		label: { type: 'string', required: true },
	},
	async run(input, context) {
		await context.log('debug', context.config.label, input);
		return input;
	},
});

const uppercaseBlock = defineBlock<{ message: string }, { message: string }>({
	type: 'text.uppercase',
	name: 'Uppercase',
	inputs: {
		message: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	run: input => ({
		message: input.message.toUpperCase(),
	}),
});

const outputBlock = defineBlock<{ message: string }, { message: string }>({
	type: 'demo.output',
	name: 'Flow output',
	inputs: {
		message: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
	run: input => input,
});

const nestedGreetingBlock = defineBlock<{ name: string }, { message: string }>({
	type: 'demo.nested-greeting',
	kind: 'flow',
	name: 'Nested greeting',
	inputs: {
		name: { type: 'string', required: true },
	},
	outputs: {
		message: { type: 'string', required: true },
	},
});

const blocks = [
	inputBlock,
	requireNameBlock,
	greetingBlock,
	tapBlock,
	uppercaseBlock,
	outputBlock,
];

/**
 * Mutable in-memory definition store used to isolate runtime integration tests.
 */
class MemoryFlowDefinitionStore implements FlowDefinitionStore {
	readonly #stored = new Map<string, StoredFlowDefinition>();

	/**
	 * Replaces the currently stored test definition.
	 *
	 * @param definition - Definition to make current.
	 */
	set(definition: FlowDefinition): void {
		const content = JSON.stringify(definition);

		this.#stored.set(definition.id, {
			definition: structuredClone(definition),
			revision: createHash('sha256').update(content).digest('hex'),
			path: `${definition.id}/flow.json`,
		});
	}

	/**
	 * Lists the current test definition.
	 *
	 * @returns Stored flow summaries.
	 */
	async list(): Promise<FlowDefinitionSummary[]> {
		return [...this.#stored.values()].map(stored => ({
			id: stored.definition.id,
			name: stored.definition.name,
			inputs: structuredClone(stored.definition.inputs),
			outputs: structuredClone(stored.definition.outputs),
			revision: stored.revision,
			path: stored.path,
		}));
	}

	/**
	 * Reads the current definition when its id matches.
	 *
	 * @param id - Flow ULID.
	 * @returns Stored definition or null.
	 */
	async read(id: string): Promise<StoredFlowDefinition | null> {
		const stored = this.#stored.get(id);

		return stored ? structuredClone(stored) : null;
	}

	/**
	 * Replaces the current definition.
	 *
	 * @param definition - Definition to store.
	 * @param _options - Unused memory-store options.
	 * @returns Newly stored definition.
	 */
	async write(definition: FlowDefinition, _options: FlowDefinitionWriteOptions = {}): Promise<StoredFlowDefinition> {
		this.set(definition);

		return structuredClone(this.#stored.get(definition.id)!);
	}
}

describe('Flows runtime integration', () => {
	let database: GeneratedTestDatabase | null = null;
	let db: Knex;
	let app: FlowRuntimeTestApp | null = null;
	let flows: Flows;
	let store: MemoryFlowDefinitionStore;
	let flow: FlowDefinition;

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('flows_runtime');
		db = database.db;

		app = new FlowRuntimeTestApp({
			db,
			queue: {
				queue: 'flows',
				retryDelaySeconds: 0,
				queueMonitor: false,
				jobResolver: async ({ jobName }) => jobName === FlowStepJob.jobName ? FlowStepJob : null,
			},
		});

		await new Database(db, {
			reportSchemaDiff: false,
		}).install(
			QueuedJob,
			FailedJob,
			...FLOW_MODELS,
		);
	});

	beforeEach(async () => {
		await db('flow_run_events').delete();
		await db('flow_step_runs').delete();
		await db('flow_runs').delete();
		await db('jobs_failed').delete();
		await db('jobs').delete();

		flow = greetingFlow('Hello, {{name}}');
		store = new MemoryFlowDefinitionStore();
		store.set(flow);
		flows = new Flows({
			queue: app!.queue,
			definitions: store,
			blocks: [...blocks, nestedGreetingBlock],
			queueName: 'flows',
			maxTries: 2,
		});
		app!.flows = flows;
	});

	afterAll(async () => {
		await app?.close();
		await database?.destroy();
	});

	it('records every block input, output, lifecycle event, and debug tap log', async () => {
		const created = await flows.run(flow.id, {
			name: 'Steve',
		});

		expect(created.status).toBe(FLOW_RUN_STATUS.queued);

		await workUntilIdle(app!, 'flows');

		const details = await flows.runDetails(created.id!);

		expect(details.run.status).toBe(FLOW_RUN_STATUS.completed);
		expect(details.run.output).toEqual({
			message: 'HELLO, STEVE',
		});
		expect(details.steps).toHaveLength(6);
		expect(details.steps.every(step => step.status === FLOW_STEP_STATUS.completed)).toBe(true);
		expect(details.steps.map(step => step.input)).toEqual([
			{ name: 'Steve' },
			{ name: 'Steve' },
			{ name: 'Steve' },
			{ message: 'Hello, Steve' },
			{ message: 'Hello, Steve' },
			{ message: 'HELLO, STEVE' },
		]);
		expect(details.events.map(event => event.sequence)).toEqual(
			details.events.map((_event, index) => index),
		);
		expect(details.events).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: FLOW_RUN_EVENT_TYPE.stepLog,
				message: 'Greeting built',
				level: 'debug',
				data: { message: 'Hello, Steve' },
			}),
		]));
	});

	it('retries a failed block, leaves later steps pending, and records terminal failure', async () => {
		const created = await flows.run(flow.id, {
			name: '',
		});

		await workUntilIdle(app!, 'flows');

		const details = await flows.runDetails(created.id!);
		const failedStep = details.steps.find(step => step.blockType === requireNameBlock.type);
		const laterSteps = details.steps.filter(step => Number(step.sequence) > Number(failedStep?.sequence));

		expect(details.run.status).toBe(FLOW_RUN_STATUS.failed);
		expect(details.run.error?.message).toBe('Name cannot be empty.');
		expect(failedStep?.status).toBe(FLOW_STEP_STATUS.failed);
		expect(failedStep?.attempt).toBe(2);
		expect(laterSteps.every(step => step.status === FLOW_STEP_STATUS.pending)).toBe(true);
		expect(details.events.map(event => event.type)).toEqual(expect.arrayContaining([
			FLOW_RUN_EVENT_TYPE.stepRetrying,
			FLOW_RUN_EVENT_TYPE.stepFailed,
			FLOW_RUN_EVENT_TYPE.runFailed,
		]));
	});

	it('replays the original definition snapshot or the latest file explicitly', async () => {
		const original = await flows.run(flow.id, {
			name: 'Steve',
		});

		await workUntilIdle(app!, 'flows');

		store.set(greetingFlow('Welcome, {{name}}', flow));

		const originalReplay = await flows.replay(original.id!);
		const latestReplay = await flows.replay(original.id!, {
			definition: FLOW_REPLAY_DEFINITION.latest,
		});

		await workUntilIdle(app, 'flows');

		const originalDetails = await flows.runDetails(originalReplay.id!);
		const latestDetails = await flows.runDetails(latestReplay.id!);

		expect(originalDetails.run.output).toEqual({ message: 'HELLO, STEVE' });
		expect(latestDetails.run.output).toEqual({ message: 'WELCOME, STEVE' });
		expect(originalDetails.run.replayOf?.id).toBe(original.id);
		expect(latestDetails.run.replayOf?.id).toBe(original.id);
	});

	it('waits for nested runs and preserves child snapshots across replay modes', async () => {
		const child = greetingFlow('Hello, {{name}}');
		const parent = nestedParentFlow(child.id);

		store.set(child);
		store.set(parent);

		const original = await flows.run(parent.id, {
			name: 'Steve',
		});

		await workUntilIdle(app!, 'flows');

		const originalDetails = await flows.runDetails(original.id!);
		const originalNestedStep = originalDetails.steps.find(step => step.blockType === nestedGreetingBlock.type);
		const originalChild = await FlowRun.findOrFail(originalNestedStep?.nestedRun?.id);

		expect(originalDetails.run.status).toBe(FLOW_RUN_STATUS.completed);
		expect(originalDetails.run.output).toEqual({ message: 'HELLO, STEVE' });
		expect(originalNestedStep?.status).toBe(FLOW_STEP_STATUS.completed);
		expect(originalChild.parentRun?.id).toBe(original.id);
		expect(originalDetails.events.map(event => event.type)).toEqual(expect.arrayContaining([
			FLOW_RUN_EVENT_TYPE.stepWaiting,
			FLOW_RUN_EVENT_TYPE.nestedStarted,
			FLOW_RUN_EVENT_TYPE.nestedCompleted,
		]));

		store.set(greetingFlow('Welcome, {{name}}', child));

		const originalReplay = await flows.replay(original.id!);
		const latestReplay = await flows.replay(original.id!, {
			definition: FLOW_REPLAY_DEFINITION.latest,
		});

		await workUntilIdle(app!, 'flows');

		const replayedOriginal = await flows.runDetails(originalReplay.id!);
		const replayedLatest = await flows.runDetails(latestReplay.id!);
		const originalReplayStep = replayedOriginal.steps.find(step => step.blockType === nestedGreetingBlock.type);
		const originalReplayChild = await FlowRun.findOrFail(originalReplayStep?.nestedRun?.id);

		expect(replayedOriginal.run.output).toEqual({ message: 'HELLO, STEVE' });
		expect(replayedLatest.run.output).toEqual({ message: 'WELCOME, STEVE' });
		expect(originalReplayChild.replayOf?.id).toBe(originalChild.id);
		expect(originalReplayChild.definitionRevision).toBe(originalChild.definitionRevision);
	});
});

/**
 * Processes available jobs until the database queue is empty.
 *
 * @param app - Test application owning the queue.
 * @param queueName - Queue channel to drain.
 */
async function workUntilIdle(app: App, queueName: string): Promise<void> {
	while (await app.queue.processNextJob(queueName)) {
		// Continue until the sequential flow has no queued work.
	}
}

/**
 * Creates the six-block greeting flow used by runtime tests.
 *
 * @param template - Greeting template supplied to the build block.
 * @param existing - Optional existing definition whose graph ids should remain stable.
 * @returns Greeting flow definition.
 */
function greetingFlow(template: string, existing?: FlowDefinition): FlowDefinition {
	const ids = existing
		? {
			flow: existing.id,
			blocks: existing.blocks.map(block => block.id),
			connections: existing.connections.map(connection => connection.id),
		}
		: {
			flow: ulid(),
			blocks: blocks.map(() => ulid()),
			connections: Array.from({ length: blocks.length - 1 }, () => ulid()),
		};
	const [inputId, requireId, greetingId, tapId, uppercaseId, outputId] = ids.blocks;
	const portNames = [
		['name', 'name'],
		['name', 'name'],
		['message', 'message'],
		['message', 'message'],
		['message', 'message'],
	] as const;

	return {
		schemaVersion: 1,
		id: ids.flow,
		name: 'Greeting debug flow',
		description: 'Deterministic flow for execution, logging, failure, and replay testing.',
		inputs: {
			name: { type: 'string', required: true },
		},
		outputs: {
			message: { type: 'string', required: true },
		},
		blocks: [
			{
				id: inputId,
				type: inputBlock.type,
				position: { x: 40, y: 160 },
			},
			{
				id: requireId,
				type: requireNameBlock.type,
				position: { x: 300, y: 160 },
			},
			{
				id: greetingId,
				type: greetingBlock.type,
				config: { template },
				position: { x: 560, y: 160 },
			},
			{
				id: tapId,
				type: tapBlock.type,
				config: { label: 'Greeting built' },
				position: { x: 820, y: 160 },
			},
			{
				id: uppercaseId,
				type: uppercaseBlock.type,
				position: { x: 1080, y: 160 },
			},
			{
				id: outputId,
				type: outputBlock.type,
				position: { x: 1340, y: 160 },
			},
		],
		connections: ids.connections.map((id, index) => ({
			id,
			sourceBlockId: ids.blocks[index],
			sourcePort: portNames[index][0],
			targetBlockId: ids.blocks[index + 1],
			targetPort: portNames[index][1],
		})),
	};
}

/**
 * Creates a parent flow that delegates its middle block to a child definition.
 *
 * @param childFlowId - Nested child flow ULID.
 * @returns Three-block parent flow definition.
 */
function nestedParentFlow(childFlowId: string): FlowDefinition {
	const flowId = ulid();
	const inputId = ulid();
	const nestedId = ulid();
	const outputId = ulid();

	return {
		schemaVersion: 1,
		id: flowId,
		name: 'Nested parent flow',
		inputs: {
			name: { type: 'string', required: true },
		},
		outputs: {
			message: { type: 'string', required: true },
		},
		blocks: [
			{
				id: inputId,
				type: inputBlock.type,
				position: { x: 40, y: 160 },
			},
			{
				id: nestedId,
				type: nestedGreetingBlock.type,
				flowId: childFlowId,
				position: { x: 300, y: 160 },
			},
			{
				id: outputId,
				type: outputBlock.type,
				position: { x: 560, y: 160 },
			},
		],
		connections: [
			{
				id: ulid(),
				sourceBlockId: inputId,
				sourcePort: 'name',
				targetBlockId: nestedId,
				targetPort: 'name',
			},
			{
				id: ulid(),
				sourceBlockId: nestedId,
				sourcePort: 'message',
				targetBlockId: outputId,
				targetPort: 'message',
			},
		],
	};
}
