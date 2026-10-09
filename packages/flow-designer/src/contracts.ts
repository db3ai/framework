import type { FlowBlockMetadata, FlowDefinition, FlowDefinitionSummary, FlowErrorSnapshot, FlowLogLevel, FlowReplayDefinition, FlowRunEventType, FlowRunStatus, FlowStepStatus, FlowValue, FlowValues, StoredFlowDefinition } from '@db3.ai/app/flows';

/** JSON representation of one durable flow run returned by an app adapter. */
export interface FlowRunRecord {
	id: string;
	flowId: string;
	flowName: string;
	status: FlowRunStatus;
	replayDefinition: FlowReplayDefinition | null;
	definitionRevision: string;
	definitionSnapshot: FlowDefinition;
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

/** Initial definition and palette data returned by a designer adapter. */
export interface FlowDesignerCatalog {
	flows: FlowDefinitionSummary[];
	blocks: FlowBlockMetadata[];
}

/**
 * Application adapter consumed by the reusable flow designer.
 *
 * The framework package owns no transport assumptions; a host app can map this
 * contract to HTTP, an in-process service, or a hosted definition provider.
 */
export interface FlowDesignerClient {
	/** Lists definitions and executable block metadata. */
	catalog(): Promise<FlowDesignerCatalog>;
	/** Loads one source-of-truth flow definition. */
	definition(id: string): Promise<StoredFlowDefinition>;
	/** Saves a complete graph with optimistic revision protection. */
	save(definition: FlowDefinition, expectedRevision?: string): Promise<StoredFlowDefinition>;
	/** Lists recent durable runs for one flow. */
	runs(flowId: string): Promise<FlowRunRecord[]>;
	/** Starts a run with public input values. */
	run(flowId: string, input: FlowValues): Promise<FlowRunRecord>;
	/** Loads the current durable state of one run. */
	runDetails(runId: string): Promise<FlowRunDetailsRecord>;
	/** Replays a run using its snapshot or the latest source definition. */
	replay(runId: string, definition: FlowReplayDefinition): Promise<FlowRunRecord>;
}
