import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AGENT_NAME, parseAgentDefinition, serializeAgentDefinition, type AgentDefinition } from './AgentDefinition';

/** The definition file in each agent's folder. */
export const AGENT_FILE = 'agent.json';
/** The prompt file beside it, kept as Markdown so changes read well in a diff. */
export const INSTRUCTIONS_FILE = 'instructions.md';

/** An agent's files as read, with a revision of their exact content. */
export interface StoredAgentDefinition {
	definition: AgentDefinition;
	instructions: string;
	/** SHA-256 of both files; a save based on an older revision is refused. */
	revision: string;
	/** Folder relative to the store root, `<name>`. */
	path: string;
}

/** Error thrown when a save would overwrite agent files that changed after they were read. */
export class AgentDefinitionConflictError extends Error {
	/** @param name - Agent name. */
	constructor(public readonly name: string) {
		super(`Agent "${name}" changed after it was loaded.`);
		this.name = 'AgentDefinitionConflictError';
	}
}

/**
 * Keeps agents made in the console as files in the app's repo: `db3/agents/<name>/agent.json`
 * and `instructions.md`. Like the flow and table stores, files are written deterministically and
 * every save carries the revision it was based on.
 */
export class FileAgentDefinitionStore {
	readonly #root: string;

	/** @param root - Directory holding the agent folders, usually `<app>/db3/agents`. */
	constructor(root: string) {
		this.#root = resolve(root);
	}

	/** The directory this store reads and writes. */
	get root(): string {
		return this.#root;
	}

	/** Reads every agent, sorted by name. Folders without an `agent.json` are skipped. */
	async list(): Promise<StoredAgentDefinition[]> {
		let names: string[];
		try { names = (await readdir(this.#root, { withFileTypes: true })).filter(entry => entry.isDirectory() && AGENT_NAME.test(entry.name)).map(entry => entry.name).sort(); }
		catch (error) { if (missing(error)) return []; throw error; }
		const found = await Promise.all(names.map(name => this.read(name)));
		return found.filter((item): item is StoredAgentDefinition => item !== null);
	}

	/**
	 * Reads one agent.
	 * @param name - Agent name.
	 * @returns The stored agent, or null when it has no folder.
	 */
	async read(name: string): Promise<StoredAgentDefinition | null> {
		if (!AGENT_NAME.test(name)) return null;
		const folder = join(this.#root, name);
		let json: string;
		try { json = await readFile(join(folder, AGENT_FILE), 'utf8'); }
		catch (error) { if (missing(error)) return null; throw error; }
		const instructions = await readFile(join(folder, INSTRUCTIONS_FILE), 'utf8').catch(error => { if (missing(error)) return ''; throw error; });
		return stored(name, json, instructions);
	}

	/**
	 * Writes an agent's files. A new agent needs no revision; changing one needs the revision it
	 * was read at.
	 *
	 * @param input - The definition and its instructions.
	 * @param options - The revision the change is based on, or null for a new agent.
	 */
	async write(input: { definition: unknown; instructions: string }, options: { expectedRevision: string | null }): Promise<StoredAgentDefinition> {
		const definition = parseAgentDefinition(input.definition);
		const existing = await this.read(definition.name);
		if ((existing?.revision ?? null) !== options.expectedRevision) throw new AgentDefinitionConflictError(definition.name);
		const { json, instructions } = agentFiles(input);
		const folder = join(this.#root, definition.name);
		await mkdir(folder, { recursive: true });
		await writeAtomically(join(folder, INSTRUCTIONS_FILE), instructions);
		await writeAtomically(join(folder, AGENT_FILE), json);
		return { definition, instructions, revision: revisionFor(json, instructions), path: definition.name };
	}

	/**
	 * Removes an agent's folder, if it is still at the revision it was read at.
	 * @param name - Agent name.
	 * @param expectedRevision - Revision read before.
	 */
	async remove(name: string, expectedRevision: string): Promise<void> {
		const existing = await this.read(name);
		if (!existing || existing.revision !== expectedRevision) throw new AgentDefinitionConflictError(name);
		await rm(join(this.#root, name), { recursive: true });
	}
}

/**
 * Reads one agent synchronously, for constructing a defined agent.
 *
 * @param root - Directory holding the agent folders.
 * @param name - Agent name.
 * @returns The stored agent, or null when it has no files.
 */
export function readAgentDefinitionSync(root: string, name: string): StoredAgentDefinition | null {
	if (!AGENT_NAME.test(name)) return null;
	const folder = join(resolve(root), name);
	let json: string;
	try { json = readFileSync(join(folder, AGENT_FILE), 'utf8'); }
	catch (error) { if (missing(error)) return null; throw error; }
	let instructions = '';
	try { instructions = readFileSync(join(folder, INSTRUCTIONS_FILE), 'utf8'); }
	catch (error) { if (!missing(error)) throw error; }
	return stored(name, json, instructions);
}

/**
 * The two files for an agent, as they're written: `agent.json` in stable order and the
 * instructions with LF line endings. For hosts that save the files somewhere other than a folder,
 * such as a git branch.
 *
 * @param input - The definition and its instructions.
 * @returns The checked definition, both files' text and the revision they make.
 */
export function agentFiles(input: { definition: unknown; instructions: string }): { definition: AgentDefinition; json: string; instructions: string; revision: string } {
	const definition = parseAgentDefinition(input.definition);
	const json = serializeAgentDefinition(definition);
	const instructions = normalizedInstructions(input.instructions);
	return { definition, json, instructions, revision: revisionFor(json, instructions) };
}

/**
 * Reads an agent from its files' text, for hosts that don't read them from a folder.
 *
 * @param name - The agent's folder name.
 * @param json - `agent.json`.
 * @param instructions - `instructions.md`, or '' when it has none.
 */
export function agentFromFiles(name: string, json: string, instructions: string): StoredAgentDefinition {
	return stored(name, json, instructions);
}

function stored(name: string, json: string, instructions: string): StoredAgentDefinition {
	let parsed: unknown;
	try { parsed = JSON.parse(json); } catch { throw new Error(`db3/agents/${name}/${AGENT_FILE} is not valid JSON.`); }
	const definition = parseAgentDefinition(parsed);
	if (definition.name !== name) throw new Error(`db3/agents/${name}/${AGENT_FILE} names the agent "${definition.name}"; the folder and the name must match.`);
	return { definition, instructions, revision: revisionFor(json, instructions), path: name };
}

/** Line endings as LF and one trailing newline, so the prompt file diffs cleanly. */
function normalizedInstructions(value: string): string {
	const text = String(value ?? '').replace(/\r\n?/g, '\n').trimEnd();
	return text ? `${text}\n` : '';
}

function revisionFor(json: string, instructions: string): string {
	return createHash('sha256').update(json).update('\0').update(instructions).digest('hex');
}

async function writeAtomically(target: string, content: string): Promise<void> {
	const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, content, 'utf8');
	await rename(temporary, target);
}

function missing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR';
}
