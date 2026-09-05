import { createEnv, defineConfig, type EnvSource } from '@db3.ai/app/config';

/**
 * Reads application settings once at boot, before constructing services.
 *
 * Parsing a number does not establish its business range. Optional integration
 * credentials are required only when that integration is explicitly enabled.
 *
 * @param source - Environment values; inject a plain object in application tests.
 * @returns Validated, typed settings owned by this notes application.
 */
export function loadNotesConfig(source: EnvSource = process.env) {
	const env = createEnv(source);
	const port = env.integer('APP_PORT', 3000);
	const pageSize = env.integer('NOTES_PAGE_SIZE', 20);
	if (port < 1 || port > 65_535) throw new Error('APP_PORT must be between 1 and 65535.');
	if (pageSize < 1 || pageSize > 100) throw new Error('NOTES_PAGE_SIZE must be between 1 and 100.');
	const webhookEnabled = env.boolean('WEBHOOK_ENABLED', false);
	const webhookKey = webhookEnabled ? env.required('WEBHOOK_KEY') : undefined;
	if (webhookEnabled && !webhookKey?.trim()) throw new Error('WEBHOOK_KEY cannot contain only whitespace.');
	return defineConfig({
		name: env('APP_NAME', 'My notes'),
		port,
		pageSize,
		debug: env.boolean('APP_DEBUG', false),
		allowedOrigins: env.array('ALLOWED_ORIGINS', []),
		webhook: { enabled: webhookEnabled, key: webhookKey },
	});
}
