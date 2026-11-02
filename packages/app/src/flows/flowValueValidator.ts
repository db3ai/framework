import type { FlowValue, FlowValueDefinition, FlowValueDefinitions, FlowValues } from './contracts';
import type { FlowDefinitionIssue } from './FlowDefinitionError';

const FLOW_VALUE_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'json']);

/**
 * Validates and normalizes named values against a serializable flow schema.
 *
 * @param values - Unknown values supplied by a run, connection, or block configuration.
 * @param definitions - Named schema definitions.
 * @param label - Developer-facing location used in validation errors.
 * @returns JSON-safe values with configured defaults applied.
 */
export function validateFlowValues(
	values: unknown,
	definitions: FlowValueDefinitions,
	label: string,
): FlowValues {
	if (!isRecord(values)) {
		throw new Error(`${label} must be an object.`);
	}

	for (const name of Object.keys(values)) {
		if (!(name in definitions)) {
			throw new Error(`${label}.${name} is not declared.`);
		}
	}

	const normalized: FlowValues = {};

	for (const [name, definition] of Object.entries(definitions)) {
		const value = values[name] ?? definition.default;

		if (value === undefined || value === null) {
			if (definition.required) {
				throw new Error(`${label}.${name} is required.`);
			}

			normalized[name] = null;
			continue;
		}

		if (!matchesDefinition(value, definition)) {
			throw new Error(`${label}.${name} must be ${articleFor(definition.type)} ${definition.type}.`);
		}

		normalized[name] = cloneFlowValue(value);
	}

	return normalized;
}

/**
 * Tests whether a value matches one serializable flow value definition.
 *
 * @param value - Value to test.
 * @param definition - Expected value definition.
 * @returns True when the value is JSON-safe and type-compatible.
 */
export function matchesDefinition(value: unknown, definition: FlowValueDefinition): value is FlowValue {
	if (!isFlowValue(value)) return false;

	switch (definition.type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'object':
			return isRecord(value);
		case 'array':
			return Array.isArray(value);
		case 'json':
			return true;
	}
}

/**
 * Returns true when an unknown value can be persisted as flow JSON.
 *
 * @param value - Unknown value to inspect.
 * @returns True for recursive JSON-safe values.
 */
export function isFlowValue(value: unknown): value is FlowValue {
	if (value === null) return true;
	if (typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isFlowValue);
	if (!isRecord(value)) return false;

	return Object.values(value).every(isFlowValue);
}

/**
 * Creates a detached JSON-safe copy suitable for persistence and block isolation.
 *
 * @param value - JSON-safe value to clone.
 * @returns Detached value.
 */
export function cloneFlowValue(value: FlowValue): FlowValue {
	return structuredClone(value);
}

/**
 * Checks whether an unknown value is a non-array object.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Chooses a readable indefinite article for validation messages.
 *
 * @param type - Value type label.
 * @returns Indefinite article.
 */
function articleFor(type: string): 'a' | 'an' {
	return type === 'object' || type === 'array' ? 'an' : 'a';
}

/**
 * Checks a set of value definitions: known types, and defaults that match them.
 *
 * @param definitions - Named value definitions.
 * @param path - Location for issues.
 * @param issues - Collected issues.
 */
export function validateValueDefinitions(definitions: FlowValueDefinitions, path: string, issues: FlowDefinitionIssue[]): void {
	if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
		issues.push({ path, message: 'Value definitions must be an object.' });
		return;
	}
	for (const [name, definition] of Object.entries(definitions)) {
		if (!name.trim()) issues.push({ path, message: 'Value names cannot be empty.' });
		if (!definition || typeof definition !== 'object' || !FLOW_VALUE_TYPES.has(definition.type)) {
			issues.push({ path: `${path}.${name}.type`, message: 'Unsupported flow value type.' });
			continue;
		}
		if (definition.default !== undefined && !matchesDefinition(definition.default, definition)) issues.push({ path: `${path}.${name}.default`, message: 'Default value does not match its declared type.' });
	}
}
