import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createDocsServer } from './server/createDocsServer.js';

export { createDocsServer, type DocsServerOptions } from './server/createDocsServer.js';

const port = positiveInteger(process.env.DOCS_PORT, process.env.NODE_ENV === 'production' ? 8791 : 8300);
const host = process.env.DOCS_HOST || '127.0.0.1';

/**
 * Parses a positive integer environment setting.
 *
 * @param value - Raw environment value.
 * @param fallback - Value returned when parsing fails.
 * @returns Positive integer runtime setting.
 */
function positiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
	const server = await createDocsServer();
	let closing = false;

	/**
	 * Stops accepting documentation requests and closes active resources.
	 */
	const shutdown = async (): Promise<void> => {
		if (closing) return;

		closing = true;
		await server.close();
	};

	process.once('SIGINT', () => void shutdown());
	process.once('SIGTERM', () => void shutdown());

	await server.listen({ port, host });
}
