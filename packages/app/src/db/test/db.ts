import 'dotenv/config';
import crypto from 'node:crypto';
import knex, { type Knex } from 'knex';
import {
	rememberDatabaseDialect,
	resolveDatabaseDialect,
	type DatabaseDialect,
} from '../dialects';

type ConnectionInput = Knex.StaticConnectionConfig & {
	database?: string;
};

export interface GeneratedTestDatabase {
	readonly db: Knex;
	readonly databaseName: string;
	destroy(): Promise<void>;
}

const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Creates an isolated test database for the configured SQL dialect.
 */
export async function createGeneratedTestDatabase(
	label = 'suite',
): Promise<GeneratedTestDatabase> {
	const databaseName = createDatabaseName(label);
	const dialect = resolveDatabaseDialect();
	const admin = createKnex(undefined, dialect);

	try {
		await dialect.createDatabase(admin, databaseName);

		const db = createKnex(databaseName, dialect);

		return {
			db,
			databaseName,
			async destroy(): Promise<void> {
				await db.destroy();
				await dialect.dropDatabase(admin, databaseName);
				await admin.destroy();
			},
		};
	} catch (error) {
		await admin.destroy();
		throw error;
	}
}

/**
 * Creates a Knex connection bound to the configured test dialect.
 */
function createKnex(
	databaseName?: string,
	dialect = resolveDatabaseDialect(),
): Knex {
	const connection = knex({
		client: dialect.knexClient,
		connection: createConnection(databaseName, dialect),
		pool: {
			min: 0,
			max: 2,
		},
	});

	rememberDatabaseDialect(connection, dialect);

	return connection;
}

/**
 * Builds the test database connection object from environment variables.
 */
function createConnection(
	databaseName?: string,
	dialect = resolveDatabaseDialect(),
): ConnectionInput {
	if (process.env.DATABASE_URL) {
		return connectionFromUrl(process.env.DATABASE_URL, databaseName, dialect);
	}

	return {
		host: process.env.DB_HOST || '127.0.0.1',
		port: Number(process.env.DB_PORT || dialect.defaultPort),
		user: process.env.DB_USER || 'root',
		password: process.env.DB_PASSWORD || '',
		database: databaseName,
	};
}

/**
 * Parses a database URL while allowing the generated database name to override it.
 */
function connectionFromUrl(
	databaseUrl: string,
	databaseName?: string,
	dialect = resolveDatabaseDialect(),
): ConnectionInput {
	const url = new URL(databaseUrl);

	return {
		host: url.hostname,
		port: Number(url.port || dialect.defaultPort),
		user: decodeURIComponent(url.username),
		password: decodeURIComponent(url.password),
		database: databaseName,
	};
}

/**
 * Creates a safe generated database name for an integration test suite.
 */
function createDatabaseName(label: string): string {
	const prefix = process.env.DB_TEST_DATABASE_PREFIX || 'db3_app_test';
	const suffix = label.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
	const random = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
	const databaseName = `${prefix}_${process.pid}_${suffix || 'suite'}_${random}`;

	assertSafeGeneratedDatabaseName(databaseName);

	return databaseName.slice(0, 64);
}

/**
 * Guards generated database names before create/drop SQL is executed.
 */
function assertSafeGeneratedDatabaseName(databaseName: string): void {
	const appDatabaseName = getAppDatabaseName();

	if (!SAFE_DATABASE_NAME.test(databaseName)) {
		throw new Error(`Unsafe test database name "${databaseName}".`);
	}

	if (!databaseName.toLowerCase().includes('test')) {
		throw new Error(
			`Refusing to manage database "${databaseName}" because it does not contain "test".`,
		);
	}

	if (appDatabaseName && databaseName === appDatabaseName) {
		throw new Error(
			`Refusing to manage test database "${databaseName}" because it matches DB_DATABASE.`,
		);
	}
}

/**
 * Resolves the configured application database name for destructive safety checks.
 */
function getAppDatabaseName(): string | null {
	if (process.env.DATABASE_URL) {
		const url = new URL(process.env.DATABASE_URL);
		return url.pathname.replace(/^\//, '') || null;
	}

	return process.env.DB_DATABASE || null;
}
