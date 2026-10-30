import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parse } from 'dotenv';
import knex, { type Knex } from 'knex';
import { resolveDatabaseDialect } from '../db/dialects';
import { Storage } from '../storage/Storage';
import { ConsoleAgentLogs } from './ConsoleAgents';
import { ConsoleDatabase, knexExecutor, tableFilesIn } from './ConsoleDatabase';
import { fileFlows } from './ConsoleFlows';
import { ConsoleStorage } from './ConsoleStorage';
import type { ConsoleServices } from './fastify';
import { projectAgents } from './projectAgents';

/** An app's console opened straight from its repo folder, and how to close its connection. */
export interface ProjectConsole {
	services: ConsoleServices;
	close(): Promise<void>;
}

/**
 * Opens the console for an app checked out on this machine, the way Dock does: its database from
 * the settings in its `.env`, its local storage under `storage/app` (plus any disks listed in
 * `DB3_STORAGE_DISKS`), its definitions in `db3/tables`, `db3/flows` and `db3/agents`, and its
 * own `db3` command for agents written in code. The app serves nothing, so it works whether or
 * not the app is running.
 *
 * @param directory - The app's folder.
 * @param options - Name shown in the console; defaults to the folder's name.
 */
export async function openProjectConsole(directory: string, options: { name?: string } = {}): Promise<ProjectConsole> {
	const env = await readEnv(directory);
	let connection: Knex | null = null;
	let database: ConsoleServices['database'];
	let logs: ConsoleAgentLogs | null = null;
	try {
		connection = connect(env);
		const executor = knexExecutor(connection);
		database = new ConsoleDatabase(executor, tableFilesIn(join(directory, 'db3', 'tables')));
		logs = new ConsoleAgentLogs(executor);
	} catch (error) {
		database = { unavailable: error instanceof Error ? error.message : String(error) };
	}
	const storage = new Storage({ disks: { local: { driver: 'local', root: join(directory, 'storage', 'app') } }, environment: env });
	return {
		services: {
			name: options.name ?? basename(directory),
			environment: 'local',
			database,
			storage: new ConsoleStorage(storage),
			flows: fileFlows(join(directory, 'db3', 'flows')),
			agents: projectAgents(directory, logs),
		},
		close: async () => { await connection?.destroy(); },
	};
}

/** The app's `.env` values, or none when it has no file. */
async function readEnv(directory: string): Promise<Record<string, string>> {
	try {
		return parse(await readFile(join(directory, '.env'), 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw error;
	}
}

/** A small pool to the app's MariaDB or MySQL database, in UTC like the app's own connection. */
function connect(env: Record<string, string>): Knex {
	const dialect = resolveDatabaseDialect(env.DB_CONNECTION || 'mysql2');
	if (dialect.name === 'postgres') throw new Error('The console reads MariaDB and MySQL databases; this app uses Postgres.');
	if (!env.DATABASE_URL && !env.DB_DATABASE) throw new Error("This app's .env doesn't name a database (DB_DATABASE or DATABASE_URL).");
	const connection = env.DATABASE_URL
		? (() => { const url = new URL(env.DATABASE_URL); url.searchParams.set('timezone', 'Z'); return url.toString(); })()
		: { timezone: 'Z', host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || dialect.defaultPort), user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: env.DB_DATABASE };
	return knex({
		client: dialect.knexClient,
		connection,
		pool: {
			min: 0,
			max: 2,
			afterCreate(raw: { query: (sql: string, callback: (error: Error | null) => void) => void }, done: (error: Error | null, connection: unknown) => void) {
				raw.query("SET time_zone = '+00:00'", error => done(error, raw));
			},
		},
	});
}
