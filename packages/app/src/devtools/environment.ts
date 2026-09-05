import { isDevelopmentEnvironment } from '@db3.ai/pure';

/**
 * Returns whether instrumentation should automatically stream to local
 * development tooling.
 *
 * Tests are excluded because they should opt into transports explicitly.
 *
 * @param environment - Current runtime environment name.
 * @returns True for interactive local development environments.
 */
export function isInteractiveDevelopmentEnvironment(
	environment: string | undefined,
): boolean {
	const normalized = (environment || '').toLowerCase().trim();

	return normalized !== 'test' && isDevelopmentEnvironment(normalized);
}
