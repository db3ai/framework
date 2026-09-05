import type { FlowDefinition, FlowDefinitionSummary } from './FlowDefinition';

/**
 * Definition plus provider metadata required for conflict-safe editing.
 */
export interface StoredFlowDefinition {
	/** Parsed and validated source-of-truth definition. */
	definition: FlowDefinition;
	/** Content revision used for optimistic concurrency. */
	revision: string;
	/** Provider-relative source path, when one exists. */
	path?: string;
}

/**
 * Options used when saving one flow definition.
 */
export interface FlowDefinitionWriteOptions {
	/** Previously-read revision that must still match before replacement. */
	expectedRevision?: string;
	/** Optional provider-relative path used when creating a new definition. */
	path?: string;
}

/**
 * Storage boundary shared by local file definitions and future hosted drivers.
 */
export interface FlowDefinitionStore {
	/**
	 * Lists available definitions without requiring callers to know provider paths.
	 *
	 * @returns Available flow summaries.
	 */
	list(): Promise<FlowDefinitionSummary[]>;

	/**
	 * Loads one definition by stable flow ULID.
	 *
	 * @param id - Flow ULID.
	 * @returns Stored definition or null when absent.
	 */
	read(id: string): Promise<StoredFlowDefinition | null>;

	/**
	 * Creates or replaces one definition.
	 *
	 * @param definition - Valid flow definition to persist.
	 * @param options - Revision and optional creation path.
	 * @returns Newly stored definition metadata.
	 */
	write(definition: FlowDefinition, options?: FlowDefinitionWriteOptions): Promise<StoredFlowDefinition>;
}
