import 'dotenv/config';
import knex, { type Knex } from 'knex';
import { utcDate } from '@db3.ai/pure/dates';
import {
	rememberDatabaseDialect,
	resolveDatabaseDialect,
	type DatabaseDialect,
} from './dialects';

let database: Knex | null = null;

/**
 * Reads a required environment variable for database connection setup.
 */
function requiredEnv(name: string): string {
	const value = process.env[name];

	if (!value) {
		throw new Error(`Missing required database environment variable ${name}.`);
	}

	return value;
}

/**
 * Builds a Knex connection value from the current process environment.
 */
function databaseConnection(dialect: DatabaseDialect): Knex.Config['connection'] {
	if (process.env.DATABASE_URL) {
		const url = new URL(process.env.DATABASE_URL);
		if (dialect.name !== 'postgres') url.searchParams.set('timezone', 'Z');
		return url.toString();
	}

	return {
		...(dialect.name !== 'postgres' ? { timezone: 'Z' } : {}),
		host: process.env.DB_HOST || '127.0.0.1',
		port: Number(process.env.DB_PORT || dialect.defaultPort),
		user: process.env.DB_USER || 'root',
		password: process.env.DB_PASSWORD || '',
		database: requiredEnv('DB_DATABASE'),
	};
}

/**
 * Returns the shared application database connection.
 */
export function db(): Knex {
	if (!database) {
		const dialect = resolveDatabaseDialect();

		database = knex({
			client: dialect.knexClient,
			connection: databaseConnection(dialect),
			pool: {
				/** Initializes SQL functions and TIMESTAMP conversion in UTC on every pooled connection. */
				afterCreate(connection: { setTypeParser?: (oid: number, parser: (value: string) => Date | null) => void; query: (sql: string, callback: (error: Error | null) => void) => void }, done: (error: Error | null, connection: unknown) => void) {
					if (dialect.name === 'postgres') connection.setTypeParser?.(1114, utcDate);
					connection.query(dialect.name === 'postgres' ? "SET TIME ZONE 'UTC'" : "SET time_zone = '+00:00'", error => done(error, connection));
				},
				min: Number(process.env.DB_POOL_MIN || 0),
				max: Number(process.env.DB_POOL_MAX || 10),
			},
		});
		rememberDatabaseDialect(database, dialect);
	}

	return database;
}

/**
 * Closes and clears the shared application database connection.
 */
export async function destroyDatabase(): Promise<void> {
	if (!database) return;

	await database.destroy();
	database = null;
}
