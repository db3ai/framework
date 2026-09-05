import {
	isSqlError,
	isDevelopmentEnvironment as pureIsDevelopmentEnvironment,
	publicSqlErrorMessage as purePublicSqlErrorMessage,
	shouldExposeSqlErrorDetails as pureShouldExposeSqlErrorDetails,
} from '@db3.ai/pure';

export { isSqlError };

/**
 * Local dev and tests can show exact SQL errors. Explicit production cannot.
 */
export function shouldExposeSqlErrorDetails(
	environment = process.env.NODE_ENV,
): boolean {
	return pureShouldExposeSqlErrorDetails(environment);
}

export function isDevelopmentEnvironment(
	environment = process.env.NODE_ENV,
): boolean {
	return pureIsDevelopmentEnvironment(environment);
}

export function publicSqlErrorMessage(
	error: unknown,
	options: {
		environment?: string;
		productionMessage?: string;
	} = {},
): string | null {
	return purePublicSqlErrorMessage(error, {
		...options,
		environment: options.environment ?? process.env.NODE_ENV,
	});
}
