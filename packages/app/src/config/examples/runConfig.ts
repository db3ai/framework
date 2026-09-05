import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { EnvSource } from '@db3.ai/app/config';
import { App } from '@db3.ai/app/server';
import { loadNotesConfig } from './loadNotesConfig';

/**
 * Boots configuration and URL generation without opening HTTP or SQL connections.
 *
 * @param source - App settings; no process-global environment changes are needed.
 * @returns A deliberately selected public summary, never the complete config.
 */
export async function runConfig(source: EnvSource = process.env) {
	const notes = loadNotesConfig(source);
	const application = new App({
		config: { notes },
		url: { baseUrl: `http://localhost:${notes.port}` },
		dbOptions: { syncColumns: false },
	});
	try {
		return {
			name: application.config.get<string>('notes.name'),
			port: notes.port,
			notesUrl: application.url.to('/notes'),
			pageSize: notes.pageSize,
			debug: notes.debug,
			allowedOrigins: notes.allowedOrigins,
			missingValue: application.config.get('notes.missing', 'fallback'),
			hasWebhook: application.config.has('notes.webhook'),
			webhookEnabled: notes.webhook.enabled,
			configReused: application.config === application.config,
		};
	} finally {
		await application.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runConfig(), null, 2));
}
