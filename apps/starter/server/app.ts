import { App, type AppOptions } from '@db3.ai/app';
import type { StarterConfig } from './config';
import { models } from './database/models';

/** Creates the framework root. Test database injection belongs only at this bootstrap boundary. */
export function createApplication(config: StarterConfig, options: Pick<AppOptions, 'db' | 'ai'> = {}) {
	return new App({
		directory: new URL('../', import.meta.url),
		ai: config.ai,
		health: { service: config.name },
		dbOptions: { migrations: { models } },
		...options,
		config: { auth: { providers: {
			password: true,
			...(config.auth.googleClientId ? { google: { clientIds: [config.auth.googleClientId] } } : {}),
		} } },
	});
}
