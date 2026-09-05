import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { createSsrRenderContext, renderSsrDocument } from '..';
import type { SsrRequest, SsrResponseHeaderValue, SsrState } from '../contracts';
import type { FastifySsrOptions } from './contracts';

/**
 * Creates an encapsulated Fastify plugin that renders unmatched page requests.
 *
 * Concrete API routes registered on the same Fastify instance remain more
 * specific than the wildcard page route. `shouldRender` can preserve a JSON
 * not-found boundary for reserved prefixes such as `/api`.
 *
 * @param options - Application renderer, document template and route ownership.
 * @returns Fastify plugin ready to register on an application server.
 *
 * @example
 * await server.register(fastifySsr({
 * 	template,
 * 	render: renderPage,
 * 	routes: ['/blog', '/blog/*'],
 * 	shouldRender: (request) => {
 * 		const path = request.url.split('?')[0];
 * 		return path !== '/api' && !path.startsWith('/api/');
 * 	},
 * });
 */
export function fastifySsr<TState extends object = SsrState>(
	options: FastifySsrOptions<TState>,
): FastifyPluginAsync {
	return async function platformFastifySsr(server): Promise<void> {
		const routes = options.routes?.length ? options.routes : ['/*'];

		for (const route of routes) {
			server.get(route, async (request, reply) => {
				const ssrRequest = toSsrRequest(request);

				try {
					if (options.shouldRender && !await options.shouldRender(ssrRequest)) {
						return reply.callNotFound();
					}

					const context = createSsrRenderContext<TState>(ssrRequest);
					const [template, result] = await Promise.all([
						loadTemplate(options.template, ssrRequest),
						options.render(context),
					]);
					const document = renderSsrDocument(template, context, result);

					applyHeaders(reply, result.headers);

					return reply
						.status(result.status ?? context.status)
						.type('text/html; charset=utf-8')
						.send(document);
				} catch (error) {
					request.log.error({ err: error }, 'Server-side render failed.');

					return reply
						.status(500)
						.type('text/plain; charset=utf-8')
						.send('Internal Server Error');
				}
			});
		}
	};
}

/**
 * Converts Fastify request state into the transport-neutral renderer contract.
 *
 * @param request - Matched Fastify request.
 * @returns Request data safe to pass into an application server entry.
 */
function toSsrRequest(request: FastifyRequest): SsrRequest {
	return {
		method: request.method,
		url: request.url,
		headers: { ...request.headers },
	};
}

/**
 * Resolves a static or request-loaded document template.
 *
 * @param template - Static template or development-aware loader.
 * @param request - Current transport-neutral render request.
 * @returns HTML document template for the request.
 */
function loadTemplate(
	template: FastifySsrOptions['template'],
	request: SsrRequest,
): string | Promise<string> {
	return typeof template === 'function' ? template(request) : template;
}

/**
 * Applies application-owned response headers to a Fastify reply.
 *
 * @param reply - Active Fastify reply.
 * @param headers - Optional headers returned by the renderer.
 */
function applyHeaders(
	reply: FastifyReply,
	headers: Record<string, SsrResponseHeaderValue> | undefined,
): void {
	for (const [name, value] of Object.entries(headers ?? {})) {
		reply.header(name, value);
	}
}
