import type { FlowReplayDefinition } from '../constants';
import type { FlowValue, FlowValues } from './FlowValue';

/**
 * Structured error snapshot stored on failed runs and block steps.
 */
export interface FlowErrorSnapshot {
	/** Error class or provider name. */
	name: string;
	/** Human-readable failure message. */
	message: string;
	/** Optional stack trace captured in development/runtime logs. */
	stack?: string;
}

/**
 * Options controlling creation of a new flow run.
 */
export interface FlowRunOptions {
	/** Optional run ULID that this invocation replays. */
	replayOfRunId?: string;
}

/**
 * Options controlling which definition snapshot a replay executes.
 */
export interface FlowReplayOptions {
	/** Whether to execute the original snapshot or the latest stored definition. */
	definition?: FlowReplayDefinition;
	/** Optional replacement public input for the replay. */
	input?: FlowValues;
}

/**
 * Durable log entry requested by an executing block.
 */
export interface FlowBlockLogInput {
	/** Log severity. */
	level: 'debug' | 'info' | 'warning' | 'error';
	/** Human-readable log message. */
	message: string;
	/** Optional structured diagnostic value. */
	data?: FlowValue;
}
