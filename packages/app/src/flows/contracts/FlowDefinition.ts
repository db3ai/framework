import type { FlowValueDefinitions } from './FlowValue';

/**
 * Lightweight definition metadata used by flow lists and selectors.
 */
export interface FlowDefinitionSummary {
	/** Stable flow ULID. */
	id: string;
	/** Lower-case name used to start it, such as `lead-intake`. */
	name: string;
	/** Human-readable title. */
	title?: string;
	/** Optional developer-facing description. */
	description?: string;
	/** Public input contract the flow declares. */
	inputs: FlowValueDefinitions;
	/** Public output contract the flow declares. */
	outputs: FlowValueDefinitions;
	/** Current content revision returned by the definition provider. */
	revision: string;
	/** Provider-relative source path, when one exists. */
	path?: string;
}
