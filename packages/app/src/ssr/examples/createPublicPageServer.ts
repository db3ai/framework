import Fastify, { type FastifyInstance } from 'fastify';
import { SSR_APP_MARKER, SSR_HEAD_MARKER, SSR_STATE_MARKER } from '@db3.ai/app/ssr';
import { fastifySsr } from '@db3.ai/app/ssr/fastify';

/**
 * Creates a public HTML route with isolated metadata and escaped JSON state.
 *
 * The literal body is trusted application markup. Request input goes only into
 * the escaped head/state serializers, never raw HTML. This non-hydrating lab
 * has no Vue dependency; an application may hydrate the same state separately.
 * @returns Server owned and closed by the caller, without a listening socket.
 */
export async function createPublicPageServer(): Promise<FastifyInstance> {
	const server = Fastify({ logger: false });
	const template = `<!doctype html><html lang="en"><head><meta charset="utf-8">${SSR_HEAD_MARKER}</head><body>${SSR_APP_MARKER}<script id="page-state" type="application/json">${SSR_STATE_MARKER}</script></body></html>`;
	server.get('/api/health', async () => ({ ok: true }));
	await server.register(fastifySsr({
		template,
		routes: ['/hello', '/broken'],
		/** Collects state on the request-owned context and returns trusted markup. */
		async render(context) {
			const url = new URL(context.request.url, 'https://notes.example.test');
			if (url.pathname === '/broken') throw new Error('Controlled private render failure');
			const name = (url.searchParams.get('name') || 'Developer').slice(0, 200);
			context.state.name = name;
			context.head.title = `Hello ${name}`;
			await Promise.resolve();
			return { appHtml: '<main><h1>Your app is running</h1><p>Literal $& stays literal.</p></main>', headers: { 'Cache-Control': 'private, no-store' } };
		},
	}));
	return server;
}
