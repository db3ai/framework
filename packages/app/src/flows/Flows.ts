import { ActiveRecord } from '../db';
import type { QueueJob } from '../queue';
import { FLOW_INPUT_BLOCK_TYPE, FLOW_OUTPUT_BLOCK_TYPE, FLOW_SYSTEM_BLOCKS, SUBFLOW_BLOCK_TYPE } from './blocks';
import { FLOW_REPLAY_DEFINITION, FLOW_RUN_EVENT_TYPE, FLOW_RUN_STATUS, FLOW_STEP_STATUS } from './constants';
import type { CompiledFlowBlock, FlowBlockLogInput, FlowBlockMetadata, FlowDefinition, FlowDefinitionSummary, FlowDefinitionWriteOptions, FlowExecutionDefinition, FlowReplayOptions, FlowResolvedBlockContract, FlowRunOptions, FlowValue, FlowValueDefinitions, FlowValues, FlowsOptions, StoredFlowDefinition } from './contracts';
import { FlowBlockRegistry } from './FlowBlockRegistry';
import { FlowCompiler } from './FlowCompiler';
import { FlowDefinitionError } from './FlowDefinitionError';
import { flowErrorSnapshot } from './errors';
import { FlowStepJob } from './FlowStepJob';
import { validateFlowValues } from './flowValueValidator';
import { FlowRun, FlowRunEvent, FlowStepRun } from './models';

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

interface NestedRunParent {
	run: FlowRun;
	blockId: string;
}

interface NestedDefinitionSelection {
	stored: StoredFlowDefinition;
	replayOf: FlowRun | null;
}

interface StoredExecutionDefinition extends Omit<StoredFlowDefinition, 'definition'> {
	definition: FlowExecutionDefinition;
}

/**
 * Durable run details returned to APIs and development inspectors.
 */
export interface FlowRunDetails {
	/** Flow run summary and immutable definition snapshot. */
	run: FlowRun;
	/** Block step states in execution order. */
	steps: FlowStepRun[];
	/** Ordered lifecycle and log events. */
	events: FlowRunEvent[];
}

/**
 * Application-scoped flow definition, execution, observability, and replay service.
 */
export class Flows {
	/** Source-of-truth definition provider exposed for advanced app integrations. */
	readonly definitions;
	/** Registered executable block types. */
	readonly blocks: FlowBlockRegistry;
	readonly #compiler: FlowCompiler;
	readonly #queueName: string;
	readonly #maxTries: number;
	readonly #maxPayloadBytes: number;

	/**
	 * Creates an application flow service over the existing queue and models.
	 *
	 * @param options - Queue, definition store, block types, and runtime limits.
	 */
	constructor(private readonly options: FlowsOptions) {
		this.definitions = options.definitions;
		this.blocks = new FlowBlockRegistry([...FLOW_SYSTEM_BLOCKS, ...options.blocks]);
		this.#compiler = new FlowCompiler(this.blocks);
		this.#queueName = options.queueName ?? 'flows';
		this.#maxTries = options.maxTries ?? 3;
		this.#maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
		this.options.queue.registerJob(FlowStepJob);
	}

	/**
	 * Lists current source definitions from the configured provider.
	 *
	 * @returns Available flow definition summaries.
	 */
	listDefinitions(): Promise<FlowDefinitionSummary[]> {
		return this.definitions.list();
	}

	/**
	 * Loads and validates one source definition.
	 *
	 * @param id - Stable flow ULID.
	 * @returns Stored definition and provider metadata.
	 */
	async definition(id: string): Promise<StoredFlowDefinition> {
		const stored = await this.definitions.read(id);

		if (!stored) {
			throw new Error(`Flow definition "${id}" was not found.`);
		}

		await this.#resolveStoredDefinition(stored);

		return stored;
	}

