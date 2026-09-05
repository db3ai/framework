import knex, { type Knex } from 'knex';

const [databaseName, migrationsDirectory, migrationTableName] = process.argv.slice(2);

if (!databaseName || !migrationsDirectory || !migrationTableName) {
	throw new Error('Database name, migrations directory, and migration table are required.');
}

const db = knex({
	client: 'mysql2',
	connection: migrationConnection(databaseName),
	pool: {
		min: 0,
		max: 2,
	},
});

try {
	await db.migrate.latest({
		directory: migrationsDirectory,
		tableName: migrationTableName,
		loadExtensions: ['.ts'],
		disableTransactions: true,
	});
} finally {
	await db.destroy();
}

/**
 * Builds the isolated MariaDB connection used by the generated migration
 * subprocess while preserving URL-based developer configurations.
 *
 * @param targetDatabase - Generated disposable database name.
 * @returns Knex-compatible connection settings.
 */
function migrationConnection(
	targetDatabase: string,
): Knex.StaticConnectionConfig {
	if (process.env.DATABASE_URL) {
		const url = new URL(process.env.DATABASE_URL);

		return {
			host: url.hostname,
			port: Number(url.port || 3306),
			user: decodeURIComponent(url.username),
			password: decodeURIComponent(url.password),
			database: targetDatabase,
		};
	}

	return {
		host: process.env.DB_HOST || '127.0.0.1',
		port: Number(process.env.DB_PORT || 3306),
		user: process.env.DB_USER || 'root',
		password: process.env.DB_PASSWORD || '',
		database: targetDatabase,
	};
}
