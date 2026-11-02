import type { FlowBlockMetadata, FlowGraphDefinition, FlowDefinitionSummary, FlowErrorSnapshot, FlowLogLevel, FlowReplayDefinition, FlowRunEventType, FlowRunStatus, FlowStepStatus, FlowValue, FlowValues, StoredFlowDefinition } from '@db3.ai/app/flows';

/** JSON representation of one durable flow run returned by an app adapter. */
export interface FlowRunRecord {
	id: string;
	flowId: string;
	flowName: string;
	status: FlowRunStatus;
	replayDefinition: FlowReplayDefinition | null;
	definitionRevision: string;
	definitionSnapshot: FlowGraphDefinition;
	input: FlowValues;
	output: FlowValues | null;
	error: FlowErrorSnapshot | null;
	replayOf: string | null;
	parentRun: string | null;
	parentBlockId: string | null;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** JSON representation of one durable block execution. */
export interface FlowStepRunRecord {
	id: string;
	run: string;
	blockId: string;
	blockType: string;
	blockName: string;
	sequence: number;
	status: FlowStepStatus;
	/** Exit the step took, for steps with named exits or a routed failure. */
	exit?: string | null;
	attempt: number;
	queueJobId: string | null;
	nestedRun: string | null;
	input: FlowValues | null;
	output: FlowValues | null;
	error: FlowErrorSnapshot | null;
	startedAt: string | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** JSON representation of an ordered run lifecycle or block log event. */
export interface FlowRunEventRecord {
	id: string;
	run: string;
	stepRun: string | null;
	sequence: number;
	type: FlowRunEventType;
	level: FlowLogLevel | null;
	message: string;
	data: FlowValue | null;
	createdAt: string;
}

/** Complete durable state needed to render one observed run. */
export interface FlowRunDetailsRecord {
	run: FlowRunRecord;
	steps: FlowStepRunRecord[];
	events: FlowRunEventRecord[];
}

/** The flows and blocks an editor host offers. */
export interface FlowEditorCatalog {
	flows: FlowDefinitionSummary[];
	blocks: FlowBlockMetadata[];
}

/** Which runs the editor's Runs view asks for. */
export interface FlowRunQuery {
	/** Only runs with this status. */
	status?: FlowRunStatus;
	/** Text matched against the run id and its input. */
	search?: string;
	/** Page number, from 1. */
	page: number;
	/** Runs per page. */
	perPage: number;
}

/** One page of runs, newest first. */
export interface FlowRunPage {
	runs: FlowRunRecord[];
	/** Runs matching the query across all pages. */
	total: number;
}

/**
 * What the file shape 2 editor needs from its host (Dock, Cloud, or an app).
 *
 * The run methods are optional: a host that edits flow files without running the
 * app leaves them out, and the editor hides Runs and Test run.
 */
export interface FlowEditorClient {
	/** Lists flows and the blocks the app has. */
	catalog(): Promise<FlowEditorCatalog>;
	/** Loads one flow by id or name. */
	definition(idOrName: string): Promise<StoredFlowDefinition>;
	/** Saves a flow with optimistic revision protection; rejects with the problems when it does not check. */
	save(definition: FlowGraphDefinition, expectedRevision?: string): Promise<StoredFlowDefinition>;
	/** Lists one page of a flow's runs. */
	runs?(flowId: string, query: FlowRunQuery): Promise<FlowRunPage>;
	/** Starts a run. */
	run?(flowId: string, input: FlowValues): Promise<FlowRunRecord>;
	/** Loads a run with its steps and events. */
	runDetails?(runId: string): Promise<FlowRunDetailsRecord>;
	/** Runs again with the same input. */
	replay?(runId: string, definition: FlowReplayDefinition): Promise<FlowRunRecord>;
}
