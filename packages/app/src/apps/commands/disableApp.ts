import { app } from '../../server';

/** Disables an app without deleting its data. */
export async function disableApp(id: string) {
	return app().apps.disable(id);
}
