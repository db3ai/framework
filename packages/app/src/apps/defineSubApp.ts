import type { SubAppDefinition } from './contracts';

/**
 * Defines an app without installing, connecting or registering it globally.
 * @param definition - Public service, metadata and app-owned contributions.
 * @returns Definition preserving the inferred public service type.
 */
export function defineSubApp<TService>(definition: SubAppDefinition<TService>): SubAppDefinition<TService> {
	return definition;
}
