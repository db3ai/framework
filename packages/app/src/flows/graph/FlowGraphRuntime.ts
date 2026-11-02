import { ActiveRecord } from '../../db';
import type { Queue, QueueJob } from '../../queue';
import { FLOW_RUN_EVENT_TYPE, FLOW_RUN_STATUS, FLOW_STEP_STATUS, type FlowReplayDefinition } from '../constants';
import { FLOW_EXIT, isFlowGraphDefinition, type FlowGraphDefinition, type FlowValue, type FlowValueDefinitions, type FlowValues, type StoredFlowDefinition } from '../contracts';
import { FLOW_RUN_BLOCK_TYPE, FLOW_START_BLOCK_TYPE } from '../blocks/flowCall';
import { isFlowExit } from '../defineBlock';
import { flowErrorSnapshot } from '../errors';
import { FlowStepJob } from '../FlowStepJob';
import { validateFlowValues } from '../flowValueValidator';
import { FlowRun, FlowRunEvent, FlowStepRun } from '../models';
import { FLOW_ERROR_EXIT, type CompiledFlowEdge, type CompiledFlowGraph, type CompiledFlowStep, type FlowGraphCompiler } from './FlowGraphCompiler';
import { resolveReferences, type FlowReferenceScope } from './references';

/** Step states that still have work ahead of them. */
const OPEN_STEP_STATES = new Set<string>([FLOW_STEP_STATUS.pending, FLOW_STEP_STATUS.queued, FLOW_STEP_STATUS.running, FLOW_STEP_STATUS.waiting]);

/**
 * What the version 2 runtime needs from the Flows service.
 */
export interface FlowGraphRuntimeOptions {
	compiler: FlowGraphCompiler;
	queue: Queue;
	queueName: string;
	maxTries: number;
	maxPayloadBytes: number;
	/** Settings and secrets read by `{{env.X}}` and `{ "secret": "X" }`. Defaults to `process.env`. */
	env?: () => Record<string, string | undefined>;
	/** Loads another flow by name, for `flow.run` and `flow.start` steps. */
	resolveFlow: (name: string) => Promise<StoredFlowDefinition>;
}

/** How deep flows may call flows that wait for them. */
const MAX_FLOW_DEPTH = 8;

/**
 * Where a new run comes from.
 */
export interface FlowGraphRunOrigin {
	replayOf?: FlowRun | null;
	replayDefinition?: FlowReplayDefinition | null;
	/** The run and `flow.run` step waiting for this run. */
	parent?: { run: FlowRun; step: string } | null;
}

/**
 * Runs version 2 flows: steps keyed by name, values by reference, branches by exit.
 *
 * Each step is one queued job. When a step finishes, the run is locked and every
 * step whose incoming edges are all decided is either queued (an edge into it was
 * taken) or skipped (none was). Steps on separate branches run side by side.
 */
export class FlowGraphRuntime {
	constructor(private readonly options: FlowGraphRuntimeOptions) {}

	/**
	 * Checks input, records the run and its steps, and queues the first steps.
	 *
	 * @param stored - Flow file and its revision.
	 * @param input - Run input values.
	 * @param origin - Replay lineage, when replaying.
	 * @returns The new run.
	 */
	async start(stored: StoredFlowDefinition, input: FlowValues, origin: FlowGraphRunOrigin = {}): Promise<FlowRun> {
		const definition = stored.definition as FlowGraphDefinition;
		const graph = this.options.compiler.compile(definition);
		const normalized = validateFlowValues(input, definition.inputs, 'input');
		this.#assertSize(normalized, 'Flow input');

		const db = FlowRun.getDb();
		// Transaction invariant: a run is never visible without all of its step rows and first queued steps.
		const runId = await db.transaction(async transaction => ActiveRecord.withDb(transaction, async () => {
			const run = FlowRun.create({
				flowId: definition.id,
				flowName: definition.title ?? definition.name,
				status: FLOW_RUN_STATUS.queued,
				replayDefinition: origin.replayDefinition ?? null,
				definitionRevision: stored.revision,
				definitionSnapshot: structuredClone(definition),
				input: normalized,
				output: null,
				error: null,
				replayOf: origin.replayOf ?? null,
				parentRun: origin.parent?.run ?? null,
				parentBlockId: origin.parent?.step ?? null,
				startedAt: null,
				completedAt: null,
			});
			await run.save();

			for (const step of graph.steps) {
				await FlowStepRun.create({
					run,
					blockId: step.name,
					blockType: step.step.type,
					blockName: step.step.title || step.block.name,
					sequence: step.sequence,
					status: FLOW_STEP_STATUS.pending,
					exit: null,
					attempt: 0,
					queueJobId: null,
					nestedRun: null,
					input: null,
					output: null,
					error: null,
					startedAt: null,
					completedAt: null,
				}).save();
			}

			await this.#event(run, null, FLOW_RUN_EVENT_TYPE.runCreated, `Run created for ${definition.title ?? definition.name}.`, { flowId: definition.id, definitionRevision: stored.revision });
			if (origin.replayOf?.id) await this.#event(run, null, FLOW_RUN_EVENT_TYPE.runReplayed, `Replaying run ${origin.replayOf.id}.`, { replayOfRunId: origin.replayOf.id });
			await this.#advance(run, graph);
			return run.id!;
		}));

		return await FlowRun.findOrFail(runId);
	}

