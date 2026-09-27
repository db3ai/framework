import { app } from '../../server';

/** Installs or upgrades one registered app in a stopped maintenance process. */
export async function installApp(id: string) {
	return app().apps.install(id);
}
