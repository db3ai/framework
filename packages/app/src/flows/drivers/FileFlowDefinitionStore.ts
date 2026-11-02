import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import { isFlowGraphDefinition, type FlowDefinitionStore, type FlowDefinitionSummary, type FlowDefinitionWriteOptions, type FlowGraphDefinition, type FlowValueDefinition, type FlowValueDefinitions, type StoredFlowDefinition } from '../contracts';

/** Where the flow files are. */
export interface FileFlowDefinitionStoreOptions {
	/** Directory containing `*.flow.json` files. */
	root?: string;
	/** Where the files are kept instead of a directory, such as a git branch. */
	source?: FlowFileSource;
}

/** Flow files kept elsewhere; paths are relative to the flows folder. */
export interface FlowFileSource {
	list(): Promise<string[]>;
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
}

/** A save would overwrite a newer revision. */
export class FlowDefinitionConflictError extends Error {
	constructor(public readonly id: string) {
		super(`Flow definition "${id}" changed after it was loaded.`);
		this.name = 'FlowDefinitionConflictError';
	}
}

/**
 * Stores source-of-truth flow definitions as deterministic project JSON files.
 */
export class FileFlowDefinitionStore implements FlowDefinitionStore {
	readonly #source: FlowFileSource;

	constructor(options: FileFlowDefinitionStoreOptions) {
		if (options.source) this.#source = options.source;
		else if (options.root) this.#source = directorySource(resolve(options.root));
		else throw new Error('Give the flow file store a root or a source.');
	}

	/** Every flow, by name. */
	async list(): Promise<FlowDefinitionSummary[]> {
		const definitions = await this.#readAll();

		return definitions
				.map(stored => ({
					id: stored.definition.id,
					name: stored.definition.name,
					...(stored.definition.title ? { title: stored.definition.title } : {}),
					description: stored.definition.description,
					inputs: structuredClone(stored.definition.inputs),
					outputs: outputContract(stored.definition),
					revision: stored.revision,
				path: stored.path,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** One flow by id, or null. */
	async read(id: string): Promise<StoredFlowDefinition | null> {
		const matches = (await this.#readAll()).filter(stored => stored.definition.id === id);

		if (matches.length > 1) {
			throw new Error(`Flow definition id "${id}" is duplicated in the file store.`);
		}

		return matches[0] ?? null;
	}

	/** Creates or replaces one flow's file, refusing a stale `expectedRevision`. */
	async write(
		definition: FlowGraphDefinition,
		options: FlowDefinitionWriteOptions = {},
	): Promise<StoredFlowDefinition> {
		const storedDefinitions = await this.#readAll();
		const existing = storedDefinitions.find(stored => stored.definition.id === definition.id) ?? null;

		if (options.expectedRevision && existing?.revision !== options.expectedRevision) {
			throw new FlowDefinitionConflictError(definition.id);
		}

		if (options.expectedRevision && !existing) {
			throw new FlowDefinitionConflictError(definition.id);
		}

		const path = existing?.path
			?? normalizeRelativePath(options.path ?? `${definition.name}.flow.json`);
		const occupied = storedDefinitions.find(stored => stored.path === path && stored.definition.id !== definition.id);

		if (occupied) {
			throw new Error(`Flow definition path "${path}" is already used by "${occupied.definition.id}".`);
		}

		const content = serializeDefinition(definition);
		await this.#source.write(path, content);

		return {
			definition: structuredClone(definition),
			revision: revisionFor(content),
			path,
		};
	}

	/**
	 * Reads and parses every matching definition file beneath the root.
	 *
	 * @returns Stored definitions with provider paths and content revisions.
	 */
	async #readAll(): Promise<StoredFlowDefinition[]> {
		const paths = (await this.#source.list()).map(normalizeRelativePath).sort();
		const definitions = await Promise.all(paths.map(path => this.#readPath(path)));
		const ids = new Set<string>();

		for (const stored of definitions) {
			if (ids.has(stored.definition.id)) {
				throw new Error(`Flow definition id "${stored.definition.id}" is duplicated in the file store.`);
			}

			ids.add(stored.definition.id);
		}

		return definitions;
	}

	/**
	 * Reads one definition file and attaches revision metadata.
	 *
	 * @param path - Path relative to the flows folder.
	 * @returns Parsed definition with provider metadata.
	 */
	async #readPath(path: string): Promise<StoredFlowDefinition> {
		const content = await this.#source.read(path);
		let parsed: unknown;

		try {
			parsed = JSON.parse(content);
		} catch (error) {
			throw new Error(`Invalid flow JSON at "${path}": ${error instanceof Error ? error.message : String(error)}`);
		}

		assertDefinitionEnvelope(parsed, path);

		return { definition: parsed, revision: revisionFor(content), path };
	}
}

/**
 * Flow files in a local directory, written atomically.
 *
 * @param root - Absolute directory.
 * @returns File source.
 */
function directorySource(root: string): FlowFileSource {
	const contained = (path: string) => {
		const absolutePath = resolve(root, path);
		if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) throw new Error('Flow definition path must remain inside the configured root.');
		return absolutePath;
	};
	return {
		list: async () => (await findDefinitionFiles(root)).map(path => relative(root, path).split(sep).join('/')),
		read: path => readFile(contained(path), 'utf8'),
		async write(path, content) {
			const absolutePath = contained(path);
			const temporaryPath = resolve(dirname(absolutePath), `.${basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`);
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(temporaryPath, content, 'utf8');
			await rename(temporaryPath, absolutePath);
		},
	};
}

/**
 * Finds definition files recursively while tolerating an absent root directory.
 *
 * @param root - Absolute directory to scan.
 * @returns Sorted matching definition paths.
 */
async function findDefinitionFiles(root: string): Promise<string[]> {
	let entries;

	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if (isMissingPathError(error)) return [];
		throw error;
	}

	const paths: string[] = [];

	for (const entry of entries) {
		const path = resolve(root, entry.name);

		if (entry.isDirectory()) {
			paths.push(...await findDefinitionFiles(path));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.flow.json')) {
			paths.push(path);
		}
	}

	return paths.sort();
}

/**
 * Serializes a definition with deterministic object-key ordering and tab indentation.
 *
 * @param definition - Source definition to serialize.
 * @returns Git-friendly JSON content ending in a newline.
 */
function serializeDefinition(definition: FlowGraphDefinition): string {
	return `${JSON.stringify(orderGraphDefinition(definition), null, '\t')}\n`;
}

/**
 * Applies the version 2 section order: what the flow is, how it starts, its steps,
 * its edges, then canvas positions last so moving a box leaves the logic untouched.
 * Steps keep the order they were written in.
 *
 * @param definition - Version 2 flow.
 * @returns Flow-shaped object with stable property order.
 */
function orderGraphDefinition(definition: FlowGraphDefinition): Record<string, unknown> {
	return {
		schemaVersion: 2,
		id: definition.id,
		name: definition.name,
		...(definition.title ? { title: definition.title } : {}),
		...(definition.description ? { description: definition.description } : {}),
		inputs: sortRecord(definition.inputs),
		...(definition.outputs && Object.keys(definition.outputs).length ? { outputs: sortRecord(definition.outputs) } : {}),
		...(definition.triggers && Object.keys(definition.triggers).length ? { triggers: definition.triggers } : {}),
		steps: Object.fromEntries(Object.entries(definition.steps).map(([name, step]) => [name, {
			type: step.type,
			...(step.title ? { title: step.title } : {}),
			...(step.flow ? { flow: step.flow } : {}),
			...(step.config ? { config: step.config } : {}),
			...(step.attach ? { attach: step.attach } : {}),
		}])),
		edges: definition.edges,
		...(definition.layout ? { layout: Object.fromEntries(Object.entries(definition.layout).map(([name, [x, y]]) => [name, [Math.round(x), Math.round(y)]])) } : {}),
	};
}

/**
 * The public output contract, without version 2 output values.
 *
 * @param definition - Flow of either shape.
 * @returns Output definitions.
 */
function outputContract(definition: FlowGraphDefinition): FlowValueDefinitions {
	return Object.fromEntries(Object.entries(definition.outputs ?? {}).map(([name, output]) => {
		const { value: _value, ...contract } = output as FlowValueDefinition & { value?: unknown };
		return [name, structuredClone(contract)];
	}));
}

/**
 * Sorts record keys recursively while preserving array order.
 *
 * @param record - Record to normalize.
 * @returns Record with stable key ordering.
 */
function sortRecord(record: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(record)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, value]) => [key, sortValue(value)]),
	);
}

