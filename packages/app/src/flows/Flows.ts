import type { QueueJob } from '../queue';
import { FLOW_SERVER_BLOCKS } from './blocks/server';
import { FLOW_REPLAY_DEFINITION, FLOW_RUN_STATUS } from './constants';
import type { FlowBlockMetadata, FlowDefinitionSummary, FlowDefinitionWriteOptions, FlowGraphDefinition, FlowReplayOptions, FlowRunOptions, FlowValues, FlowsOptions, StoredFlowDefinition } from './contracts';
import { FlowBlockRegistry } from './FlowBlockRegistry';
import { FlowDefinitionError } from './FlowDefinitionError';
import { FlowStepJob } from './FlowStepJob';
import { FlowGraphCompiler } from './graph/FlowGraphCompiler';
import { FLOW_RUN_BLOCK_TYPE } from './blocks/flowCall';
import { FlowGraphRuntime } from './graph/FlowGraphRuntime';
import { FlowTriggers } from './triggers/FlowTriggers';
import { FlowRun, FlowRunEvent, FlowStepRun } from './models';

const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;

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
	/** Checks version 2 flows. */
	readonly graphs: FlowGraphCompiler;
	readonly #graph: FlowGraphRuntime;
	#triggers: FlowTriggers | undefined;
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
		this.blocks = new FlowBlockRegistry([...FLOW_SERVER_BLOCKS, ...options.blocks]);
		this.#queueName = options.queueName ?? 'flows';
		this.#maxTries = options.maxTries ?? 3;
		this.#maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
		this.graphs = new FlowGraphCompiler(this.blocks);
		this.#graph = new FlowGraphRuntime({
			compiler: this.graphs,
			queue: options.queue,
			queueName: this.#queueName,
			maxTries: this.#maxTries,
			maxPayloadBytes: this.#maxPayloadBytes,
			env: options.env,
			resolveFlow: async name => {
				return await this.definition(name);
			},
		});
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
		const stored = await this.definitions.read(id) ?? await this.#readByName(id);

		if (!stored) {
			throw new Error(`Flow definition "${id}" was not found.`);
		}

		this.graphs.compile(stored.definition);
		return stored;
	}

	/**
	 * Checks that `flow.run` and `flow.start` steps name a flow that exists and give it the
	 * inputs it needs, and that no flow waits on itself.
	 *
	 * @param definition - Flow being saved.
	 * @throws FlowDefinitionError listing the problems.
	 */
	async #checkFlowCalls(definition: FlowGraphDefinition): Promise<void> {
		const issues: { path: string; message: string }[] = [];
		for (const [name, step] of Object.entries(definition.steps)) {
			if ((this.blocks.get(step.type)?.kind ?? 'function') !== 'flow' || !step.flow) continue;
			const path = `steps.${name}`;
			if (step.flow === definition.name) {
				if (step.type === FLOW_RUN_BLOCK_TYPE) issues.push({ path: `${path}.flow`, message: 'A flow cannot wait on itself.' });
				continue;
			}
			const child = await this.#readByName(step.flow);
			if (!child) {
				issues.push({ path: `${path}.flow`, message: `There is no flow "${step.flow}" in db3/flows.` });
				continue;
			}
			const inputs = child.definition.inputs;
			for (const key of Object.keys(step.config ?? {})) {
				if (!inputs[key]) issues.push({ path: `${path}.config.${key}`, message: `${step.flow} has no input "${key}".` });
			}
			for (const [key, field] of Object.entries(inputs)) {
				if (field.required && field.default === undefined && step.config?.[key] === undefined) issues.push({ path: `${path}.config.${key}`, message: `${step.flow} needs "${key}".` });
			}
		}
		if (issues.length) throw new FlowDefinitionError(issues);
	}

	/**
	 * Finds a version 2 flow by its name.
	 *
	 * @param name - Flow name, such as `lead-intake`.
	 * @returns Stored definition or null.
	 */
	async #readByName(name: string): Promise<StoredFlowDefinition | null> {
		const summary = (await this.definitions.list()).find(candidate => candidate.name === name);
		return summary ? await this.definitions.read(summary.id) : null;
	}

	/**
	 * Validates and persists one definition through the configured provider.
	 *
	 * @param definition - Source-of-truth graph to save.
	 * @param options - Optional revision and creation path.
	 * @returns Stored definition and new revision.
	 */
	async saveDefinition(
		definition: FlowGraphDefinition,
		options: FlowDefinitionWriteOptions = {},
	): Promise<StoredFlowDefinition> {
		this.graphs.compile(definition);
		await this.#checkFlowCalls(definition);
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

		return await this.#graph.start(stored, input, { replayOf });
	}

	/**
	 * Webhook, hosted form and schedule triggers for this app's flows.
	 * Serve them with `registerFlowTriggerRoutes` from `@db3.ai/app/flows/fastify`.
	 */
	get triggers(): FlowTriggers {
		this.#triggers ??= new FlowTriggers(this, { env: this.options.env });
		return this.#triggers;
	}

	/**
	 * Starts a flow by name or id and returns at once; the run continues on the queue.
	 *
	 * @param flow - Flow name, such as `lead-intake`, or its ULID.
	 * @param input - Run input values.
	 * @returns The new run.
	 *
	 * @example
	 * const run = await app().flows.start('lead-intake', { name, email, message });
	 */
	async start(flow: string, input: FlowValues): Promise<FlowRun> {
		return await this.run(flow, input);
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

		const snapshot = previous.definitionSnapshot;
		if (!snapshot) throw new Error(`Flow run "${runId}" has no definition snapshot.`);
		const graph = definitionSource === FLOW_REPLAY_DEFINITION.latest
			? await this.definition(requiredString(previous.flowId, 'Historical flow id is required.'))
			: { definition: snapshot, revision: requiredString(previous.definitionRevision, 'Historical definition revision is required.') };
		return await this.#graph.start(graph, input, { replayOf: previous, replayDefinition: definitionSource });
	}

	/**
	 * Lists one page of a flow's runs, newest first.
	 *
	 * @param flowId - Flow ULID.
	 * @param query - Status filter, search text (matched against the run id and its input), page from 1 and page size.
	 * @returns The page and how many runs match in all.
	 *
	 * @example
	 * const { runs, total } = await app().flows.findRuns(flow.id, { status: 'failed', search: 'ada@', page: 1, perPage: 20 });
	 */
	async findRuns(flowId: string, query: { status?: FlowRun['status']; search?: string; page?: number; perPage?: number } = {}): Promise<{ runs: FlowRun[]; total: number }> {
		const perPage = Math.max(1, Math.min(query.perPage ?? 20, 100));
		const page = Math.max(1, Math.floor(query.page ?? 1));
		const filtered = () => {
			const builder = FlowRun.query().where('flowId', flowId);
			if (query.status) builder.where('status', query.status);
			const search = query.search?.trim();
			if (search) {
				const like = `%${search.replace(/[\\%_]/g, match => `\\${match}`)}%`;
				builder.whereRaw('(flow_runs.id LIKE ? OR CAST(flow_runs.input AS CHAR) LIKE ?)', [like, like]);
			}
			return builder;
		};
		const [runs, total] = await Promise.all([
			filtered().orderBy('createdAt', 'desc').orderBy('id', 'desc').limit(perPage).offset((page - 1) * perPage).all(),
			filtered().count(),
		]);
		return { runs, total };
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

		await this.#graph.processStep(run, blockId, queueJob);
	}
}

/**
 * Returns a required string or throws a developer-facing error.
 *
 * @param value - Nullable candidate string.
 * @param message - Error message used when the value is absent.
 * @returns Required non-empty string.
 */
function requiredString(value: string | null | undefined, message: string): string {
	if (!value) throw new Error(message);

	return value;
}
