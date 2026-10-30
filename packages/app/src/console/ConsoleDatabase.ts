import knex, { type Knex } from 'knex';
import { FIELD_SETTINGS_TABLE } from '../db/migrations/FieldSettingsWriter';
import { FileTableDefinitionStore } from '../db/tables/FileTableDefinitionStore';
import { ConsoleError } from './ConsoleError';
import type { ConsoleColumn, ConsoleFieldSettings, ConsoleLinkOptions, ConsoleRows, ConsoleTable } from './contracts';

/** Columns whose values are secrets: never sent, never written from the console. */
export const SECRET_COLUMN = /pass(word|wd)?$|password|secret|token|api_?key|activation_key|_hash$|^hash$|remember/i;
/** Tables the framework and migration tools keep for themselves: rows are shown but not changed. */
export const SYSTEM_TABLE = /(^|_)migrations(_lock)?$|^knex_/i;
/** Largest page of rows. */
const MAX_LIMIT = 100;
/** Longest text sent for one value; longer values are cut and marked. */
const MAX_VALUE = 2000;
/** Most rows a link dropdown lists at once. */
const MAX_OPTIONS = 50;

type Row = Record<string, unknown>;

/**
 * Runs the console's SQL wherever the database is: through Knex in Dock, or over db3 Cloud's
 * agent. Statements use `?` placeholders with bound values and backtick-quoted names.
 */
export interface ConsoleExecutor {
	/** Knex client name of the database, such as `mysql2`. */
	readonly client: string;
	/** Runs one statement: rows for a read, the changed row count for a write. */
	run(sql: string, bindings: readonly unknown[]): Promise<{ rows: Row[]; affectedRows: number }>;
}

/** The table files a console marks as defined in the repo, such as `db3/tables`. */
export interface ConsoleTableFiles {
	/** Each table file: the table it defines and its path from the repo root. */
	list(): Promise<{ name: string; path: string }[]>;
}

/** Runs console SQL over a Knex connection. */
export function knexExecutor(connection: Knex): ConsoleExecutor {
	return {
		client: String(connection.client.config.client ?? ''),
		async run(sql, bindings) {
			const result = await connection.raw(sql, bindings as Knex.RawBinding[]);
			const first = Array.isArray(result) ? result[0] : result;
			if (Array.isArray(first)) return { rows: first as Row[], affectedRows: 0 };
			if (first && typeof first === 'object' && Array.isArray((first as { rows?: unknown }).rows)) return { rows: (first as { rows: Row[] }).rows, affectedRows: Number((first as { rowCount?: number }).rowCount ?? 0) };
			return { rows: [], affectedRows: Number((first as { affectedRows?: number } | undefined)?.affectedRows ?? 0) };
		},
	};
}

/** The table files in a folder such as `<repo>/db3/tables`, named from the repo root. */
export function tableFilesIn(directory: string, label = 'db3/tables'): ConsoleTableFiles {
	return { list: async () => (await new FileTableDefinitionStore(directory).list()).map(item => ({ name: item.definition.name, path: `${label}/${item.path}` })) };
}

type Link = { table: ConsoleTable; key: string; display: string[] };

/**
 * Reads and edits an app's own tables for the console: the tables with their columns, keys,
 * links and field settings, a page of rows, one-row writes and link dropdowns. Every table and
 * column name in a statement is one information_schema reported, and values are bound, so
 * nothing from the browser reaches the database as SQL. Statements are built here and run by an
 * executor, so a host such as Dock or db3 Cloud decides how they reach the database. MariaDB and
 * MySQL only for now.
 */
export class ConsoleDatabase {
	/** Builds statements only; it never connects. */
	private readonly knex: Knex = knex({ client: 'mysql2' });
	private readonly executor: ConsoleExecutor;
	private readonly tableFiles: ConsoleTableFiles | null;

	/**
	 * @param executor - Runs the SQL, or a Knex connection to run it on.
	 * @param tableFiles - The repo's table files, to mark tables defined there; a folder or a source.
	 */
	constructor(executor: ConsoleExecutor | Knex, tableFiles: ConsoleTableFiles | string | null = null) {
		this.executor = 'run' in executor ? executor : knexExecutor(executor);
		this.tableFiles = typeof tableFiles === 'string' ? tableFilesIn(tableFiles) : tableFiles;
	}

