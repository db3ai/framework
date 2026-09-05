/**
 * JSON-safe value that can cross a flow block boundary or be persisted in a run.
 */
export type FlowValue = string | number | boolean | null | FlowValue[] | {
	[key: string]: FlowValue;
};

/**
 * Named JSON-safe values received or returned by a flow block.
 */
export type FlowValues = Record<string, FlowValue>;

/**
 * Value kinds understood by the initial flow validator and designer inspector.
 */
export type FlowValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'json';

/**
 * Optional presentation hints for definition-driven input and configuration forms.
 *
 * Runtime validation does not depend on these values. Hosts may map `component`
 * names such as `DomTextInput` or `DomJsonInput` to their own component registry.
 */
export interface FlowValueEditorDefinition {
	/** Host component name preferred for this value. */
	component?: string;
	/** Human-readable field label overriding the serialized value name. */
	label?: string;
	/** Optional empty-value guidance rendered by compatible editors. */
	placeholder?: string;
	/** Preferred textarea row count for multiline or JSON values. */
	rows?: number;
}

/**
 * Serializable schema for one block port or configuration value.
 */
export interface FlowValueDefinition {
	/** Value kind used for validation and editor controls. */
	type: FlowValueType;
	/** Whether the value must be present and non-null. */
	required?: boolean;
	/** Human-readable explanation shown by development tools. */
	description?: string;
	/** Default value applied when block configuration omits the field. */
	default?: FlowValue;
	/** Optional host-agnostic form renderer hints. */
	editor?: FlowValueEditorDefinition;
}

/**
 * Named schemas for block ports or configuration values.
 */
export type FlowValueDefinitions = Record<string, FlowValueDefinition>;
