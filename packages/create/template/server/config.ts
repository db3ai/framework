import 'dotenv/config';

/** Builds server-only configuration. Only explicitly selected public values reach the UI. */
export function readConfig() {
	const production = process.env.NODE_ENV === 'production';
	const origin = process.env.APP_ORIGIN || 'http://localhost:5173';
	if (new URL(origin).origin !== origin || (production && !origin.startsWith('https://'))) throw new Error('APP_ORIGIN must be an exact origin; production requires HTTPS.');
	return {
		name: process.env.APP_NAME || 'My DB3 app',
		origin,
		production,
		port: Number(process.env.PORT || 3001),
		host: process.env.HOST || '127.0.0.1',
		auth: { googleClientId: process.env.GOOGLE_AUTH_CLIENT_ID || '' },
		ai: { apiKey: process.env.OPENAI_API_KEY?.trim() || '', model: process.env.OPENAI_MODEL || 'gpt-4.1-mini' },
	};
}

/** Complete server configuration, injectable in tests without reading a real AI key. */
export type StarterConfig = ReturnType<typeof readConfig>;
