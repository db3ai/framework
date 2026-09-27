import { app } from '../../server';

/** Deregisters an app installation while preserving its tables and history. */
export async function uninstallApp(id: string) {
	return app().apps.uninstall(id);
}