	/**
	 * Runs one queued step, then moves the run on.
	 *
	 * @param run - The run.
	 * @param name - Step name.
	 * @param job - Claimed queue job.
	 */
	async processStep(run: FlowRun, name: string, job: QueueJob): Promise<void> {
		if (run.status === FLOW_RUN_STATUS.failed || run.status === FLOW_RUN_STATUS.completed) return;

		const graph = this.options.compiler.compile(run.definitionSnapshot as FlowGraphDefinition);
		const compiled = graph.byName.get(name);
		if (!compiled) throw new Error(`Step "${name}" is not in flow run ${run.id}.`);

		const step = await FlowStepRun.where({ run, blockId: name }).firstOrFail();
		if (!OPEN_STEP_STATES.has(String(step.status))) {
			await this.#locked(run, graph);
			return;
		}

		try {
			await this.#execute(run, step, compiled, graph, job);
		} catch (error) {
			const routed = await this.#recordFailure(run, step, compiled, job, error);
			if (!routed) throw error;
		}

		await this.#locked(run, graph);
	}

	async #execute(run: FlowRun, step: FlowStepRun, compiled: CompiledFlowStep, graph: CompiledFlowGraph, job: QueueJob): Promise<void> {
		const scope = await this.#scope(run, graph);
		const settings = compiled.step.config ?? {};
		const resolved = resolveReferences(settings, scope) as FlowValues;
		const recorded = resolveReferences(settings, scope, { redact: true }) as FlowValues;
		const block = compiled.block;
		const input = validateFlowValues(pick(resolved, block.inputs), block.inputs, `steps.${compiled.name}.input`);
		const config = validateFlowValues(pick(resolved, block.config ?? {}), block.config ?? {}, `steps.${compiled.name}.config`);
		const now = new Date();

		this.#assertSize(recorded, `Step ${compiled.name} input`);

		if (run.status === FLOW_RUN_STATUS.queued) {
			run.status = FLOW_RUN_STATUS.running;
			run.startedAt = now;
			await run.save();
			await this.#event(run, null, FLOW_RUN_EVENT_TYPE.runStarted, `Run started with ${step.blockName}.`);
		}

