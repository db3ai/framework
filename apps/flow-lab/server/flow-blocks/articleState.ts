import type { FlowValue, FlowValues } from '@db3.ai/app/flows';

/** Port values used by article blocks that carry one evolving JSON state object. */
export type ArticleStatePort = FlowValues & {
	state: FlowValue;
};

/** Port values used when invoking article generation from a request object. */
export type ArticleRequestPort = FlowValues & {
	request: FlowValue;
};

/** Port values returned by a complete article generation flow. */
export type ArticleResultPort = FlowValues & {
	result: FlowValue;
};

/**
 * Requires a JSON object from a flow value.
 *
 * @param value - Persisted or incoming flow value.
 * @param label - Boundary name included in validation errors.
 * @returns JSON object safe to extend in a block.
 */
export function requireObject(value: FlowValue | undefined, label: string): FlowValues {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object.`);
	}

	return value;
}

/**
 * Requires the evolving article state from a standard state port.
 *
 * @param input - Block input containing a state value.
 * @returns Parsed JSON state object.
 */
export function requireArticleState(input: ArticleStatePort): FlowValues {
	return requireObject(input.state, 'state');
}

/**
 * Requires a non-empty string property from a JSON object.
 *
 * @param source - JSON object containing the property.
 * @param name - Property name to read.
 * @returns Required non-empty string value.
 */
export function requireString(source: FlowValues, name: string): string {
	const value = source[name];

	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${name} must be a non-empty string.`);
	}

	return value;
}

/**
 * Requires an integer property from a JSON object.
 *
 * @param source - JSON object containing the property.
 * @param name - Property name to read.
 * @returns Required integer value.
 */
export function requireInteger(source: FlowValues, name: string): number {
	const value = source[name];

	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new Error(`${name} must be an integer.`);
	}

	return value;
}

/**
 * Requires a boolean property from a JSON object.
 *
 * @param source - JSON object containing the property.
 * @param name - Property name to read.
 * @returns Required boolean value.
 */
export function requireBoolean(source: FlowValues, name: string): boolean {
	const value = source[name];

	if (typeof value !== 'boolean') {
		throw new Error(`${name} must be a boolean.`);
	}

	return value;
}

/**
 * Converts a JSON array into object entries and rejects malformed items.
 *
 * @param value - JSON-safe value expected to contain objects.
 * @param label - Boundary label included in validation failures.
 * @returns Parsed JSON objects.
 */
export function objectArray(value: FlowValue | undefined, label: string): FlowValues[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array.`);
	}

	return value.map((item, index) => requireObject(item, `${label}[${index}]`));
}

/**
 * Converts an unknown JSON array value into its string entries.
 *
 * @param value - JSON-safe value to inspect.
 * @returns String values found in the array.
 */
export function stringArray(value: FlowValue | undefined): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}