	/**
	 * Validates and persists one definition through the configured provider.
	 *
	 * @param definition - Source-of-truth graph to save.
	 * @param options - Optional revision and creation path.
	 * @returns Stored definition and new revision.
	 */
	async saveDefinition(
		definition: FlowDefinition,
		options: FlowDefinitionWriteOptions = {},
	): Promise<StoredFlowDefinition> {
		await this.#resolveStoredDefinition({
			definition,
			revision: options.expectedRevision ?? 'pending',
			path: options.path,
		});

		return await this.definitions.write(definition, options);
	}

	/**
	 * Returns registered block metadata for palettes and inspectors.
	 *
	 * @returns Designer-safe block metadata.
	 */
	blockMetadata(): FlowBlockMetadata[] {
		return this.blocks.metadata();
	}

	/**
	 * Resolves structural and nested block contracts into an immutable run snapshot.
	 *
	 * Child definitions are recursively captured here so a queued parent continues
	 * to execute the same nested graph even when source files change mid-run.
	 *
	 * @param stored - Source definition and provider metadata.
	 * @param ancestry - Parent flow ids used to detect recursive nesting.
	 * @returns Stored definition with resolved contracts and child snapshots.
	 */
	async #resolveStoredDefinition(
		stored: StoredFlowDefinition,
		ancestry: string[] = [],
	): Promise<StoredExecutionDefinition> {
		if (isExecutionDefinition(stored.definition)) {
			this.#compiler.compile(stored.definition);
			return stored as StoredExecutionDefinition;
		}

		if (ancestry.includes(stored.definition.id)) {
			throw new FlowDefinitionError([{
				path: 'blocks',
				message: `Nested flow cycle detected: ${[...ancestry, stored.definition.id].join(' -> ')}.`,
			}]);
		}

		const nextAncestry = [...ancestry, stored.definition.id];
		const resolvedBlocks: Record<string, FlowResolvedBlockContract> = {};
		const nestedDefinitions: FlowExecutionDefinition['nestedDefinitions'] = {};

		for (const instance of stored.definition.blocks) {
			if (instance.type === FLOW_INPUT_BLOCK_TYPE) {
				resolvedBlocks[instance.id] = boundaryContract(stored.definition.inputs);
				continue;
			}

			if (instance.type === FLOW_OUTPUT_BLOCK_TYPE) {
				resolvedBlocks[instance.id] = boundaryContract(stored.definition.outputs);
				continue;
			}

			const registered = this.blocks.get(instance.type);

			if (!registered || (registered.kind ?? 'function') !== 'flow' || !instance.flowId) continue;

			const child = await this.definitions.read(instance.flowId);

			if (!child) {
				throw new FlowDefinitionError([{
					path: `blocks.${instance.id}.flowId`,
					message: `Nested flow definition "${instance.flowId}" was not found.`,
				}]);
			}

			const resolvedChild = await this.#resolveStoredDefinition(child, nextAncestry);

			nestedDefinitions[instance.id] = resolvedChild;

			if (instance.type === SUBFLOW_BLOCK_TYPE) {
				resolvedBlocks[instance.id] = {
					inputs: structuredClone(resolvedChild.definition.inputs),
					outputs: structuredClone(resolvedChild.definition.outputs),
				};
			} else {
				assertMatchingContracts(registered.inputs, resolvedChild.definition.inputs, `Nested flow "${instance.flowId}" inputs`);
				assertMatchingContracts(registered.outputs, resolvedChild.definition.outputs, `Nested flow "${instance.flowId}" outputs`);
			}
		}

		const definition: FlowExecutionDefinition = {
			...structuredClone(stored.definition),
			resolvedBlocks,
			nestedDefinitions,
		};

		this.#compiler.compile(definition);

		return {
			...stored,
			definition,
		};
	}

	/**
	 * Creates and queues a new run of the latest stored definition.
	 *
	 * @param flowId - Stable flow ULID.
	 * @param input - Public flow input values.
	 * @param options - Optional replay relationship metadata.
	 * @returns Newly-created durable flow run.
	 */
	async run(
		flowId: string,
		input: FlowValues,
		options: FlowRunOptions = {},
	): Promise<FlowRun> {
		const stored = await this.definition(flowId);
		const replayOf = options.replayOfRunId
			? await FlowRun.findOrFail(options.replayOfRunId)
			: null;

		return await this.#createAndDispatch(stored, input, replayOf, null, null, null);
	}

	/**
	 * Replays a historical run using its original snapshot or the latest source.
	 *
	 * @param runId - Historical flow run ULID.
	 * @param options - Definition source and optional replacement input.
	 * @returns Newly-created linked replay run.
	 */
	async replay(runId: string, options: FlowReplayOptions = {}): Promise<FlowRun> {
		const previous = await FlowRun.findOrFail(runId);
		const definitionSource = options.definition ?? FLOW_REPLAY_DEFINITION.original;
		const input = options.input ?? previous.input;

		if (!input) {
			throw new Error(`Flow run "${runId}" does not contain replayable input.`);
		}

		const stored = definitionSource === FLOW_REPLAY_DEFINITION.latest
			? await this.definition(requiredString(previous.flowId, 'Historical flow id is required.'))
			: {
				definition: requiredDefinition(previous.definitionSnapshot),
				revision: requiredString(previous.definitionRevision, 'Historical definition revision is required.'),
			};

		return await this.#createAndDispatch(stored, input, previous, null, definitionSource, null);
	}

	/**
	 * Lists recent runs, optionally restricted to one source flow.
	 *
	 * @param flowId - Optional source flow ULID.
	 * @param limit - Maximum rows to return.
	 * @returns Recent runs ordered newest first.
	 */
	async listRuns(flowId?: string, limit = 50): Promise<FlowRun[]> {
		const query = FlowRun.query().orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(limit, 200)));

		if (flowId) {
			query.where('flowId', flowId);
		}

		return await query.all();
	}

	/**
	 * Loads one run with ordered block steps and timeline events.
	 *
	 * @param runId - Flow run ULID.
	 * @returns Complete durable run details.
	 */
	async runDetails(runId: string): Promise<FlowRunDetails> {
		const run = await FlowRun.findOrFail(runId);
		const [steps, events] = await Promise.all([
			FlowStepRun.where('run', run).orderBy('sequence').all(),
			FlowRunEvent.where('run', run).orderBy('sequence').all(),
		]);

		return {
			run,
			steps,
			events,
		};
	}

	/**
	 * Executes one queued block step and advances the durable run.
	 *
	 * This method is public for FlowStepJob and should not be called directly by
	 * application routes.
	 *
	 * @param runId - Flow run ULID.
	 * @param blockId - Block occurrence ULID.
	 * @param queueJob - Claimed queue job metadata.
	 */
	async processStep(runId: string, blockId: string, queueJob: QueueJob): Promise<void> {
		const run = await FlowRun.findOrFail(runId);

		if (run.status === FLOW_RUN_STATUS.failed) return;

		const compiled = this.#compiler.compile(requiredDefinition(run.definitionSnapshot));
		const compiledBlock = compiled.blocks.find(candidate => candidate.instance.id === blockId);

		if (!compiledBlock) {
			throw new Error(`Block "${blockId}" does not exist in flow run "${runId}".`);
		}

		const step = await FlowStepRun
			.where({
				run,
				blockId,
			})
			.firstOrFail();

		if (step.status === FLOW_STEP_STATUS.completed) {
			await this.#advanceCompletedStep(run, step, compiled.blocks);
			return;
		}

		if (run.status === FLOW_RUN_STATUS.completed) return;

		let completed: boolean;

		try {
			completed = await this.#executeBlock(run, step, compiledBlock, queueJob);
		} catch (error) {
			await this.#recordStepFailure(run, step, queueJob, error);
			throw error;
		}

		if (completed) {
			await this.#advanceCompletedStep(run, step, compiled.blocks);
		}
	}

	/**
	 * Creates all run/step records atomically, then dispatches the root step.
	 *
	 * @param stored - Definition and immutable content revision to execute.
	 * @param input - Public input values supplied to the root block.
	 * @param replayOf - Historical run linked to this invocation.
	 * @param parent - Parent run and block for nested execution.
	 * @param replayDefinition - Definition source selected for replay lineage.
	 * @param beforeDispatch - Optional hook that links nested state before queue visibility.
	 * @returns Created durable run after its root step is queued.
	 */
	async #createAndDispatch(
		stored: StoredFlowDefinition,
		input: FlowValues,
		replayOf: FlowRun | null,
		parent: NestedRunParent | null,
		replayDefinition: typeof FLOW_REPLAY_DEFINITION[keyof typeof FLOW_REPLAY_DEFINITION] | null,
		beforeDispatch: ((run: FlowRun, rootStep: FlowStepRun) => Promise<void>) | null,
	): Promise<FlowRun> {
		const execution = await this.#resolveStoredDefinition(stored);
		const compiled = this.#compiler.compile(execution.definition);
		const normalizedInput = validateFlowValues(input, execution.definition.inputs, 'flow.input');

		this.#assertPayloadSize(normalizedInput, 'Flow input');

		const db = FlowRun.getDb();
		const createdIds = await db.transaction(async transaction => ActiveRecord.withDb(transaction, async () => {
			const run = FlowRun.create({
				flowId: execution.definition.id,
				flowName: execution.definition.name,
				status: FLOW_RUN_STATUS.queued,
				replayDefinition,
				definitionRevision: execution.revision,
				definitionSnapshot: structuredClone(execution.definition),
				input: normalizedInput,
				output: null,
				error: null,
				replayOf,
				parentRun: parent?.run ?? null,
				parentBlockId: parent?.blockId ?? null,
				startedAt: null,
				completedAt: null,
			});

			await run.save();

			const steps: FlowStepRun[] = [];

			for (const compiledBlock of compiled.blocks) {
				const step = FlowStepRun.create({
					run,
					blockId: compiledBlock.instance.id,
					blockType: compiledBlock.instance.type,
					blockName: compiledBlock.instance.name || compiledBlock.block.name,
					sequence: compiledBlock.sequence,
					status: FLOW_STEP_STATUS.pending,
					attempt: 0,
					queueJobId: null,
					nestedRun: null,
					input: null,
					output: null,
					error: null,
					startedAt: null,
					completedAt: null,
				});

				await step.save();
				steps.push(step);
			}

			await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runCreated, `Run created for ${execution.definition.name}.`, {
				flowId: execution.definition.id,
				definitionRevision: execution.revision,
			});

			if (replayOf?.id) {
				await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runReplayed, `Replaying run ${replayOf.id}.`, {
					replayOfRunId: replayOf.id,
				});
			}

			return {
				runId: requiredString(run.id, 'Created flow run id is required.'),
				rootStepId: requiredString(steps[0]?.id, 'Created root flow step id is required.'),
			};
		}));
		const run = await FlowRun.findOrFail(createdIds.runId);
		const rootStep = await FlowStepRun.findOrFail(createdIds.rootStepId);

		try {
			await beforeDispatch?.(run, rootStep);
			await this.#dispatchStep(run, rootStep);
		} catch (error) {
			await this.#failUndispatchedRun(run, rootStep, error);
			throw error;
		}

		return run;
	}

	/**
	 * Executes and records one block function without scheduling its successor.
	 *
	 * @param run - Durable flow run being advanced.
	 * @param step - Durable block step being executed.
	 * @param compiledBlock - Validated block occurrence and port connections.
	 * @param queueJob - Claimed queue attempt metadata.
	 * @returns True when the step completed synchronously; false while nested work waits.
	 */
	async #executeBlock(
		run: FlowRun,
		step: FlowStepRun,
		compiledBlock: CompiledFlowBlock,
		queueJob: QueueJob,
	): Promise<boolean> {
		const input = await this.#inputFor(run, compiledBlock);
		const config = validateFlowValues(
			compiledBlock.instance.config ?? {},
			compiledBlock.block.config ?? {},
			`block.${compiledBlock.instance.id}.config`,
		);

		this.#assertPayloadSize(input, `Block ${compiledBlock.instance.id} input`);

		const now = new Date();

		if (run.status === FLOW_RUN_STATUS.queued) {
			run.status = FLOW_RUN_STATUS.running;
			run.startedAt = now;
			await run.save();
			await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runStarted, `Run started with ${compiledBlock.instance.name || compiledBlock.block.name}.`);
		}

		step.status = FLOW_STEP_STATUS.running;
		step.attempt = queueJob.attempts;
		step.queueJobId = String(queueJob.id);
		step.input = input;
		step.error = null;
		step.startedAt = now;
		step.completedAt = null;
		await step.save();
		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepStarted, `${step.blockName} started.`, {
			attempt: queueJob.attempts,
		});

		if ((compiledBlock.block.kind ?? 'function') === 'flow') {
			await this.#startNestedFlow(run, step, compiledBlock, input);
			return false;
		}

		if (!compiledBlock.block.run) {
			throw new Error(`Function flow block "${compiledBlock.block.type}" does not define run().`);
		}

		const rawOutput = await compiledBlock.block.run(input, {
			flowId: requiredString(run.flowId, 'Flow run flowId is required.'),
			runId: requiredString(run.id, 'Flow run id is required.'),
			stepRunId: requiredString(step.id, 'Flow step-run id is required.'),
			block: compiledBlock.instance,
			config,
			log: async (level, message, data) => {
				await this.#recordBlockLog(run, step, {
					level,
					message,
					data,
				});
			},
		});
		const output = validateFlowValues(rawOutput, compiledBlock.block.outputs, `block.${compiledBlock.instance.id}.output`);

		this.#assertPayloadSize(output, `Block ${compiledBlock.instance.id} output`);

		step.status = FLOW_STEP_STATUS.completed;
		step.output = output;
		step.error = null;
		step.completedAt = new Date();
		await step.save();
		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepCompleted, `${step.blockName} completed.`);

		return true;
	}

	/**
	 * Delegates one flow-backed block to a durable child run.
	 *
	 * @param run - Parent flow run.
	 * @param step - Parent block step entering its waiting state.
	 * @param compiledBlock - Flow-backed block occurrence and contract.
	 * @param input - Validated values passed to the nested flow.
	 */
	async #startNestedFlow(
		run: FlowRun,
		step: FlowStepRun,
		compiledBlock: CompiledFlowBlock,
		input: FlowValues,
	): Promise<void> {
		const blockId = requiredString(step.blockId, 'Nested parent block id is required.');
		const existing = await FlowRun
			.where({
				parentRun: run,
				parentBlockId: blockId,
			})
			.orderBy('createdAt', 'desc')
			.first();

		if (existing) {
			await this.#attachNestedRun(step, existing);

			if (existing.status === FLOW_RUN_STATUS.completed) {
				await this.#completeNestedParent(existing);
			} else if (existing.status === FLOW_RUN_STATUS.failed) {
				await this.#failNestedParent(existing);
			}

			return;
		}

		const nestedFlowId = requiredString(compiledBlock.instance.flowId, `Flow-backed block "${blockId}" requires flowId.`);
		const selection = await this.#nestedDefinitionSelection(run, blockId, nestedFlowId);

		assertMatchingContracts(
			compiledBlock.block.inputs,
			selection.stored.definition.inputs,
			`Nested flow "${nestedFlowId}" inputs`,
		);
		assertMatchingContracts(
			compiledBlock.block.outputs,
			selection.stored.definition.outputs,
			`Nested flow "${nestedFlowId}" outputs`,
		);

		step.status = FLOW_STEP_STATUS.waiting;
		await step.save();
		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepWaiting, `${step.blockName} is waiting for a nested flow.`);

		try {
			await this.#createAndDispatch(
				selection.stored,
				input,
				selection.replayOf,
				{
					run,
					blockId,
				},
				run.replayDefinition,
				async nestedRun => {
					await this.#attachNestedRun(step, nestedRun);
					await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.nestedStarted, `${step.blockName} started ${nestedRun.flowName}.`, {
						childRunId: requiredString(nestedRun.id, 'Nested flow run id is required.'),
						flowId: requiredString(nestedRun.flowId, 'Nested flow id is required.'),
					});
				},
			);
		} catch (error) {
			const latestParent = await FlowRun.findOrFail(requiredString(run.id, 'Parent flow run id is required.'));

			if (latestParent.status === FLOW_RUN_STATUS.failed) return;
			throw error;
		}

	}

	/**
	 * Chooses the latest nested definition or the child snapshot linked to an
	 * original-definition replay.
	 *
	 * @param parent - Parent run executing the flow-backed block.
	 * @param blockId - Parent block occurrence ULID.
	 * @param nestedFlowId - Referenced child flow ULID.
	 * @returns Definition and historical child lineage for the new child run.
	 */
	async #nestedDefinitionSelection(
		parent: FlowRun,
		blockId: string,
		nestedFlowId: string,
	): Promise<NestedDefinitionSelection> {
		const previousParent = await parent.replayOf?.load() ?? null;
		let previousChild: FlowRun | null = null;

		if (previousParent) {
			const previousStep = await FlowStepRun
				.where({
					run: previousParent,
					blockId,
				})
				.first();

			previousChild = await previousStep?.nestedRun?.load() ?? null;
		}

		if (parent.replayDefinition === FLOW_REPLAY_DEFINITION.original && previousChild) {
			return {
				stored: {
					definition: requiredDefinition(previousChild.definitionSnapshot),
					revision: requiredString(previousChild.definitionRevision, 'Nested replay definition revision is required.'),
				},
				replayOf: previousChild,
			};
		}

		const captured = requiredDefinition(parent.definitionSnapshot).nestedDefinitions[blockId];

		if (captured) {
			return {
				stored: captured,
				replayOf: previousChild,
			};
		}

		return {
			stored: await this.definition(nestedFlowId),
			replayOf: previousChild,
		};
	}

	/**
	 * Links a parent step to its child run while preserving newer step state.
	 *
	 * @param step - Parent flow-backed step.
	 * @param child - Nested child run.
	 */
	async #attachNestedRun(step: FlowStepRun, child: FlowRun): Promise<void> {
		const current = await FlowStepRun.findOrFail(requiredString(step.id, 'Parent flow step id is required.'));

		current.set('nestedRun', child);

		if (current.status === FLOW_STEP_STATUS.running) {
			current.status = FLOW_STEP_STATUS.waiting;
		}

		await current.save();
	}

	/**
	 * Completes a waiting parent block from a successful nested run and advances it.
	 *
	 * @param child - Completed nested child run.
	 */
	async #completeNestedParent(child: FlowRun): Promise<void> {
		const parent = await child.parentRun?.load() ?? null;

		if (!parent || !child.parentBlockId || parent.status === FLOW_RUN_STATUS.completed || parent.status === FLOW_RUN_STATUS.failed) {
			return;
		}

		const step = await FlowStepRun
			.where({
				run: parent,
				blockId: child.parentBlockId,
			})
			.firstOrFail();

		if (step.status === FLOW_STEP_STATUS.completed) return;

		const compiled = this.#compiler.compile(requiredDefinition(parent.definitionSnapshot));
		const parentBlock = compiled.blocks.find(candidate => candidate.instance.id === child.parentBlockId);

		if (!parentBlock) {
			throw new Error(`Nested parent block "${child.parentBlockId}" does not exist in run "${parent.id}".`);
		}

		const output = validateFlowValues(
			requiredValues(child.output, 'Completed nested run output is required.'),
			parentBlock.block.outputs,
			`block.${child.parentBlockId}.output`,
		);

		this.#assertPayloadSize(output, `Nested block ${child.parentBlockId} output`);
		step.set('nestedRun', child);
		step.status = FLOW_STEP_STATUS.completed;
		step.output = output;
		step.error = null;
		step.completedAt = child.completedAt ?? new Date();
		await step.save();
		await this.#recordEvent(parent, step, FLOW_RUN_EVENT_TYPE.nestedCompleted, `${step.blockName} completed from ${child.flowName}.`, {
			childRunId: requiredString(child.id, 'Nested flow run id is required.'),
		});
		await this.#recordEvent(parent, step, FLOW_RUN_EVENT_TYPE.stepCompleted, `${step.blockName} completed.`);
		await this.#advanceCompletedStep(parent, step, compiled.blocks);
	}

	/**
	 * Propagates a terminal nested failure to its waiting parent run.
	 *
	 * @param child - Failed nested child run.
	 */
	async #failNestedParent(child: FlowRun): Promise<void> {
		const parent = await child.parentRun?.load() ?? null;

		if (!parent || !child.parentBlockId || parent.status === FLOW_RUN_STATUS.completed || parent.status === FLOW_RUN_STATUS.failed) {
			return;
		}

		const step = await FlowStepRun
			.where({
				run: parent,
				blockId: child.parentBlockId,
			})
			.firstOrFail();
		const error = child.error ?? flowErrorSnapshot(new Error(`Nested flow "${child.flowName}" failed.`));
		const completedAt = child.completedAt ?? new Date();

		step.set('nestedRun', child);
		step.status = FLOW_STEP_STATUS.failed;
		step.error = error;
		step.completedAt = completedAt;
		await step.save();
		await this.#recordEvent(parent, step, FLOW_RUN_EVENT_TYPE.nestedFailed, `${step.blockName} failed with ${child.flowName}.`, {
			childRunId: requiredString(child.id, 'Nested flow run id is required.'),
			error: errorEventData(error),
		});
		await this.#recordEvent(parent, step, FLOW_RUN_EVENT_TYPE.stepFailed, `${step.blockName} failed.`, errorEventData(error));
		parent.status = FLOW_RUN_STATUS.failed;
		parent.error = error;
		parent.completedAt = completedAt;
		await parent.save();
		await this.#recordEvent(parent, null, FLOW_RUN_EVENT_TYPE.runFailed, 'Run failed because a nested flow failed.', errorEventData(error));
		await this.#failNestedParent(parent);
	}

	/**
	 * Assembles validated block input from run input or the predecessor output.
	 *
	 * @param run - Durable flow run containing public input and prior steps.
	 * @param compiledBlock - Block occurrence whose input should be assembled.
	 * @returns Validated named block input values.
	 */
	async #inputFor(run: FlowRun, compiledBlock: CompiledFlowBlock): Promise<FlowValues> {
		if (compiledBlock.sequence === 0) {
			return validateFlowValues(
				requiredValues(run.input, 'Flow run input is required.'),
				compiledBlock.block.inputs,
				`block.${compiledBlock.instance.id}.input`,
			);
		}

		const predecessor = await FlowStepRun
			.where({
				run,
				sequence: compiledBlock.sequence - 1,
			})
			.firstOrFail();
		const predecessorOutput = requiredValues(predecessor.output, `Predecessor step ${predecessor.id} has no output.`);
		const values: FlowValues = {};

		for (const connection of compiledBlock.incoming) {
			const value = predecessorOutput[connection.sourcePort];

			if (value !== undefined) {
				values[connection.targetPort] = structuredClone(value);
			}
		}

		return validateFlowValues(values, compiledBlock.block.inputs, `block.${compiledBlock.instance.id}.input`);
	}

	/**
	 * Completes a terminal run or dispatches the next pending step.
	 *
	 * @param run - Durable flow run being advanced.
	 * @param step - Completed block step.
	 * @param compiledBlocks - Complete sequential execution plan.
	 */
	async #advanceCompletedStep(
		run: FlowRun,
		step: FlowStepRun,
		compiledBlocks: CompiledFlowBlock[],
	): Promise<void> {
		const nextBlock = compiledBlocks[Number(step.sequence) + 1];

		if (nextBlock) {
			const nextStep = await FlowStepRun
				.where({
					run,
					blockId: nextBlock.instance.id,
				})
				.firstOrFail();

			if (nextStep.status === FLOW_STEP_STATUS.pending) {
				await this.#dispatchStep(run, nextStep);
			}

			return;
		}

		if (run.status === FLOW_RUN_STATUS.completed) return;

		const definition = requiredDefinition(run.definitionSnapshot);
		const publicOutput = validateFlowValues(
			requiredValues(step.output, 'Terminal step output is required.'),
			definition.outputs,
			'flow.output',
		);

		this.#assertPayloadSize(publicOutput, 'Flow output');
		run.status = FLOW_RUN_STATUS.completed;
		run.output = publicOutput;
		run.error = null;
		run.completedAt = new Date();
		await run.save();
		await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runCompleted, 'Run completed.');
		await this.#completeNestedParent(run);
	}

	/**
	 * Dispatches one pending step and records its queue identity.
	 *
	 * @param run - Flow run owning the pending step.
	 * @param step - Pending step to queue.
	 */
	async #dispatchStep(run: FlowRun, step: FlowStepRun): Promise<void> {
		const jobId = await this.options.queue.dispatch(
			new FlowStepJob({
				runId: requiredString(run.id, 'Flow run id is required.'),
				blockId: requiredString(step.blockId, 'Flow step blockId is required.'),
			}),
			{
				queue: this.#queueName,
				maxTries: this.#maxTries,
			},
		);

		step.status = FLOW_STEP_STATUS.queued;
		step.queueJobId = String(jobId);
		await step.save();
		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepQueued, `${step.blockName} queued.`, {
			queue: this.#queueName,
			queueJobId: String(jobId),
		});
	}

	/**
	 * Records retryable or terminal block failure state before rethrowing to Queue.
	 *
	 * @param run - Flow run owning the failed attempt.
	 * @param step - Step whose block function failed.
	 * @param queueJob - Claimed queue attempt metadata.
	 * @param error - Unknown block failure.
	 */
	async #recordStepFailure(
		run: FlowRun,
		step: FlowStepRun,
		queueJob: QueueJob,
		error: unknown,
	): Promise<void> {
		const snapshot = flowErrorSnapshot(error);
		const terminal = queueJob.attempts >= queueJob.payload.maxTries;

		step.attempt = queueJob.attempts;
		step.error = snapshot;
		step.status = terminal ? FLOW_STEP_STATUS.failed : FLOW_STEP_STATUS.queued;
		step.completedAt = terminal ? new Date() : null;
		await step.save();

		if (!terminal) {
			await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepRetrying, `${step.blockName} will retry.`, {
				attempt: queueJob.attempts,
				error: errorEventData(snapshot),
			});
			return;
		}

		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepFailed, `${step.blockName} failed.`, errorEventData(snapshot));
		run.status = FLOW_RUN_STATUS.failed;
		run.error = snapshot;
		run.completedAt = new Date();
		await run.save();
		await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runFailed, 'Run failed.', errorEventData(snapshot));
		await this.#failNestedParent(run);
	}

	/**
	 * Marks a run failed when its first queue dispatch could not be persisted.
	 *
	 * @param run - Newly created flow run.
	 * @param step - Root step that could not be queued.
	 * @param error - Queue dispatch failure.
	 */
	async #failUndispatchedRun(run: FlowRun, step: FlowStepRun, error: unknown): Promise<void> {
		const snapshot = flowErrorSnapshot(error);
		const completedAt = new Date();

		step.status = FLOW_STEP_STATUS.failed;
		step.error = snapshot;
		step.completedAt = completedAt;
		await step.save();
		run.status = FLOW_RUN_STATUS.failed;
		run.error = snapshot;
		run.completedAt = completedAt;
		await run.save();
		await this.#recordEvent(run, step, FLOW_RUN_EVENT_TYPE.stepFailed, `${step.blockName} could not be queued.`, errorEventData(snapshot));
		await this.#recordEvent(run, null, FLOW_RUN_EVENT_TYPE.runFailed, 'Run could not be queued.', errorEventData(snapshot));
		await this.#failNestedParent(run);
	}

	/**
	 * Writes one durable block-requested log event.
	 *
	 * @param run - Flow run receiving the log.
	 * @param step - Block step that requested the log.
	 * @param input - Structured log severity, message, and data.
	 */
	async #recordBlockLog(run: FlowRun, step: FlowStepRun, input: FlowBlockLogInput): Promise<void> {
		if (input.data !== undefined) {
			this.#assertPayloadSize(input.data, 'Flow log data');
		}

		await this.#recordEvent(
			run,
			step,
			FLOW_RUN_EVENT_TYPE.stepLog,
			input.message,
			input.data,
			input.level,
		);
	}

	/**
	 * Appends one run-local ordered lifecycle or log event.
	 *
	 * @param run - Flow run receiving the event.
	 * @param step - Related block step, when applicable.
	 * @param type - Durable event type.
	 * @param message - Human-readable event message.
	 * @param data - Optional structured event data.
	 * @param level - Optional block log severity.
	 * @returns Persisted ordered event record.
	 */
	async #recordEvent(
		run: FlowRun,
		step: FlowStepRun | null,
		type: FlowRunEvent['type'],
		message: string,
		data?: FlowValue,
		level?: FlowRunEvent['level'],
	): Promise<FlowRunEvent> {
		const latest = await FlowRunEvent
			.where('run', run)
			.orderBy('sequence', 'desc')
			.first();
		const event = FlowRunEvent.create({
			run,
			stepRun: step,
			sequence: (latest?.sequence ?? -1) + 1,
			type,
			level: level ?? null,
			message: message.slice(0, 1024),
			data: data ?? null,
		});

		await event.save();

		return event;
	}

	/**
	 * Prevents oversized values from being copied into run history tables.
	 *
	 * @param value - JSON-safe value being persisted.
	 * @param label - Boundary label included in limit errors.
	 */
	#assertPayloadSize(value: FlowValue | FlowValues, label: string): void {
		const size = Buffer.byteLength(JSON.stringify(value), 'utf8');

		if (size > this.#maxPayloadBytes) {
			throw new Error(`${label} exceeds the ${this.#maxPayloadBytes} byte flow capture limit.`);
		}
	}
}

