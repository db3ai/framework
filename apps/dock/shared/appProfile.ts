import type { ProcessKind } from './contracts.js';
import { processKind } from './processKind.js';

/** File name of an app profile in a project's root folder. */
export const APP_PROFILE_FILE = 'db3.app.json';

const KINDS: ProcessKind[] = ['api', 'web', 'queue', 'scheduler', 'script'];
const DATABASE_ENGINES = ['mariadb', 'postgres'] as const;
const NAME = /^[a-z][a-z0-9-]{0,63}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** One long-running process of an app, run as an npm script from the project folder. */
export interface AppProcess {
	/** Role name, unique within the profile, such as `web` or `queue`. */
	name: string;
	/** Broad role, used for presentation and scaling defaults. */
	kind: ProcessKind;
	/** npm script that runs the process once deployed. */
	script: string;
	/** npm script to run instead during local development; defaults to `script`. */
	dev?: string;
	/** Arguments passed after `--`. */
	args: string[];
	/** TCP port the process listens on, for routing and health checks. */
	port?: number;
	/** HTTP path that answers with a 2xx status once the process is ready. */
	health?: string;
}

/**
 * Describes how an app is built and run, independent of where it runs.
 *
 * Dock reads it to set up a project's processes; deployment tooling reads the
 * same file to build an image and run each process. It names environment
 * variables but never holds their values.
 */
export interface AppProfile {
	version: 1;
	/** App name, lower-case letters, digits and hyphens. */
	name: string;
	/** npm script that builds the app for deployment. */
	build?: { script: string };
	/** Long-running processes in display order. */
	processes: AppProcess[];
	/** Database the app needs; its connection variables are supplied by the host. */
	database?: { engine: (typeof DATABASE_ENGINES)[number]; migrate?: string };
	/** Environment variable names the app reads. */
	env: { required: string[]; optional: string[] };
}

/** Raised when a profile is not valid; the message names the field at fault. */
export class AppProfileError extends Error {
	constructor(message: string) {
		super(`${APP_PROFILE_FILE}: ${message}`);
		this.name = 'AppProfileError';
	}
}

/**
 * Validates parsed profile JSON and fills in defaults.
 *
 * @param value - Parsed contents of `db3.app.json`.
 * @returns The normalised profile.
 * @throws AppProfileError naming the first invalid field.
 */
export function parseAppProfile(value: unknown): AppProfile {
	const json = record(value, 'the file');
	if (json.version !== 1) throw new AppProfileError('"version" must be 1.');
	const name = text(json.name, '"name"');
	if (!NAME.test(name)) throw new AppProfileError('"name" must be lower-case letters, digits and hyphens, starting with a letter.');
	if (!Array.isArray(json.processes) || json.processes.length === 0) throw new AppProfileError('"processes" must list at least one process.');
	const processes = json.processes.map((item, index) => parseProcess(item, `processes[${index}]`));
	const seen = new Set<string>();
	for (const process of processes) {
		if (seen.has(process.name)) throw new AppProfileError(`process name "${process.name}" is used twice.`);
		seen.add(process.name);
	}
	const profile: AppProfile = { version: 1, name, processes, env: parseEnv(json.env) };
	if (json.build !== undefined) profile.build = { script: text(record(json.build, '"build"').script, '"build.script"') };
	if (json.database !== undefined) {
		const database = record(json.database, '"database"');
		const engine = DATABASE_ENGINES.find(item => item === database.engine);
		if (!engine) throw new AppProfileError(`"database.engine" must be one of ${DATABASE_ENGINES.join(', ')}.`);
		profile.database = { engine };
		if (database.migrate !== undefined) profile.database.migrate = text(database.migrate, '"database.migrate"');
	}
	return profile;
}

/**
 * Lists the npm scripts a profile refers to that a project does not define.
 *
 * @param profile - A parsed profile.
 * @param scripts - Script names from the project's package.json.
 * @returns Messages such as `process "web" runs script "dev"`, empty when all exist.
 */
export function missingProfileScripts(profile: AppProfile, scripts: Iterable<string>): string[] {
	const defined = new Set(scripts);
	const references: Array<[string, string | undefined]> = [
		['"build.script"', profile.build?.script],
		['"database.migrate"', profile.database?.migrate],
		...profile.processes.flatMap((process): Array<[string, string | undefined]> => [
			[`process "${process.name}"`, process.script],
			[`process "${process.name}" in development`, process.dev],
		]),
	];
	return references
		.filter((reference): reference is [string, string] => !!reference[1] && !defined.has(reference[1]))
		.map(([owner, script]) => `${owner} runs script "${script}"`);
}

function parseProcess(value: unknown, path: string): AppProcess {
	const json = record(value, path);
	const name = text(json.name, `"${path}.name"`);
	if (!NAME.test(name)) throw new AppProfileError(`"${path}.name" must be lower-case letters, digits and hyphens, starting with a letter.`);
	const script = text(json.script, `"${path}.script"`);
	const kind = json.kind === undefined ? processKind(name) : KINDS.find(item => item === json.kind);
	if (!kind) throw new AppProfileError(`"${path}.kind" must be one of ${KINDS.join(', ')}.`);
	const process: AppProcess = { name, kind, script, args: [] };
	if (json.dev !== undefined) process.dev = text(json.dev, `"${path}.dev"`);
	if (json.args !== undefined) {
		if (!Array.isArray(json.args) || !json.args.every(arg => typeof arg === 'string')) throw new AppProfileError(`"${path}.args" must be a list of strings.`);
		process.args = [...json.args];
	}
	if (json.port !== undefined) {
		if (!Number.isInteger(json.port) || (json.port as number) < 1 || (json.port as number) > 65535) throw new AppProfileError(`"${path}.port" must be a port number.`);
		process.port = json.port as number;
	}
	if (json.health !== undefined) {
		const health = text(json.health, `"${path}.health"`);
		if (!health.startsWith('/')) throw new AppProfileError(`"${path}.health" must be a path starting with "/".`);
		process.health = health;
	}
	return process;
}

function parseEnv(value: unknown): AppProfile['env'] {
	if (value === undefined) return { required: [], optional: [] };
	const json = record(value, '"env"');
	return { required: names(json.required, '"env.required"'), optional: names(json.optional, '"env.optional"') };
}

function names(value: unknown, field: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every(item => typeof item === 'string' && ENV_NAME.test(item))) {
		throw new AppProfileError(`${field} must be a list of variable names such as "APP_ORIGIN".`);
	}
	return [...new Set(value as string[])];
}

function record(value: unknown, field: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppProfileError(`${field} must be an object.`);
	return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new AppProfileError(`${field} must be a non-empty string.`);
	return value.trim();
}
