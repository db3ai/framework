import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

import type { FlowDefinition, FlowDefinitionStore, FlowDefinitionSummary, FlowDefinitionWriteOptions, StoredFlowDefinition } from '../contracts';

/**
 * Options for a Git-friendly file definition provider.
 */
export interface FileFlowDefinitionStoreOptions {
	/** Directory containing `flow.json` or `*.flow.json` definitions. */
	root: string;
}

/**
 * Error thrown when a save would overwrite a newer definition revision.
 */
export class FlowDefinitionConflictError extends Error {
	/**
	 * Creates a revision conflict error.
	 *
	 * @param id - Flow definition ULID.
	 */
	constructor(public readonly id: string) {
		super(`Flow definition "${id}" changed after it was loaded.`);
		this.name = 'FlowDefinitionConflictError';
	}
}

/**
 * Stores source-of-truth flow definitions as deterministic project JSON files.
 */
export class FileFlowDefinitionStore implements FlowDefinitionStore {
	readonly #root: string;

	/**
	 * Creates a file definition provider rooted inside one project.
	 *
	 * @param options - File provider options.
	 */
	constructor(options: FileFlowDefinitionStoreOptions) {
		this.#root = resolve(options.root);
	}

	/**
	 * Lists every readable definition beneath the configured root.
	 *
	 * @returns Flow summaries ordered by name.
	 */
	async list(): Promise<FlowDefinitionSummary[]> {
		const definitions = await this.#readAll();

		return definitions
				.map(stored => ({
					id: stored.definition.id,
					name: stored.definition.name,
					description: stored.definition.description,
					inputs: structuredClone(stored.definition.inputs),
					outputs: structuredClone(stored.definition.outputs),
					revision: stored.revision,
				path: stored.path,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Loads one definition by its stable flow ULID.
	 *
	 * @param id - Flow ULID.
	 * @returns Stored definition or null.
	 */
	async read(id: string): Promise<StoredFlowDefinition | null> {
		const matches = (await this.#readAll()).filter(stored => stored.definition.id === id);

		if (matches.length > 1) {
			throw new Error(`Flow definition id "${id}" is duplicated in the file store.`);
		}

		return matches[0] ?? null;
	}

	/**
	 * Creates or atomically replaces one deterministic JSON definition file.
	 *
	 * @param definition - Definition to persist.
	 * @param options - Optional expected revision and creation path.
	 * @returns Stored definition metadata after writing.
	 */
	async write(
		definition: FlowDefinition,
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
			?? normalizeRelativePath(options.path ?? `${slugify(definition.name)}/flow.json`);
		const occupied = storedDefinitions.find(stored => stored.path === path && stored.definition.id !== definition.id);

		if (occupied) {
			throw new Error(`Flow definition path "${path}" is already used by "${occupied.definition.id}".`);
		}

		const absolutePath = this.#resolvePath(path);
		const content = serializeDefinition(definition);
		const temporaryPath = resolve(dirname(absolutePath), `.${basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`);

		await mkdir(dirname(absolutePath), { recursive: true });
		await writeFile(temporaryPath, content, 'utf8');
		await rename(temporaryPath, absolutePath);

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
		const paths = await findDefinitionFiles(this.#root);
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
	 * @param absolutePath - Absolute definition file path.
	 * @returns Parsed definition with provider metadata.
	 */
	async #readPath(absolutePath: string): Promise<StoredFlowDefinition> {
		const content = await readFile(absolutePath, 'utf8');
		let parsed: unknown;

		try {
			parsed = JSON.parse(content);
		} catch (error) {
			throw new Error(`Invalid flow JSON at "${relative(this.#root, absolutePath)}": ${error instanceof Error ? error.message : String(error)}`);
		}

		assertDefinitionEnvelope(parsed, relative(this.#root, absolutePath));

		return {
			definition: parsed,
			revision: revisionFor(content),
			path: relative(this.#root, absolutePath).split(sep).join('/'),
		};
	}

	/**
	 * Resolves and contains a provider-relative path beneath the configured root.
	 *
	 * @param path - Provider-relative definition path.
	 * @returns Contained absolute filesystem path.
	 */
	#resolvePath(path: string): string {
		const absolutePath = resolve(this.#root, normalizeRelativePath(path));

		if (absolutePath !== this.#root && !absolutePath.startsWith(`${this.#root}${sep}`)) {
			throw new Error('Flow definition path must remain inside the configured root.');
		}

		return absolutePath;
	}
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

		if (entry.isFile() && (entry.name === 'flow.json' || entry.name.endsWith('.flow.json'))) {
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
function serializeDefinition(definition: FlowDefinition): string {
	return `${JSON.stringify(orderDefinition(definition), null, '\t')}\n`;
}

/**
 * Applies a readable stable property order to a source definition.
 *
 * @param definition - Definition to normalize for source control.
 * @returns Definition-shaped object with stable property order.
 */
function orderDefinition(definition: FlowDefinition): Record<string, unknown> {
	return {
		schemaVersion: definition.schemaVersion,
		id: definition.id,
		name: definition.name,
		...(definition.description ? { description: definition.description } : {}),
		inputs: sortRecord(definition.inputs),
		outputs: sortRecord(definition.outputs),
		blocks: definition.blocks.map(block => ({
			id: block.id,
			type: block.type,
			...(block.name ? { name: block.name } : {}),
			...(block.flowId ? { flowId: block.flowId } : {}),
			...(block.config ? { config: sortRecord(block.config) } : {}),
			position: {
				x: Math.round(block.position.x),
				y: Math.round(block.position.y),
			},
		})),
		connections: definition.connections.map(connection => ({
			id: connection.id,
			sourceBlockId: connection.sourceBlockId,
			sourcePort: connection.sourcePort,
			targetBlockId: connection.targetBlockId,
			targetPort: connection.targetPort,
		})),
	};
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
 * Produces a readable provider path segment from a flow name.
 *
 * @param name - Human-readable flow name.
 * @returns Safe lowercase path segment.
 */
function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	return slug || 'flow';
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

	if (!(normalized.endsWith('/flow.json') || normalized.endsWith('.flow.json'))) {
		throw new Error('Flow definition files must be named flow.json or end with .flow.json.');
	}

	return normalized;
}

/**
 * Checks the basic envelope required before treating parsed JSON as a definition.
 *
 * @param value - Parsed JSON value.
 * @param path - Provider path used in validation errors.
 */
function assertDefinitionEnvelope(value: unknown, path: string): asserts value is FlowDefinition {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Flow definition at "${path}" must be an object.`);
	}

	const definition = value as Partial<FlowDefinition>;

	if (definition.schemaVersion !== 1 || typeof definition.id !== 'string' || typeof definition.name !== 'string') {
		throw new Error(`Flow definition at "${path}" has an invalid version, id, or name.`);
	}

	if (!Array.isArray(definition.blocks) || !Array.isArray(definition.connections)) {
		throw new Error(`Flow definition at "${path}" requires block and connection arrays.`);
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
