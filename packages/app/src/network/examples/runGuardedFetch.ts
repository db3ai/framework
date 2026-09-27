import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { BlockedUrlError, guardedFetch } from '@db3.ai/app/network';

/**
 * Requests a local receiver with and without private-network access.
 *
 * A user-supplied URL pointing at the machine itself is refused by default,
 * and reachable only when the caller explicitly allows private destinations,
 * as a local development workflow would.
 *
 * @returns Whether the default policy blocked the request and the opted-in request succeeded.
 */
export async function runGuardedFetch() {
	const server = createServer((_request, response) => response.end('local receiver'));

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));

	const address = server.address();
	const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/`;

	try {
		const blocked = await guardedFetch(url).then(() => false, error => error instanceof BlockedUrlError);
		const { response } = await guardedFetch(url, { allowPrivate: true });

		return {
			privateBlockedByDefault: blocked,
			privateAllowedWhenRequested: await response.text() === 'local receiver',
		};
	} finally {
		await new Promise<void>(resolve => server.close(() => resolve()));
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runGuardedFetch(), null, 2));
