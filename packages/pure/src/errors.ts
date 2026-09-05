import { isRecord } from '@db3.ai/pure/records';

const defaultProductionSqlErrorMessage = 'A database error occurred.';
const developmentEnvironmentNames = new Set([
	'dev',
	'develop',
	'development',
	'local',
	'test',
]);

/**
 * Reads a public API error message from an unknown response body.
 *
 * @example
 * ```ts
 * apiErrorMessage({ message: 'Try again' }, 'Request failed');
 * // 'Try again'
 * ```
 */
export function apiErrorMessage(result: unknown, fallback: string): string {
	const message = isRecord(result) ? result.message : null;

	return typeof message === 'string' ? message : fallback;
}

/**
 * Converts an unknown thrown value into a displayable message.
 *
 * @example
 * ```ts
 * unknownErrorMessage(new Error('Nope'));
 * // 'Nope'
 * ```
 */
export function unknownErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error === undefined || error === null) return '';
	return String(error);
}

/**
 * Returns true for database-driver errors that may expose SQL internals.
 *
 * @example
 * ```ts
 * isSqlError({ code: 'ER_DUP_ENTRY' });
 * // true
 * ```
 */
export function isSqlError(error: unknown): boolean {
	if (!isRecord(error)) return false;

	if (typeof error.sql === 'string') return true;
	if (typeof error.sqlMessage === 'string') return true;
	if (typeof error.sqlState === 'string') return true;

	const code = typeof error.code === 'string' ? error.code : '';

	return code.startsWith('ER_')
		|| code.startsWith('SQLITE_')
		|| /^[0-9]{2}[0-9A-Z]{3}$/.test(code);
}

/**
 * Decides whether exact SQL error details can be shown for an environment name.
 *
 * @example
 * ```ts
 * shouldExposeSqlErrorDetails('production');
 * // false
 * ```
 */
export function shouldExposeSqlErrorDetails(environment?: string): boolean {
	return isDevelopmentEnvironment(environment);
}

/**
 * Returns true only when the runtime has explicitly opted into development behavior.
 *
 * @example
 * ```ts
 * isDevelopmentEnvironment(undefined);
 * // false
 * ```
 */
export function isDevelopmentEnvironment(environment?: string): boolean {
	return developmentEnvironmentNames.has((environment || '').toLowerCase().trim());
}

/**
 * Converts a SQL driver error into a public message, hiding details in production.
 *
 * @example
 * ```ts
 * publicSqlErrorMessage({ code: 'ER_DUP_ENTRY' }, { environment: 'production' });
 * // 'A database error occurred.'
 * ```
 */
export function publicSqlErrorMessage(
	error: unknown,
	options: {
		environment?: string;
		productionMessage?: string;
	} = {},
): string | null {
	if (!isSqlError(error)) return null;

	if (shouldExposeSqlErrorDetails(options.environment)) {
		return error instanceof Error ? error.message : String(error);
	}

	return options.productionMessage ?? defaultProductionSqlErrorMessage;
}