/**
 * Normalizes nested configuration and schema values for deterministic output.
 *
 * @param value - Unknown nested value.
 * @returns Recursively ordered value.
 */
function sortValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortValue);
	if (!value || typeof value !== 'object') return value;

	return sortRecord(value as Record<string, unknown>);
}

/**
 * Calculates the optimistic-concurrency revision for exact file content.
 *
 * @param content - Exact serialized definition content.
 * @returns SHA-256 hexadecimal content revision.
 */
function revisionFor(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

/**
 * Rejects absolute and parent-traversing provider paths.
 *
 * @param path - Candidate provider-relative path.
 * @returns Normalized safe definition path.
 */
function normalizeRelativePath(path: string): string {
	const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');

	if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
		throw new Error('Flow definition path must be a safe relative path.');
	}

	if (!normalized.endsWith('.flow.json')) {
		throw new Error('Flow definition files end with .flow.json.');
	}

	return normalized;
}

/**
 * Checks the basic envelope required before treating parsed JSON as a definition.
 *
 * @param value - Parsed JSON value.
 * @param path - Provider path used in validation errors.
 */
function assertDefinitionEnvelope(value: unknown, path: string): asserts value is FlowGraphDefinition {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Flow definition at "${path}" must be an object.`);
	}

	if (!isFlowGraphDefinition(value)) throw new Error(`Flow definition at "${path}" must use schemaVersion 2.`);
	if (typeof value.id !== 'string' || typeof value.name !== 'string' || !value.steps || typeof value.steps !== 'object' || !Array.isArray(value.edges)) {
		throw new Error(`Flow definition at "${path}" needs an id, a name, steps and edges.`);
	}
}

/**
 * Narrows filesystem errors representing an absent directory.
 *
 * @param error - Unknown filesystem failure.
 * @returns True when the error reports a missing path.
 */
function isMissingPathError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
