import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Apps } from './Apps';
import { AppRouteError } from './AppRouteError';

/** Mounts dynamic app routes behind mandatory host authorization; newly installed apps become reachable immediately. */
export function registerAppRoutes(server: FastifyInstance, apps: Apps<any>, authorize: (request: FastifyRequest, appId: string) => Promise<{ id: string }>): void {
	for (const url of ['/api/apps/:appId', '/api/apps/:appId/*']) {
		server.route({
			method: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], url,
			/** Drains in-flight requests before lifecycle changes and passes only a verified actor to app code. */
			handler: async (request, reply) => {
				try {
					return await apps.run(async () => {
						const { appId, '*': suffix = '' } = request.params as Record<string, string>;
						const service = apps.get(appId);
						if (service === undefined) return reply.code(404).send({ message: 'App is unavailable.' });
						const candidates = apps.routes().filter(item => item.appId === appId && item.route.method === request.method).sort((a, b) => (a.route.path.match(/:/g)?.length ?? 0) - (b.route.path.match(/:/g)?.length ?? 0));
						for (const { route } of candidates) {
							const params = matchPath(route.path, `/${suffix}`);
							if (!params) continue;
							const actor = await authorize(request, appId);
							if (!actor?.id) throw new AppRouteError(401, 'Please sign in.');
							const result = await route.handle({ service, actor, body: request.body, params, query: request.query as Record<string, unknown> });
							return reply.code(route.status ?? 200).send(result);
						}
						return reply.code(404).send({ message: 'App route not found.' });
					});
				} catch (error) {
					if (error instanceof AppRouteError) return reply.code(error.statusCode).send({ message: error.message });
					throw error;
				}
			},
		});
	}
}

/** Matches validated route segments and captures named parameters without evaluating arbitrary regular expressions. */
function matchPath(pattern: string, path: string): Record<string, string> | undefined {
	const expected = pattern.split('/');
	const actual = path.split('/');
	if (expected.length !== actual.length) return;
	const params: Record<string, string> = Object.create(null);
	for (let index = 0; index < expected.length; index++) {
		if (expected[index].startsWith(':') && actual[index]) params[expected[index].slice(1)] = actual[index];
		else if (expected[index] !== actual[index]) return;
	}
	return params;
}
