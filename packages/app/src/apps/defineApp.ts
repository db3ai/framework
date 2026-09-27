import type { AppDefinition } from './contracts';

/**
 * Defines an app without installing, connecting or registering it globally.
 * @param definition - Public service, metadata and app-owned contributions.
 * @returns Definition preserving the inferred public service type.
 */
export function defineApp<TService>(definition: AppDefinition<TService>): AppDefinition<TService> {
	return definition;
}
