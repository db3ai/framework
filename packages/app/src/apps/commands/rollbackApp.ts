import { app } from '../../server';

/** Runs the latest app-owned down migration in a stopped process; disable the app first. */
export async function rollbackApp(id: string) {
	return app().apps.rollback(id);
}