	/** Why the console can't read this database, or null when it can. */
	unavailableReason(): string | null {
		const client = this.executor.client;
		return /mysql|maria/i.test(client) ? null : `The console reads MariaDB and MySQL databases; this app uses ${client || 'another database'}.`;
	}

	/** Lists the database's tables, without db3_tables itself. */
	async tables(): Promise<ConsoleTable[]> {
		this.#assertAvailable();
		const [list, columns, foreignKeys] = await Promise.all([
			this.#select("SELECT TABLE_NAME AS name, TABLE_ROWS AS row_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"),
			this.#select('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, DATA_TYPE AS data_type, COLUMN_TYPE AS column_type, IS_NULLABLE AS nullable, COLUMN_KEY AS column_key, EXTRA AS extra, COLUMN_DEFAULT AS fallback FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION'),
			this.#select('SELECT TABLE_NAME AS table_name, COLUMN_NAME AS name, REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_column FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL'),
		]);
		const settings = list.some(item => item.name === FIELD_SETTINGS_TABLE)
			? await this.#select(`SELECT name, owner, definition FROM \`${FIELD_SETTINGS_TABLE}\``)
			: [];
		const files = new Map((await this.tableFiles?.list().catch(() => []) ?? []).map(item => [item.name, item.path]));

		return list.filter(item => item.name !== FIELD_SETTINGS_TABLE).map(item => {
			const name = String(item.name);
			const own: ConsoleColumn[] = columns.filter(column => column.table_name === name).map(column => {
				const reference = foreignKeys.find(key => key.table_name === name && key.name === column.name);
				return {
					name: String(column.name),
					dataType: String(column.data_type),
					columnType: String(column.column_type),
					nullable: column.nullable === 'YES',
					primary: column.column_key === 'PRI',
					autoIncrement: /auto_increment/i.test(String(column.extra ?? '')),
					generated: /GENERATED|VIRTUAL|STORED/i.test(String(column.extra ?? '')),
					default: column.fallback === null || column.fallback === undefined ? null : String(column.fallback),
					secret: SECRET_COLUMN.test(String(column.name)),
					references: reference ? { table: String(reference.ref_table), column: String(reference.ref_column) } : null,
				};
			});
			const primaryKey = own.filter(column => column.primary).map(column => column.name);
			const saved = settings.find(setting => setting.name === name);
			const file = files.get(name);
			return {
				name,
				rows: Number(item.row_count ?? 0),
				columns: own,
				primaryKey,
				readOnly: SYSTEM_TABLE.test(name) ? 'Kept by the migration tool' : primaryKey.length ? null : 'This table has no primary key, so rows cannot be told apart',
				owner: saved ? (saved.owner === 'code' ? 'code' : 'ui') : null,
				fields: saved ? parseSettings(saved.definition) : null,
				source: file ? { kind: 'file', path: file } : saved?.owner === 'code' ? { kind: 'model' } : null,
			} satisfies ConsoleTable;
		});
	}

