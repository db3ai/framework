import 'dotenv/config';
import knex, { type Knex } from 'knex';
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
	if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

	return {
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
