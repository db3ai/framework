export type EnvSource = Record<string, string | undefined>;

export interface EnvReader {
	(name: string): string | undefined;
	<TDefault>(name: string, fallback: TDefault): string | TDefault;
	required(name: string): string;
	string(name: string): string | undefined;
	string<TDefault>(name: string, fallback: TDefault): string | TDefault;
	boolean(name: string): boolean | undefined;
	boolean<TDefault>(name: string, fallback: TDefault): boolean | TDefault;
	number(name: string): number | undefined;
	number<TDefault>(name: string, fallback: TDefault): number | TDefault;
	integer(name: string): number | undefined;
	integer<TDefault>(name: string, fallback: TDefault): number | TDefault;
	array(name: string): string[] | undefined;
	array<TDefault>(name: string, fallback: TDefault): string[] | TDefault;
	json<TValue = unknown>(name: string): TValue | undefined;
	json<TValue = unknown, TDefault = TValue>(name: string, fallback: TDefault): TValue | TDefault;
}

/**
 * Creates an env reader over a supplied source object.
 *
 * @param source - Environment-like key/value source.
 * @returns Callable env reader with typed parsing helpers.
 */
export function createEnv(source: EnvSource = process.env): EnvReader {
	const reader = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = source[name];

		return value === undefined ? fallback : value;
	}) as EnvReader;

	reader.required = (name: string): string => {
		const value = source[name];

		if (value === undefined || value === '') {
			throw new Error(`Environment variable "${name}" is required.`);
		}

		return value;
	};

	reader.string = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = source[name];

		return value === undefined ? fallback : value;
	}) as EnvReader['string'];

	reader.boolean = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = optionalEnvValue(source, name);

		if (value === undefined) return fallback;

		return parseEnvBoolean(name, value);
	}) as EnvReader['boolean'];

	reader.number = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = optionalEnvValue(source, name);

		if (value === undefined) return fallback;

		return parseEnvNumber(name, value);
	}) as EnvReader['number'];

	reader.integer = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = optionalEnvValue(source, name);

		if (value === undefined) return fallback;

		const parsed = parseEnvNumber(name, value);

		if (!Number.isInteger(parsed)) {
			throw new Error(`Environment variable "${name}" must be an integer.`);
		}

		return parsed;
	}) as EnvReader['integer'];

	reader.array = (<TDefault>(name: string, fallback?: TDefault) => {
		const value = optionalEnvValue(source, name);

		if (value === undefined) return fallback;

		return value
			.split(',')
			.map(item => item.trim())
			.filter(item => item.length > 0);
	}) as EnvReader['array'];

	reader.json = (<TValue = unknown, TDefault = TValue>(name: string, fallback?: TDefault) => {
		const value = optionalEnvValue(source, name);

		if (value === undefined) return fallback;

		try {
			return JSON.parse(value) as TValue;
		} catch (error) {
			throw new Error(`Environment variable "${name}" must contain valid JSON.`, {
				cause: error,
			});
		}
	}) as EnvReader['json'];

	return reader;
}

export const env = createEnv();

/**
 * Returns a normalized optional env value for typed parsers.
 *
 * @param source - Environment-like source object.
 * @param name - Environment variable name.
 * @returns Trimmed string value or undefined when absent or empty.
 */
function optionalEnvValue(source: EnvSource, name: string): string | undefined {
	const value = source[name]?.trim();

	return value === '' ? undefined : value;
}

/**
 * Parses a boolean environment variable.
 *
 * @param name - Environment variable name for error messages.
 * @param value - Raw environment variable value.
 * @returns Parsed boolean value.
 */
function parseEnvBoolean(name: string, value: string): boolean {
	switch (value.toLowerCase()) {
		case '1':
		case 'true':
		case 'yes':
		case 'on':
			return true;

		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false;

		default:
			throw new Error(`Environment variable "${name}" must be a boolean.`);
	}
}

/**
 * Parses a finite number environment variable.
 *
 * @param name - Environment variable name for error messages.
 * @param value - Raw environment variable value.
 * @returns Parsed number.
 */
function parseEnvNumber(name: string, value: string): number {
	const parsed = Number(value);

	if (!Number.isFinite(parsed)) {
		throw new Error(`Environment variable "${name}" must be a number.`);
	}

	return parsed;
}