/**
 * Returns a required non-empty string or throws a developer-facing error.
 *
 * @param value - Nullable candidate string.
 * @param message - Error message used when the value is absent.
 * @returns Required non-empty string.
 */
function requiredString(value: string | null | undefined, message: string): string {
	if (!value) throw new Error(message);

	return value;
}

/**
 * Returns a required definition snapshot or throws a developer-facing error.
 *
 * @param value - Nullable definition snapshot.
 * @returns Required flow definition.
 */
function requiredDefinition(value: FlowExecutionDefinition | null | undefined): FlowExecutionDefinition {
	if (!value) throw new Error('Flow run definition snapshot is required.');

	return value;
}

/**
 * Creates the pass-through contract used by a visible flow boundary block.
 *
 * @param definitions - Public input or output contract owned by the flow.
 * @returns Independent input and output copies for the resolved block.
 */
function boundaryContract(definitions: FlowValueDefinitions): FlowResolvedBlockContract {
	return {
		inputs: structuredClone(definitions),
		outputs: structuredClone(definitions),
	};
}

/**
 * Detects a durable execution snapshot without trusting partial source objects.
 *
 * @param definition - Source or execution definition candidate.
 * @returns True when runtime resolution maps are present.
 */
function isExecutionDefinition(definition: FlowDefinition): definition is FlowExecutionDefinition {
	return 'resolvedBlocks' in definition
		&& typeof definition.resolvedBlocks === 'object'
		&& 'nestedDefinitions' in definition
		&& typeof definition.nestedDefinitions === 'object';
}

