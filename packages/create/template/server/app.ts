import { App, type AppOptions } from '@db3.ai/app';
import type { StarterConfig } from './config';

/** Creates the framework root. Test database injection belongs only at this bootstrap boundary. */
export function createApplication(config: StarterConfig, options: Pick<AppOptions, 'db'> = {}) {
	return new App({
		...options,
		config: { auth: { providers: {
			password: true,
			...(config.auth.googleClientId ? { google: { clientIds: [config.auth.googleClientId] } } : {}),
		} } },
	});
}