	/**
	 * Reads one page of rows, ordered by primary key, with labels for linked rows.
	 *
	 * @param name - Table name.
	 * @param page - Page number from 1.
	 * @param limit - Rows per page, at most 100.
	 */
	async rows(name: string, page = 1, limit = 25): Promise<ConsoleRows> {
		const { found, all } = await this.#table(name);
		const size = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || 25)));
		const number = Math.max(1, Math.floor(Number(page) || 1));
		let query = this.knex(found.name).select(found.columns.map(column => column.name)).limit(size).offset((number - 1) * size);
		if (found.primaryKey.length) query = query.orderBy(found.primaryKey);
		const [rows, [count]] = await Promise.all([this.#all(query), this.#all(this.knex(found.name).count({ total: '*' }))]);
		return {
			table: found,
			rows: (rows as Row[]).map(row => shapeRow(found.columns, row)),
			linkLabels: await this.#linkLabels(found, all, rows as Row[]),
			total: Number((count as Row).total ?? 0),
			page: number,
			limit: size,
		};
	}

	/** Adds one row. */
	async insert(name: string, values: unknown): Promise<void> {
		const { found } = await this.#table(name);
		const entries = writable(found, values);
		if (!entries.length) throw new ConsoleError('Fill in at least one field.', 400);
		await this.#write(this.knex(found.name).insert(Object.fromEntries(entries)));
	}

	/** Changes one row, named by its primary key. */
	async update(name: string, key: unknown, values: unknown): Promise<void> {
		const { found } = await this.#table(name);
		const entries = writable(found, values);
		if (!entries.length) return;
		const changed = await this.#write(this.knex(found.name).where(where(found, key)).update(Object.fromEntries(entries)));
		if (!changed) throw new ConsoleError('That row is no longer there.', 404);
	}

	/** Deletes one row, named by its primary key. */
	async delete(name: string, key: unknown): Promise<void> {
		const { found } = await this.#table(name);
		writable(found, {});
		const removed = await this.#write(this.knex(found.name).where(where(found, key)).delete());
		if (!removed) throw new ConsoleError('That row is no longer there.', 404);
	}

	/**
	 * Lists rows a link column can point at: those whose label contains `q`, or the one row `row`.
	 *
	 * @param name - Table holding the link column.
	 * @param columnName - The link column.
	 * @param search - Text to look for, or one stored value.
	 */
	async options(name: string, columnName: string, search: { q?: string; row?: string }): Promise<ConsoleLinkOptions> {
		const { found, all } = await this.#table(name);
		const column = found.columns.find(item => item.name === columnName);
		const link = column && !column.secret ? linkOf(found, column, all) : null;
		if (!link) throw new ConsoleError(`${columnName} does not link to another table.`, 400);
		let query = this.knex(link.table.name).select({ value: link.key }).select(this.knex.raw(`${labelSql(link)} AS label`)).orderBy(link.key).limit(MAX_OPTIONS + 1);
		if (typeof search.row === 'string') query = query.where(link.key, search.row);
		else if (search.q?.trim()) query = query.whereRaw(`CONCAT_WS(' ', ${link.display.map(() => '??').join(', ')}) LIKE ?`, [...link.display, `%${search.q.trim().slice(0, 100).replace(/[\\%_]/g, character => `\\${character}`)}%`]);
		const rows = await this.#all(query);
		return { table: link.table.name, options: rows.slice(0, MAX_OPTIONS).map(row => ({ value: text(row.value) ?? '', label: text(row.label) ?? '' })), more: rows.length > MAX_OPTIONS };
	}

	#assertAvailable(): void {
		const reason = this.unavailableReason();
		if (reason) throw new ConsoleError(reason, 501);
	}

	async #select(sql: string): Promise<Row[]> {
		return (await this.executor.run(sql, [])).rows;
	}

	/** Runs a built read. */
	async #all(query: Knex.QueryBuilder): Promise<Row[]> {
		const { sql, bindings } = query.toSQL().toNative();
		return (await this.executor.run(sql, bindings)).rows;
	}

	/** Runs a built write, returning how many rows it changed. */
	async #write(query: Knex.QueryBuilder): Promise<number> {
		const { sql, bindings } = query.toSQL().toNative();
		return (await this.executor.run(sql, bindings)).affectedRows;
	}

	/** Finds one table, so every name used in a statement is one the database has. */
	async #table(name: string): Promise<{ found: ConsoleTable; all: ConsoleTable[] }> {
		const all = await this.tables();
		const found = all.find(item => item.name === name);
		if (!found) throw new ConsoleError('That table does not exist.', 404);
		return { found, all };
	}

	/** Reads the labels of the rows a page links to, one query per link column. */
	async #linkLabels(found: ConsoleTable, all: ConsoleTable[], rows: Row[]): Promise<Record<string, Record<string, string>>> {
		const labels: Record<string, Record<string, string>> = {};
		for (const column of found.columns) {
			const link = column.secret ? null : linkOf(found, column, all);
			const ids = [...new Set(rows.map(row => text(row[column.name])).filter((value): value is string => value !== null))];
			if (!link || !ids.length) continue;
			const named = await this.#all(this.knex(link.table.name).select({ value: link.key }).select(this.knex.raw(`${labelSql(link)} AS label`)).whereIn(link.key, ids));
			labels[column.name] = Object.fromEntries(named.map(row => [text(row.value) ?? '', text(row.label) ?? '']));
		}
		return labels;
	}
}

