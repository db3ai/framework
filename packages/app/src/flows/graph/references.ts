import type { FlowValue, FlowValues } from '../contracts';

/** Matches one `{{path}}` reference inside a setting value. */
const REFERENCE = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Matches a setting value that is exactly one reference, which keeps the referenced value's type. */
const WHOLE_REFERENCE = /^\{\{\s*([^{}]+?)\s*\}\}$/;

/** Reference roots that are not step names. */
export const FLOW_REFERENCE_ROOTS = ['input', 'env'] as const;

/**
 * Values a step's references read from: the run input, settings and earlier step outputs.
 */
export interface FlowReferenceScope {
	/** Run input values, read as `{{input.x}}`. */
	input: FlowValues;
	/** Outputs of finished steps by step name; null for a skipped step. */
	steps: Record<string, FlowValues | null>;
	/** Plain settings, read as `{{env.X}}`, and secrets, read with `{ "secret": "X" }`. */
	env: Record<string, string | undefined>;
}

/**
 * Lists every reference path used in a setting value, in order of appearance.
 *
 * @param value - Setting value, possibly nested.
 * @returns Paths such as `input.email` or `classify.kind`.
 */
export function referencesIn(value: FlowValue | undefined): string[] {
	if (typeof value === 'string') return [...value.matchAll(REFERENCE)].map(match => match[1]);
	if (Array.isArray(value)) return value.flatMap(item => referencesIn(item));
	if (value && typeof value === 'object') return Object.values(value).flatMap(item => referencesIn(item));
	return [];
}

/**
 * Narrows a setting value to a secret reference: `{ "secret": "NAME" }`.
 *
 * @param value - Setting value.
 * @returns True when the value names an environment secret.
 */
export function isSecretReference(value: FlowValue | undefined): value is { secret: string } {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value)
		&& Object.keys(value).length === 1 && typeof (value as { secret?: unknown }).secret === 'string');
}

/**
 * Lists the secret names a setting value reads.
 *
 * @param value - Setting value, possibly nested.
 * @returns Environment names.
 */
export function secretsIn(value: FlowValue | undefined): string[] {
	if (isSecretReference(value)) return [value.secret];
	if (Array.isArray(value)) return value.flatMap(item => secretsIn(item));
	if (value && typeof value === 'object') return Object.values(value).flatMap(item => secretsIn(item));
	return [];
}

/**
 * Replaces references and secrets in a setting value.
 *
 * A string that is exactly one reference becomes the referenced value with its own
 * type; references inside longer text become text. A reference to something that
 * did not run, such as a step on a branch that was not taken, becomes null.
 *
 * @param value - Setting value, possibly nested.
 * @param scope - Values the references read from.
 * @param options - `redact` writes `[secret NAME]` instead of reading secrets, for run history.
 * @returns The value with every reference replaced.
 */
export function resolveReferences(value: FlowValue, scope: FlowReferenceScope, options: { redact?: boolean } = {}): FlowValue {
	if (typeof value === 'string') {
		const whole = WHOLE_REFERENCE.exec(value);
		if (whole) return structuredClone(lookup(whole[1], scope) ?? null);
		return value.replace(REFERENCE, (_match, path: string) => asText(lookup(path, scope)));
	}

	if (isSecretReference(value)) {
		if (options.redact) return `[secret ${value.secret}]`;
		const secret = scope.env[value.secret];
		if (secret === undefined || secret === '') throw new Error(`Secret ${value.secret} is not set in this environment.`);
		return secret;
	}

	if (Array.isArray(value)) return value.map(item => resolveReferences(item, scope, options));

	if (value && typeof value === 'object') {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, scope, options)]));
	}

	return value;
}

/**
 * Reads one reference path from the scope.
 *
 * @param path - Dotted path whose first part is `input`, `env` or a step name.
 * @param scope - Values the reference reads from.
 * @returns The value, or undefined when nothing is there.
 */
function lookup(path: string, scope: FlowReferenceScope): FlowValue | undefined {
	const [root, ...rest] = path.split('.');
	let value: FlowValue | undefined = root === 'input' ? scope.input
		: root === 'env' ? (rest.length ? scope.env[rest.join('.')] : undefined)
			: scope.steps[root] ?? undefined;

	if (root === 'env') return value;

	for (const part of rest) {
		if (!value || typeof value !== 'object') return undefined;
		value = Array.isArray(value) ? value[Number(part)] : value[part];
	}

	return value;
}

/**
 * Writes a referenced value into surrounding text.
 *
 * @param value - Referenced value.
 * @returns Text form; objects and arrays as JSON, nothing as an empty string.
 */
function asText(value: FlowValue | undefined): string {
	if (value === undefined || value === null) return '';
	return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
