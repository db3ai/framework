import type { FastifyInstance, FastifyReply } from 'fastify';
import type * as health from './contracts';

/**
 * Registers the canonical application health endpoint on a Fastify server.
 *
 * Healthy and degraded reports return HTTP 200 so optional degradation does not
 * remove the process from service. An unhealthy component returns HTTP 503.
 * Compatibility aliases are useful while external monitors migrate to `/health`.
 *
 * @param server - Fastify server that owns the HTTP lifecycle.
 * @param options - Application health service and route paths.
 */
export function registerHealthRoute(server: FastifyInstance, options: health.HealthRouteOptions): void {
	const paths = uniquePaths(options.path ?? '/health', options.aliases ?? []);

	for (const path of paths) {
		server.get(path, async (_request, reply) => healthResponse(options.app.health, reply));
	}
}

/**
 * Builds one safe response from the shared health service.
 *
 * @param service - Application health registry.
 * @param reply - Fastify response used to set status and cache policy.
 * @returns Aggregate health report.
 */
async function healthResponse(service: health.HealthApplication['health'], reply: FastifyReply): Promise<health.HealthReport> {
	const report = await service.report();
	reply.header('cache-control', 'no-store');
	reply.code(report.status === 'unhealthy' ? 503 : 200);
	return report;
}

/**
 * Validates and deduplicates canonical and compatibility route paths.
 *
 * @param canonical - Canonical health endpoint path.
 * @param aliases - Optional compatibility paths.
 * @returns Unique validated route paths in registration order.
 */
function uniquePaths(canonical: string, aliases: string[]): string[] {
	return [...new Set([canonical, ...aliases].map(path => {
		const normalized = path.trim();
		if (!normalized.startsWith('/')) throw new TypeError(`Health route "${path}" must start with "/".`);
		return normalized;
	}))];
}