/**
 * Returns required named flow values or throws a developer-facing error.
 *
 * @param value - Nullable named values.
 * @param message - Error message used when values are absent.
 * @returns Required named flow values.
 */
function requiredValues(value: FlowValues | null | undefined, message: string): FlowValues {
	if (!value) throw new Error(message);

	return value;
}

/**
 * Ensures a flow-backed block exposes the same named boundary as its child flow.
 *
 * @param blockContract - Contract declared by the registered flow-backed block.
 * @param flowContract - Public contract declared by the nested flow definition.
 * @param label - Boundary label included in mismatch errors.
 */
function assertMatchingContracts(
	blockContract: FlowValueDefinitions,
	flowContract: FlowValueDefinitions,
	label: string,
): void {
	const blockNames = Object.keys(blockContract).sort();
	const flowNames = Object.keys(flowContract).sort();

	if (JSON.stringify(blockNames) !== JSON.stringify(flowNames)) {
		throw new Error(`${label} must match the flow-backed block ports.`);
	}

	for (const name of blockNames) {
		const blockValue = blockContract[name];
		const flowValue = flowContract[name];

		if (!blockValue || !flowValue || blockValue.type !== flowValue.type || Boolean(blockValue.required) !== Boolean(flowValue.required)) {
			throw new Error(`${label} port "${name}" must use the same type and required setting as the flow-backed block.`);
		}
	}
}

/**
 * Converts a typed error snapshot into a recursive flow JSON object.
 *
 * @param snapshot - Structured error captured by the flow runtime.
 * @returns JSON-safe error event data.
 */
function errorEventData(snapshot: ReturnType<typeof flowErrorSnapshot>): FlowValues {
	return {
		name: snapshot.name,
		message: snapshot.message,
		stack: snapshot.stack ?? null,
	};
}
