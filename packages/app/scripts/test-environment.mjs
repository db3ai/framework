import { config as loadEnvironmentFile } from 'dotenv';
import { fileURLToPath } from 'node:url';

const TEST_DATABASE_NAME = 'db3_app_test';
const testEnvironmentPath = fileURLToPath(new URL('../.env.test', import.meta.url));

configureFrameworkTestEnvironment();

/**
 * Loads optional package-owned test settings and enforces a test-only database.
 *
 * Connection credentials may come from `packages/app/.env.test` or the process
 * environment. The database name and namespace are always forced so a developer
 * shell or CI secret cannot redirect framework tests to an application database.
 *
 * @returns {void}
 */
function configureFrameworkTestEnvironment() {
	loadEnvironmentFile({
		path: testEnvironmentPath,
		override: false,
		quiet: true,
	});

	process.env.NODE_ENV = 'test';
	process.env.DB_DATABASE = TEST_DATABASE_NAME;
	process.env.DB_TEST_DATABASE_PREFIX = TEST_DATABASE_NAME;

	assertSafeDatabaseUrl(process.env.DATABASE_URL);
}

/**
 * Rejects a direct database URL that does not target the test namespace.
 *
 * @param {string | undefined} databaseUrl - Optional CI or local connection URL.
 * @returns {void}
 */
function assertSafeDatabaseUrl(databaseUrl) {
	if (!databaseUrl) return;

	const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));

	if (databaseName !== TEST_DATABASE_NAME && !databaseName.startsWith(`${TEST_DATABASE_NAME}_`)) {
		throw new Error(
			`DATABASE_URL must target ${TEST_DATABASE_NAME} or its disposable test namespace, received "${databaseName}".`,
		);
	}
}
