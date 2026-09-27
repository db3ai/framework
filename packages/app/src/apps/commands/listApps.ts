import { app } from '../../server';

/** Lists source definitions and retained installations for CLI or visual clients. */
export async function listApps() {
	return app().apps.describe();
}
