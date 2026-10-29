import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseTableDefinition, assertTableSet, type TableDefinition } from './TableDefinition';

/** A table definition with the file it came from and a revision of that file's exact content. */
export interface StoredTableDefinition {
	definition: TableDefinition;
	/** SHA-256 of the file; a save based on an older revision is refused. */
	revision: string;
	/** Path relative to the store root, `<name>.json`. */
	path: string;
}

/** Error thrown when a save would overwrite a table file that changed after it was read. */
export class TableDefinitionConflictError extends Error {
	/** @param name - Table name. */
	constructor(public readonly name: string) {
		super(`Table definition "${name}" changed after it was loaded.`);
		this.name = 'TableDefinitionConflictError';
	}
}

/**
 * Keeps table designs as one deterministic JSON file per table (`db3/tables/<name>.json`), so
 * they live in the app's repo, diff cleanly and move between machines with git. Like the flow
 * store, every save carries the revision it was based on.
 */
export class FileTableDefinitionStore {
	readonly #root: string;

	/** @param root - Directory holding the table files, usually `<app>/db3/tables`. */
	constructor(root: string) {
		this.#root = resolve(root);
	}

	/** The directory this store reads and writes. */
	get root(): string {
		return this.#root;
	}

	/**
	 * Reads every table file, sorted by name.
	 * @returns Stored definitions.
	 */
	async list(): Promise<StoredTableDefinition[]> {
		let names: string[];
		try { names = (await readdir(this.#root)).filter(file => file.endsWith('.json')).sort(); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
		return Promise.all(names.map(async file => stored(file, await readFile(join(this.#root, file), 'utf8'))));
	}

	/**
	 * Reads one table file.
	 * @param name - Table name.
	 * @returns The stored definition, or null when there is no file.
	 */
	async read(name: string): Promise<StoredTableDefinition | null> {
		return (await this.list()).find(item => item.definition.name === name) ?? null;
	}

	/**
	 * Writes a table file atomically. A new table needs no revision; changing one needs the
	 * revision it was read at. The whole set is checked first, so a link to a table with no file
	 * is refused before anything is written.
	 *
	 * @param input - Table definition.
	 * @param options - The revision the change is based on, or null for a new table.
	 * @returns The stored definition.
	 */
	async write(input: unknown, options: { expectedRevision: string | null }): Promise<StoredTableDefinition> {
		const definition = parseTableDefinition(input);
		const all = await this.list();
		const existing = all.find(item => item.definition.name === definition.name) ?? null;
		if ((existing?.revision ?? null) !== options.expectedRevision) throw new TableDefinitionConflictError(definition.name);
		assertTableSet([...all.filter(item => item !== existing).map(item => item.definition), definition]);
		const content = serializeTableDefinition(definition);
		const path = `${definition.name}.json`;
		const target = join(this.#root, path);
		const temporary = join(this.#root, `.${path}.${process.pid}.${Date.now()}.tmp`);
		await mkdir(this.#root, { recursive: true });
		await writeFile(temporary, content, 'utf8');
		await rename(temporary, target);
		return { definition, revision: revisionFor(content), path };
	}

	/**
	 * Removes a table file, if it is still at the revision it was read at.
	 * @param name - Table name.
	 * @param expectedRevision - Revision read before.
	 */
	async remove(name: string, expectedRevision: string): Promise<void> {
		const existing = await this.read(name);
		if (!existing || existing.revision !== expectedRevision) throw new TableDefinitionConflictError(name);
		const others = (await this.list()).filter(item => item !== existing && item.definition.name !== name);
		const linking = others.find(item => item.definition.fields.some(field => field.link?.table === name));
		if (linking) throw new Error(`${linking.definition.name} links to ${name}; remove that field first.`);
		await rm(join(this.#root, existing.path));
	}
}

/**
 * Reads table files synchronously, for building the model registry when an app starts.
 *
 * @param root - Directory holding the table files.
 * @returns Definitions sorted by file name; none when the directory does not exist.
 */
export function readTableDefinitionsSync(root: string): TableDefinition[] {
	let names: string[];
	try { names = readdirSync(root).filter(file => file.endsWith('.json')).sort(); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
	const tables = names.map(file => stored(file, readFileSync(join(root, file), 'utf8')).definition);
	assertTableSet(tables);
	return tables;
}

/**
 * Writes a definition as tab-indented JSON with a stable key order, one trailing newline.
 * @param definition - Table definition.
 * @returns File content.
 */
export function serializeTableDefinition(definition: TableDefinition): string {
	const ordered = {
		version: definition.version, name: definition.name,
		...(definition.label ? { label: definition.label } : {}),
		...(definition.display?.length ? { display: definition.display } : {}),
		fields: definition.fields.map(field => ({
			name: field.name, type: field.type,
			...(field.label ? { label: field.label } : {}),
			...(field.help ? { help: field.help } : {}),
			...(field.required ? { required: true } : {}),
			...(field.choices ? { choices: field.choices } : {}),
			...(field.link ? { link: { table: field.link.table } } : {}),
		})),
	};
	return `${JSON.stringify(ordered, null, '\t')}\n`;
}

/** Parses one file and checks its name matches the table it defines. */
function stored(file: string, content: string): StoredTableDefinition {
	let parsed: unknown;
	try { parsed = JSON.parse(content); }
	catch (error) { throw new Error(`Invalid table JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`); }
	const definition = parseTableDefinition(parsed, `table file ${file}`);
	if (`${definition.name}.json` !== file) throw new Error(`Table file ${file} defines ${definition.name}; name it ${definition.name}.json.`);
	return { definition, revision: revisionFor(content), path: file };
}

/** SHA-256 of a file's content. */
function revisionFor(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}
