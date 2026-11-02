import { FLOW_SERVER_BLOCKS } from '../flows/blocks/server';
import type { ConsoleExecutor } from './ConsoleDatabase';
import type { FlowGraphDefinition, FlowBlockDefinition, FlowBlockMetadata, FlowDefinitionSummary, FlowDefinitionWriteOptions, StoredFlowDefinition } from '../flows/contracts';
import { FileFlowDefinitionStore, type FlowFileSource } from '../flows/drivers/FileFlowDefinitionStore';
import { FlowBlockRegistry } from '../flows/FlowBlockRegistry';
import { ConsoleError } from './ConsoleError';

/** What the console's Flows screens need: an app's `Flows` service has all of it. */
export interface ConsoleFlows {
	listDefinitions(): Promise<FlowDefinitionSummary[]>;
	definition(id: string): Promise<StoredFlowDefinition>;
	saveDefinition(definition: FlowGraphDefinition, options?: FlowDefinitionWriteOptions): Promise<StoredFlowDefinition>;
	blockMetadata(): FlowBlockMetadata[];
}

/**
 * The flow files in a repo folder such as `<repo>/db3/flows` (or a source such as a git branch),
 * for a host that edits them without running the app. The palette has the framework's own blocks
 * plus any passed in; the app checks its own blocks when it loads the flows.
 *
 * @param root - Folder holding the flow files, or where they are kept.
 * @param blocks - More blocks for the palette.
 */
export function fileFlows(root: string | FlowFileSource, blocks: FlowBlockDefinition[] = []): ConsoleFlows {
	const store = new FileFlowDefinitionStore(typeof root === 'string' ? { root } : { source: root });
	const registry = new FlowBlockRegistry([...FLOW_SERVER_BLOCKS, ...blocks]);
	return {
		listDefinitions: () => store.list(),
		async definition(id) {
			const summary = (await store.list()).find(item => item.id === id || item.name === id);
			const stored = summary ? await store.read(summary.id) : null;
			if (!stored) throw new ConsoleError('That flow does not exist.', 404);
			return stored;
		},
		saveDefinition: (definition, options) => store.write(definition, options),
		blockMetadata: () => registry.metadata(),
	};
}

const RUN = ['id', 'flow_id', 'flow_name', 'status', 'replay_definition', 'definition_revision', 'input', 'output', 'error', 'replay_of_run_id', 'parent_run_id', 'parent_block_id', 'started_at', 'completed_at', 'created_at', 'updated_at'];
const STEP = ['id', 'run_id', 'block_id', 'block_type', 'block_name', 'sequence', 'status', 'exit', 'attempt', 'queue_job_id', 'nested_run_id', 'input', 'output', 'error', 'started_at', 'completed_at', 'created_at', 'updated_at'];
const EVENT = ['id', 'run_id', 'step_run_id', 'sequence', 'type', 'level', 'message', 'data', 'created_at'];
const RENAMED: Record<string, string> = { replay_of_run_id: 'replayOf', parent_run_id: 'parentRun', run_id: 'run', nested_run_id: 'nestedRun', step_run_id: 'stepRun' };
const JSON_COLUMNS = new Set(['input', 'output', 'error', 'data', 'definition_snapshot']);

/** A flow's runs read with plain SQL, for hosts that don't run the app (Cloud, via a tunnel). */
export class ConsoleFlowRuns {
	/** @param executor - Runs SQL against the app's database. */
	constructor(private readonly executor: ConsoleExecutor) {}

	/** One page of runs, newest first. */
	async runs(flowId: string, query: { status?: string; search?: string; page?: number; perPage?: number } = {}): Promise<{ runs: Record<string, unknown>[]; total: number }> {
		const perPage = Math.max(1, Math.min(Math.floor(Number(query.perPage) || 20), 100));
		const page = Math.max(1, Math.floor(Number(query.page) || 1));
		let where = 'flow_id = ?';
		const bindings: unknown[] = [flowId];
		if (query.status) { where += ' AND status = ?'; bindings.push(query.status); }
		const search = query.search?.trim();
		if (search) {
			const like = `%${search.replace(/[\\%_]/g, match => `\\${match}`)}%`;
			where += ' AND (id LIKE ? OR input LIKE ?)';
			bindings.push(like, like);
		}
		const [list, count] = await Promise.all([
			this.executor.run(`SELECT ${columnList(RUN)} FROM flow_runs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`, bindings),
			this.executor.run(`SELECT COUNT(*) AS total FROM flow_runs WHERE ${where}`, bindings),
		].map(request => request.catch(missingTables)));
		return { runs: records(list!.rows, RUN), total: Number(records(count!.rows, ['total'])[0]?.total ?? 0) };
	}

	/** A run with its steps and events. */
	async details(runId: string): Promise<{ run: Record<string, unknown>; steps: Record<string, unknown>[]; events: Record<string, unknown>[] } | null> {
		const columns = [...RUN, 'definition_snapshot'];
		const [run, steps, events] = await Promise.all([
			this.executor.run(`SELECT ${columnList(columns)} FROM flow_runs WHERE id = ?`, [runId]),
			this.executor.run(`SELECT ${columnList(STEP)} FROM flow_step_runs WHERE run_id = ? ORDER BY sequence`, [runId]),
			this.executor.run(`SELECT ${columnList(EVENT)} FROM flow_run_events WHERE run_id = ? ORDER BY sequence`, [runId]),
		].map(request => request.catch(missingTables)));
		const found = records(run!.rows, columns)[0];
		return found ? { run: found, steps: records(steps!.rows, STEP), events: records(events!.rows, EVENT) } : null;
	}
}

/** Quoted column list; `exit` and `error` are reserved words. */
function columnList(columns: readonly string[]): string {
	return columns.map(column => `\`${column}\``).join(', ');
}

/** Rows as the app's run JSON: camelCase keys, JSON columns parsed, times as ISO strings. */
function records(rows: readonly unknown[], columns: readonly string[]): Record<string, unknown>[] {
	return rows.map(row => Object.fromEntries(columns.map((column, index) => {
		let value = Array.isArray(row) ? row[index] : (row as Record<string, unknown>)[column];
		if (JSON_COLUMNS.has(column) && typeof value === 'string') value = JSON.parse(value);
		if (value instanceof Date) value = value.toISOString();
		return [RENAMED[column] ?? column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value ?? null];
	})));
}

/** An app that has never run a flow has no run tables yet: that reads as no runs. */
function missingTables(error: unknown): { rows: unknown[]; affectedRows: number } {
	if (/ER_NO_SUCH_TABLE|doesn't exist/i.test(String((error as { code?: string })?.code ?? '') + String((error as Error)?.message ?? ''))) return { rows: [], affectedRows: 0 };
	throw error;
}
