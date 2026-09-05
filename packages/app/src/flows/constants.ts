/**
 * Durable lifecycle states for a complete flow invocation.
 */
export const FLOW_RUN_STATUS = {
	queued: 'queued',
	running: 'running',
	completed: 'completed',
	failed: 'failed',
} as const;

/**
 * Durable lifecycle states for one block occurrence in a run.
 */
export const FLOW_STEP_STATUS = {
	pending: 'pending',
	queued: 'queued',
	running: 'running',
	waiting: 'waiting',
	completed: 'completed',
	failed: 'failed',
} as const;

/**
 * Ordered event types emitted while flow runs progress.
 */
export const FLOW_RUN_EVENT_TYPE = {
	runCreated: 'run.created',
	runStarted: 'run.started',
	runCompleted: 'run.completed',
	runFailed: 'run.failed',
	runReplayed: 'run.replayed',
	stepQueued: 'step.queued',
	stepStarted: 'step.started',
	stepWaiting: 'step.waiting',
	stepLog: 'step.log',
	stepCompleted: 'step.completed',
	stepRetrying: 'step.retrying',
	stepFailed: 'step.failed',
	nestedStarted: 'nested.started',
	nestedCompleted: 'nested.completed',
	nestedFailed: 'nested.failed',
} as const;

/**
 * Supported replay sources for a new run.
 */
export const FLOW_REPLAY_DEFINITION = {
	original: 'original',
	latest: 'latest',
} as const;

/** Durable flow-run status value. */
export type FlowRunStatus = typeof FLOW_RUN_STATUS[keyof typeof FLOW_RUN_STATUS];

/** Durable flow-step status value. */
export type FlowStepStatus = typeof FLOW_STEP_STATUS[keyof typeof FLOW_STEP_STATUS];

/** Ordered flow-run event type. */
export type FlowRunEventType = typeof FLOW_RUN_EVENT_TYPE[keyof typeof FLOW_RUN_EVENT_TYPE];

/** Definition source used to create a replayed run. */
export type FlowReplayDefinition = typeof FLOW_REPLAY_DEFINITION[keyof typeof FLOW_REPLAY_DEFINITION];
