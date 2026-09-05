export type ConfigValues = Record<string, unknown>;

/**
 * Runtime configuration repository with dot-path reads.
 */
export class Config<TValues extends ConfigValues = ConfigValues> {
	/**
	 * Creates a config repository from a plain object.
	 *
	 * @param values - Config values to expose.
	 */
	constructor(private readonly values: TValues = {} as TValues) {}

	/**
	 * Returns all config values.
	 *
	 * @returns Config object supplied to this repository.
	 */
	all(): TValues {
		return this.values;
	}

	/**
	 * Reads a config value by dot path.
	 *
	 * @param path - Dot-separated config path.
	 * @returns Config value or undefined when the path is missing.
	 */
	get<TValue = unknown>(path: string): TValue | undefined;
	/**
	 * Reads a config value by dot path with a fallback.
	 *
	 * @param path - Dot-separated config path.
	 * @param fallback - Value to return when the path is missing.
	 * @returns Config value or fallback.
	 */
	get<TValue>(path: string, fallback: TValue): TValue;
	get<TValue>(path: string, fallback?: TValue): TValue | undefined {
		const result = resolveConfigPath(this.values, path);

		if (!result.exists) return fallback;

		return result.value as TValue;
	}

	/**
	 * Returns true when a dot path exists in this config repository.
	 *
	 * @param path - Dot-separated config path.
	 * @returns True when the path exists.
	 */
	has(path: string): boolean {
		return resolveConfigPath(this.values, path).exists;
	}
}

/**
 * Defines a typed config object without changing its runtime shape.
 *
 * @param values - Config values to preserve.
 * @returns The same config values.
 */
export function defineConfig<TValues extends ConfigValues>(values: TValues): TValues {
	return values;
}

/**
 * Resolves a dot path against a config object.
 *
 * @param values - Config object to inspect.
 * @param path - Dot-separated config path.
 * @returns Resolution result containing existence and value.
 */
function resolveConfigPath(values: ConfigValues, path: string): {
	exists: boolean;
	value?: unknown;
} {
	if (!path) {
		throw new Error('Config path cannot be empty.');
	}

	const segments = path.split('.');

	if (segments.some(segment => !segment)) {
		throw new Error(`Config path "${path}" contains an empty segment.`);
	}

	let current: unknown = values;

	for (const segment of segments) {
		if (typeof current !== 'object' || current === null || Array.isArray(current)) {
			return {
				exists: false,
			};
		}

		if (!Object.hasOwn(current, segment)) {
			return {
				exists: false,
			};
		}

		current = (current as Record<string, unknown>)[segment];
	}

	return {
		exists: true,
		value: current,
	};
}
