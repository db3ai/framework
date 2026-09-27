import { isDevelopmentEnvironment, unknownErrorMessage } from '@db3.ai/pure';

/**
 * Returns internal diagnostics only for explicitly named development environments.
 *
 * Production, staging, unknown and unset environments fail closed. This policy
 * applies to every exception, without relying on database-specific signatures.
 *
 * @param error - Original server-side failure; never modified by this function.
 * @param environment - Runtime environment, defaulting to NODE_ENV.
 * @returns Detailed development message or the generic public failure message.
 */
export function publicServerErrorMessage(error: unknown, environment = process.env.NODE_ENV): string {
	return isDevelopmentEnvironment(environment)
		? unknownErrorMessage(error) || 'Unexpected server error'
		: 'Unexpected server error';
}
