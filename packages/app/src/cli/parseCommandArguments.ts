import type { CliCommand, CliOption, CliOptionValue } from './contracts';

/** Parsed literal arguments and declared option values, before application startup. */
interface ParsedCommandArguments {
	args: string[];
	options: Record<string, CliOptionValue>;
}

/**
 * Parses only declared options and preserves positional values after `--`.
 * @param command - Command whose definitions own input validation.
 * @param values - Literal argv following the command or alias.
 * @returns Parsed values; invalid or ambiguous input throws without starting an app.
 */
export function parseCommandArguments(command: CliCommand, values: readonly string[]): ParsedCommandArguments {
	const definitions = new Map((command.options ?? []).map(option => [option.name, option]));
	const options: Record<string, CliOptionValue> = Object.create(null);
	const supplied = new Set<string>();
	const args: string[] = [];
	let positional = false;
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!;
		if (positional || !value.startsWith('-') || value === '-') { args.push(value); continue; }
		if (value === '--') { positional = true; continue; }
		if (!value.startsWith('--')) throw new Error(`Unknown option ${value}.`);
		const separator = value.indexOf('=');
		const name = value.slice(2, separator < 0 ? undefined : separator);
		const definition = definitions.get(name);
		if (!definition) throw new Error(`Unknown option --${name}.`);
		if (supplied.has(name) && !(definition.type === 'string' && definition.multiple)) throw new Error(`Option --${name} may only be supplied once.`);
		let raw = separator < 0 ? undefined : value.slice(separator + 1);
		if (raw === undefined && definition.type !== 'boolean') {
			const next = values[index + 1];
			if (next === undefined || next.startsWith('--')) throw new Error(`Option --${name} requires a value.`);
			raw = next;
			index++;
		}
		const parsed = optionValue(definition, raw);
		if (definition.type === 'string' && definition.multiple) {
			options[name] = [...(supplied.has(name) ? options[name] as readonly string[] : []), parsed as string];
		} else options[name] = parsed;
		supplied.add(name);
	}
	for (const definition of definitions.values()) {
		if (supplied.has(definition.name)) continue;
		if (definition.default !== undefined) options[definition.name] = Array.isArray(definition.default) ? [...definition.default] : definition.default as CliOptionValue;
		else if (definition.required) throw new Error(`Option --${definition.name} is required.`);
	}
	const parameters = command.arguments ?? [];
	if (args.length < parameters.filter(argument => argument.required).length || args.length > parameters.length) throw new Error('Invalid arguments.');
	return { args, options };
}

/** Converts and validates one option, keeping equals signs inside literal values. */
function optionValue(definition: CliOption, raw: string | undefined): string | number | boolean {
	if (definition.type === 'boolean') {
		if (raw === undefined || raw === 'true' || raw === '1') return true;
		if (raw === 'false' || raw === '0') return false;
		throw new Error(`Option --${definition.name} requires true or false.`);
	}
	if (raw === undefined || !raw.trim()) throw new Error(`Option --${definition.name} requires a non-empty value.`);
	if (definition.type === 'string') return raw;
	const number = Number(raw);
	if (!Number.isFinite(number) || definition.integer && !Number.isInteger(number) || definition.min !== undefined && number < definition.min || definition.max !== undefined && number > definition.max) throw new Error(`Invalid numeric value for --${definition.name}.`);
	return number;
}

/** Validates declarations before a CLI accepts any invocation or exposes metadata. */
export function validateCommandOptions(command: CliCommand): void {
	const names = new Set<string>();
	for (const option of command.options ?? []) {
		if (typeof option.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(option.name) || ['help'].includes(option.name) || names.has(option.name) || typeof option.description !== 'string' || !['string', 'number', 'boolean'].includes(option.type)) throw new Error(`Invalid option declaration for ${command.name}.`);
		names.add(option.name);
		if (option.type === 'number' && (option.min !== undefined && !Number.isFinite(option.min) || option.max !== undefined && !Number.isFinite(option.max) || option.min !== undefined && option.max !== undefined && option.min > option.max)) throw new Error(`Invalid numeric bounds for --${option.name}.`);
		if (option.default !== undefined) {
			const defaults = Array.isArray(option.default) ? option.default : [option.default];
			if (Array.isArray(option.default) && !(option.type === 'string' && option.multiple)) throw new Error(`Invalid default for --${option.name}.`);
			for (const value of defaults) {
				if (typeof value !== option.type) throw new Error(`Invalid default for --${option.name}.`);
				optionValue(option, String(value));
			}
		}
	}
}
