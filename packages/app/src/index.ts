export {
	App,
	type AppOptions,
} from './server';
export {
	RequestContext,
	type RequestContextValues,
} from './server';
export * from './cache';
export * from './config';
export * from './events';
export * from './logging';
export * from './media';
export * from './security';
export * from './serialization';
export * from './url';
export * from './validation';

export interface AppManifest {
	id: string;
	name: string;
	version: string;
	description?: string;
	icon?: string;
	entry?: string;
	adminPath?: string;
	capabilities?: string[];
}

export interface AppDefinition<TManifest extends AppManifest = AppManifest> {
	manifest: TManifest;
}

export function defineApp<TManifest extends AppManifest>(
	manifest: TManifest,
): AppDefinition<TManifest> {
	return {
		manifest,
	};
}