/** Reads a saved definition, treating anything unreadable as none. */
function parseSettings(value: unknown): ConsoleFieldSettings | null {
	try {
		const parsed = typeof value === 'string' ? JSON.parse(value) : value;
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ConsoleFieldSettings : null;
	} catch {
		return null;
	}
}

/**
 * Where a column links to, from its settings or else its foreign key, with the columns that name
 * the target's rows: the target's row label, else its first plain text column, else its key.
 */
export function linkOf(found: ConsoleTable, column: ConsoleColumn, all: ConsoleTable[]): Link | null {
	const field = found.fields?.fields?.[column.name];
	if (field?.type && field.type !== 'link') return null;
	const targetName = field?.type === 'link' ? field.link?.table : column.references?.table;
	const target = all.find(item => item.name === targetName);
	if (!target) return null;
	const key = field?.type === 'link' ? target.primaryKey[0] : column.references?.column;
	if (!key) return null;
	const usable = target.columns.filter(item => !item.secret);
	const saved = (target.fields?.display ?? []).filter(item => usable.some(other => other.name === item));
	const label = usable.find(item => !item.primary && /char|text/i.test(item.dataType));
	return { table: target, key, display: saved.length ? saved : label ? [label.name] : [key] };
}

/** The SQL that names a linked row: its label columns joined, or its key when they are empty. Names come from information_schema. */
function labelSql(link: Link): string {
	const quote = (name: string) => `\`${name.replaceAll('`', '``')}\``;
	return `COALESCE(NULLIF(CONCAT_WS(' · ', ${link.display.map(quote).join(', ')}), ''), ${quote(link.key)})`;
}

/** Checks the values a write sends: real, writable columns only. */
function writable(found: ConsoleTable, values: unknown): [string, string | number | boolean | null][] {
	if (found.readOnly) throw new ConsoleError(`${found.name} can't be changed here: ${found.readOnly.toLowerCase()}.`, 409);
	if (!values || typeof values !== 'object' || Array.isArray(values)) throw new ConsoleError('Send the row as field values.', 400);
	return Object.entries(values).map(([name, value]) => {
		const column = found.columns.find(item => item.name === name);
		if (!column) throw new ConsoleError(`${found.name} has no column ${name}.`, 400);
		if (column.secret || column.generated) throw new ConsoleError(`${name} can't be changed here.`, 400);
		if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new ConsoleError('Values must be text, numbers, yes/no or empty.', 400);
		if (typeof value === 'number' && !Number.isFinite(value)) throw new ConsoleError('Numbers must be finite.', 400);
		return [name, value as string | number | boolean | null];
	});
}

/** The condition naming one row by its primary key. */
function where(found: ConsoleTable, key: unknown): Record<string, string | number> {
	if (!found.primaryKey.length || !key || typeof key !== 'object') throw new ConsoleError('Say which row.', 400);
	return Object.fromEntries(found.primaryKey.map(name => {
		const value = (key as Row)[name];
		if (typeof value !== 'string' && typeof value !== 'number') throw new ConsoleError('Say which row.', 400);
		return [name, value];
	}));
}

/** Shapes one row for the screens: text values, secrets hidden, long text cut. */
function shapeRow(columns: ConsoleColumn[], row: Row): Record<string, string | null> {
	return Object.fromEntries(columns.map(column => {
		if (column.secret) return [column.name, null];
		const value = text(row[column.name], column.dataType);
		return [column.name, value !== null && value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value];
	}));
}

/**
 * Writes a driver value as the text MariaDB's own client would show: dates in UTC (the framework's
 * connection time zone), binary as hex.
 */
function text(value: unknown, dataType = ''): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) {
		const iso = value.toISOString();
		return dataType.toLowerCase() === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
	}
	if (Buffer.isBuffer(value)) return value.toString('hex');
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}