		step.status = FLOW_STEP_STATUS.running;
		step.attempt = job.attempts;
		step.queueJobId = String(job.id);
		step.input = recorded;
		step.error = null;
		step.startedAt = now;
		step.completedAt = null;
		await step.save();
		await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepStarted, `${step.blockName} started.`, { attempt: job.attempts });

		if (compiled.step.type === FLOW_RUN_BLOCK_TYPE || compiled.step.type === FLOW_START_BLOCK_TYPE) {
			await this.#callFlow(run, step, compiled, resolved);
			return;
		}
		if (!block.run) throw new Error(`Block "${block.type}" cannot run in a version 2 flow yet.`);

		const result = await block.run(input, {
			flowId: run.flowId!,
			runId: run.id!,
			stepRunId: step.id!,
			block: { id: compiled.name, type: compiled.step.type, name: compiled.step.title, config: settings, position: { x: 0, y: 0 } },
			config,
			log: async (level, message, data) => {
				if (data !== undefined) this.#assertSize(data, 'Flow log data');
				await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepLog, message, data, level);
			},
		});

		const exit = isFlowExit(result) ? result[FLOW_EXIT] : null;
		const values = isFlowExit(result) ? result.values : result;

		if (compiled.exits.length && (exit === null || !compiled.exits.includes(exit))) {
			throw new Error(`${step.blockName} must take one of its exits (${compiled.exits.join(', ')}); it returned ${exit === null ? 'none' : `"${exit}"`}.`);
		}
		if (!compiled.exits.length && exit !== null) {
			throw new Error(`${step.blockName} has no exits but returned exit "${exit}".`);
		}

		const output = validateFlowValues(values, compiled.outputs, `steps.${compiled.name}.output`);
		this.#assertSize(output, `Step ${compiled.name} output`);

		step.status = FLOW_STEP_STATUS.completed;
		step.exit = exit;
		step.output = output;
		step.completedAt = new Date();
		await step.save();
		await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepCompleted, exit ? `${step.blockName} completed: ${exit}.` : `${step.blockName} completed.`, exit ? { exit } : undefined);
	}

	/**
	 * Records a failed attempt. After the last retry, a step with an `error` edge
	 * takes it and the run carries on; otherwise the run fails.
	 *
	 * @returns True when the failure was routed to the step's error exit.
	 */
	async #recordFailure(run: FlowRun, step: FlowStepRun, compiled: CompiledFlowStep, job: QueueJob, error: unknown): Promise<boolean> {
		const snapshot = flowErrorSnapshot(error);
		const last = job.attempts >= job.payload.maxTries;
		const routed = last && compiled.outgoing.some(edge => edge.exit === FLOW_ERROR_EXIT);

		step.attempt = job.attempts;
		step.error = snapshot;
		step.status = last ? FLOW_STEP_STATUS.failed : FLOW_STEP_STATUS.queued;
		step.exit = routed ? FLOW_ERROR_EXIT : null;
		step.output = routed ? { error: { name: snapshot.name, message: snapshot.message } } : null;
		step.completedAt = last ? new Date() : null;
		await step.save();

		const data = { name: snapshot.name, message: snapshot.message, stack: snapshot.stack ?? null };
		if (!last) {
			await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepRetrying, `${step.blockName} will retry.`, { attempt: job.attempts, error: data });
			return false;
		}

		await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepFailed, routed ? `${step.blockName} failed; taking its error exit.` : `${step.blockName} failed.`, data);
		if (routed) return true;

		run.status = FLOW_RUN_STATUS.failed;
		run.error = snapshot;
		run.completedAt = new Date();
		await run.save();
		await this.#event(run, null, FLOW_RUN_EVENT_TYPE.runFailed, 'Run failed.', data);
		await this.#childFinished(run);
		return false;
	}

	/** Moves the run on while holding its row lock, so two steps finishing together never queue a step twice. */
	async #locked(run: FlowRun, graph: CompiledFlowGraph): Promise<void> {
		const db = FlowRun.getDb();
		// Transaction invariant: two steps finishing at once must not both see a joining step as ready and queue it twice.
		await db.transaction(async transaction => ActiveRecord.withDb(transaction, async () => {
			const current = await FlowRun.where('id', run.id).forUpdate().firstOrFail();
			await this.#advance(current, graph);
		}));
	}

	/**
	 * Queues every step whose edges are decided and one was taken, skips those
	 * where none was, and completes the run when nothing is left open.
	 */
	async #advance(run: FlowRun, graph: CompiledFlowGraph): Promise<void> {
		if (run.status === FLOW_RUN_STATUS.failed || run.status === FLOW_RUN_STATUS.completed) return;

		const rows = new Map((await FlowStepRun.where('run', run).orderBy('sequence').all()).map(row => [row.blockId!, row]));
		let changed = true;

		while (changed) {
			changed = false;
			for (const compiled of graph.steps) {
				const row = rows.get(compiled.name)!;
				if (row.status !== FLOW_STEP_STATUS.pending) continue;

				const states = compiled.incoming.map(edge => edgeState(edge, rows));
				if (states.includes('open')) continue;

				changed = true;
				if (states.includes('taken')) {
					await this.#dispatch(run, row);
				} else {
					row.status = FLOW_STEP_STATUS.skipped;
					row.completedAt = new Date();
					await row.save();
					await this.#event(run, row, FLOW_RUN_EVENT_TYPE.stepSkipped, `${row.blockName} skipped.`);
				}
			}
		}

		if ([...rows.values()].some(row => OPEN_STEP_STATES.has(String(row.status)))) return;
		await this.#complete(run, graph);
	}

	async #dispatch(run: FlowRun, step: FlowStepRun): Promise<void> {
		const jobId = await this.options.queue.dispatch(
			new FlowStepJob({ runId: run.id!, blockId: step.blockId! }),
			{ queue: this.options.queueName, maxTries: this.options.maxTries },
		);
		step.status = FLOW_STEP_STATUS.queued;
		step.queueJobId = String(jobId);
		await step.save();
		await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepQueued, `${step.blockName} queued.`, { queue: this.options.queueName, queueJobId: String(jobId) });
	}

	async #complete(run: FlowRun, graph: CompiledFlowGraph): Promise<void> {
		const outputs = graph.definition.outputs ?? {};
		const scope = await this.#scope(run, graph);
		const values = Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, output.value === undefined ? null : resolveReferences(output.value, scope, { redact: true })]));
		const contract: FlowValueDefinitions = Object.fromEntries(Object.entries(outputs).map(([name, { value: _value, ...definition }]) => [name, definition]));
		const output = validateFlowValues(values, contract, 'outputs');
		this.#assertSize(output, 'Flow output');

		run.status = FLOW_RUN_STATUS.completed;
		run.output = output;
		run.error = null;
		run.completedAt = new Date();
		await run.save();
		await this.#event(run, null, FLOW_RUN_EVENT_TYPE.runCompleted, 'Run completed.');
		await this.#childFinished(run);
	}

	/**
	 * Runs a `flow.run` or `flow.start` step: starts the other flow with the step's settings
	 * as its inputs. `flow.start` completes at once with the new run id; `flow.run` waits, and
	 * the other run finishing completes or fails this step.
	 */
	async #callFlow(run: FlowRun, step: FlowStepRun, compiled: CompiledFlowStep, input: FlowValues): Promise<void> {
		const name = compiled.step.flow!;
		const stored = await this.options.resolveFlow(name);
		if (compiled.step.type === FLOW_START_BLOCK_TYPE) {
			const child = await this.start(stored, input);
			step.status = FLOW_STEP_STATUS.completed;
			step.output = { runId: child.id! };
			step.completedAt = new Date();
			await step.save();
			await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepCompleted, `${step.blockName} started ${name}.`, { childRunId: child.id! });
			return;
		}

		let depth = 0;
		for (let parent: FlowRun | null = run; parent?.parentRun; parent = await parent.parentRun.load()) depth++;
		if (depth + 1 >= MAX_FLOW_DEPTH) throw new Error(`Flows may wait on other flows at most ${MAX_FLOW_DEPTH} deep.`);

		step.status = FLOW_STEP_STATUS.waiting;
		await step.save();
		await this.#event(run, step, FLOW_RUN_EVENT_TYPE.stepWaiting, `${step.blockName} is waiting for ${name}.`);
		const child = await this.start(stored, input, { parent: { run, step: compiled.name } });
		// The child may already have finished (no queued steps); only link it if this step still waits.
		const current = await FlowStepRun.findOrFail(step.id!);
		current.set('nestedRun', child);
		await current.save();
		await this.#event(run, current, FLOW_RUN_EVENT_TYPE.nestedStarted, `${step.blockName} started ${name}.`, { childRunId: child.id! });
	}

	/** When a run that a `flow.run` step waits for ends, finishes that step and moves the parent on. */
	async #childFinished(child: FlowRun): Promise<void> {
		if (!child.parentRun || !child.parentBlockId) return;
		const parent = await child.parentRun.load();
		if (!parent || !isFlowGraphDefinition(parent.definitionSnapshot)) return;
		const graph = this.options.compiler.compile(parent.definitionSnapshot);
		const compiled = graph.byName.get(child.parentBlockId);
		const step = await FlowStepRun.where({ run: parent, blockId: child.parentBlockId }).first();
		if (!compiled || !step || step.status !== FLOW_STEP_STATUS.waiting) return;

		step.set('nestedRun', child);
		if (child.status === FLOW_RUN_STATUS.completed) {
			step.status = FLOW_STEP_STATUS.completed;
			step.output = child.output ?? {};
			step.completedAt = new Date();
			await step.save();
			await this.#event(parent, step, FLOW_RUN_EVENT_TYPE.nestedCompleted, `${step.blockName} finished.`, { childRunId: child.id! });
		} else {
			const error = child.error ?? { name: 'Error', message: 'The flow it ran failed.' };
			const routed = compiled.outgoing.some(edge => edge.exit === FLOW_ERROR_EXIT);
			step.status = FLOW_STEP_STATUS.failed;
			step.error = error;
			step.exit = routed ? FLOW_ERROR_EXIT : null;
			step.output = routed ? { error: { name: error.name, message: error.message } } : null;
			step.completedAt = new Date();
			await step.save();
			await this.#event(parent, step, FLOW_RUN_EVENT_TYPE.nestedFailed, `${step.blockName} failed: ${error.message}`, { childRunId: child.id! });
			if (!routed) {
				parent.status = FLOW_RUN_STATUS.failed;
				parent.error = error;
				parent.completedAt = new Date();
				await parent.save();
				await this.#event(parent, null, FLOW_RUN_EVENT_TYPE.runFailed, 'Run failed.', { name: error.name, message: error.message });
				await this.#childFinished(parent);
				return;
			}
		}
		await this.#locked(parent, graph);
	}

	/** Run input, outputs of steps that finished (null for skipped ones) and settings. */
	async #scope(run: FlowRun, graph: CompiledFlowGraph): Promise<FlowReferenceScope> {
		const rows = await FlowStepRun.where('run', run).all();
		const steps: Record<string, FlowValues | null> = {};
		for (const row of rows) {
			if (graph.byName.has(row.blockId!)) steps[row.blockId!] = row.output ?? null;
		}
		return { input: run.input ?? {}, steps, env: this.options.env?.() ?? process.env };
	}

	/** Appends one event; the run row lock keeps event numbers in order when steps run side by side. */
	async #event(run: FlowRun, step: FlowStepRun | null, type: FlowRunEvent['type'], message: string, data?: FlowValue, level?: FlowRunEvent['level']): Promise<void> {
		const db = FlowRun.getDb();
		// Transaction invariant: steps running side by side must not read the same latest sequence and write duplicate event numbers.
		// Inside #locked or start this is a savepoint that shares the outer lock.
		await db.transaction(async transaction => ActiveRecord.withDb(transaction, async () => {
			await FlowRun.where('id', run.id).forUpdate().firstOrFail();
			const latest = await FlowRunEvent.where('run', run).orderBy('sequence', 'desc').first();
			await FlowRunEvent.create({
				run,
				stepRun: step,
				sequence: (latest?.sequence ?? -1) + 1,
				type,
				level: level ?? null,
				message: message.slice(0, 1024),
				data: data ?? null,
			}).save();
		}));
	}

	#assertSize(value: FlowValue | FlowValues, label: string): void {
		const size = Buffer.byteLength(JSON.stringify(value), 'utf8');
		if (size > this.options.maxPayloadBytes) throw new Error(`${label} exceeds the ${this.options.maxPayloadBytes} byte flow capture limit.`);
	}
}

/**
 * Whether an edge was taken, can no longer be taken, or is still undecided.
 *
 * @param edge - Parsed edge.
 * @param rows - Step rows by name.
 * @returns `taken`, `dead` or `open`.
 */
function edgeState(edge: CompiledFlowEdge, rows: Map<string, FlowStepRun>): 'taken' | 'dead' | 'open' {
	if (edge.from === 'input') return 'taken';
	const source = rows.get(edge.from);
	if (!source) return 'dead';

	if (source.status === FLOW_STEP_STATUS.skipped) return 'dead';
	if (source.status === FLOW_STEP_STATUS.completed) return edge.exit === source.exit ? 'taken' : 'dead';
	if (source.status === FLOW_STEP_STATUS.failed && source.exit === FLOW_ERROR_EXIT) return edge.exit === FLOW_ERROR_EXIT ? 'taken' : 'dead';
	return 'open';
}

/**
 * Keeps the named values a contract declares.
 *
 * @param values - Resolved step settings.
 * @param definitions - Contract to keep.
 * @returns The values the contract names.
 */
function pick(values: FlowValues, definitions: FlowValueDefinitions): FlowValues {
	return Object.fromEntries(Object.entries(values).filter(([key]) => key in definitions));
}

