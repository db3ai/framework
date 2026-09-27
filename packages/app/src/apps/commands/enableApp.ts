import { app } from '../../server';

/** Enables an installed app for the next runtime boot. */
export async function enableApp(id: string) {
	return app().apps.enable(id);
}
