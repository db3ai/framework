import type { Knex } from 'knex';
import { mariaDbDialect } from './mariadb';
import { mysqlDialect } from './mysql';
import { postgresDialect } from './postgres';
import type {
	DatabaseConnectionName,
	DatabaseDialect,
} from './types';

const dialectByConnectionName: Record<DatabaseConnectionName, DatabaseDialect> = {
	mysql: mysqlDialect,
	mysql2: mysqlDialect,
	mariadb: mariaDbDialect,
	postgres: postgresDialect,
	pgsql: postgresDialect,
	pg: postgresDialect,
};

const dialectByConnection = new WeakMap<Knex, DatabaseDialect>();

/**
 * Resolves a configured database connection name to a framework dialect.
 */
export function resolveDatabaseDialect(
	connectionName = process.env.DB_CONNECTION || 'mysql2',
): DatabaseDialect {
	const normalized = connectionName.trim().toLowerCase() as DatabaseConnectionName;
	const dialect = dialectByConnectionName[normalized];

	if (!dialect) {
		throw new Error(
			`Unsupported DB_CONNECTION "${connectionName}". Use mysql, mysql2, mariadb, postgres, or pg.`,
		);
	}

	return dialect;
}

/**
 * Associates a Knex connection with the framework dialect that created it.
 */
export function rememberDatabaseDialect(
	connection: Knex,
	dialect: DatabaseDialect,
): void {
	dialectByConnection.set(connection, dialect);
}

/**
 * Resolves the best-known dialect for an existing Knex connection.
 */
export function databaseDialectForConnection(connection: Knex): DatabaseDialect {
	const remembered = dialectByConnection.get(connection);

	if (remembered) return remembered;

	const configured = resolveDatabaseDialect();
	const clientName = databaseClientName(connection);

	if (clientName === configured.knexClient) {
		return configured;
	}

	if (clientName === 'mysql' || clientName === 'mysql2') {
		return mysqlDialect;
	}

	if (clientName === 'pg' || clientName === 'postgres') {
		return postgresDialect;
	}

	return configured;
}

/**
 * Extracts Knex's low-level client name from a connection.
 */
function databaseClientName(connection: Knex): string {
	const client = connection.client as {
		config?: {
			client?: unknown;
		};
		dialect?: unknown;
	};
	const name = client.config?.client ?? client.dialect ?? '';

	return String(name).toLowerCase();
}
