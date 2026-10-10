import type { ProxyRoute } from '../../shared/contracts.js';

/**
 * Reads local domain → port mappings from Caddy's admin API.
 *
 * Uses the live JSON config (`GET /config/`), so it works whichever Caddyfile
 * or JSON file Caddy was started with.
 *
 * @param adminUrl - Caddy admin endpoint, `http://localhost:2019` by default.
 * @returns Routes, or an empty list when Caddy is not running or not reachable.
 */
export async function readCaddyRoutes(adminUrl = 'http://localhost:2019'): Promise<ProxyRoute[]> {
	try {
		const base = new URL(adminUrl);
		// Node's fetch sends browser-style Sec-Fetch headers, so Caddy's admin API
		// enforces its origin check; name the admin endpoint itself as the origin.
		const response = await fetch(new URL('/config/', base), {
			headers: { origin: base.origin },
			signal: AbortSignal.timeout(1500),
		});
		if (!response.ok) return [];
		return caddyRoutes(await response.json());
	} catch {
		return [];
	}
}

interface CaddyRoute {
	match?: Array<{ host?: string[]; path?: string[] }>;
	handle?: CaddyHandler[];
}

interface CaddyHandler {
	handler?: string;
	routes?: CaddyRoute[];
	upstreams?: Array<{ dial?: string }>;
	transport?: { protocol?: string };
}

/**
 * Extracts reverse-proxy routes to local ports from a Caddy JSON config.
 *
 * Follows nested subroutes, carrying host and path matchers down. FastCGI
 * (PHP) upstreams, wildcard hosts and non-local upstreams are skipped.
 *
 * @param config - Caddy's JSON config.
 * @returns One route per host, path and upstream port.
 */
export function caddyRoutes(config: unknown): ProxyRoute[] {
	const servers = (config as { apps?: { http?: { servers?: Record<string, { listen?: string[]; routes?: CaddyRoute[] }> } } })?.apps?.http?.servers ?? {};
	const routes: ProxyRoute[] = [];
	const seen = new Set<string>();
	for (const server of Object.values(servers)) {
		const listenPort = Number(/:(\d+)$/.exec(server.listen?.[0] ?? '')?.[1] ?? 0);
		const https = listenPort === 443 || (server.listen ?? []).some(address => address.endsWith(':443'));
		const scheme = https ? 'https' : 'http';
		const portSuffix = !listenPort || listenPort === 443 || listenPort === 80 ? '' : `:${listenPort}`;
		const walk = (route: CaddyRoute, hosts: string[], path: string): void => {
			const matchHosts = (route.match ?? []).flatMap(match => match.host ?? []);
			const matchPath = (route.match ?? []).flatMap(match => match.path ?? [])[0];
			const scopeHosts = matchHosts.length ? matchHosts : hosts;
			const scopePath = matchPath ? matchPath.replace(/\/\*$/, '') : path;
			for (const handler of route.handle ?? []) {
				if (handler.handler === 'reverse_proxy' && handler.transport?.protocol !== 'fastcgi') {
					for (const upstream of handler.upstreams ?? []) {
						const port = localPort(upstream.dial);
						if (!port) continue;
						for (const host of scopeHosts) {
							if (host.includes('*')) continue;
							const url = `${scheme}://${host}${portSuffix}${scopePath.includes('*') ? '' : scopePath}`;
							const key = `${url}|${port}`;
							if (seen.has(key)) continue;
							seen.add(key);
							routes.push({ url, port });
						}
					}
				}
				for (const child of handler.routes ?? []) walk(child, scopeHosts, scopePath);
			}
		};
		for (const route of server.routes ?? []) walk(route, [], '');
	}
	return routes;
}

function localPort(dial: string | undefined): number | null {
	const match = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1|0\.0\.0\.0)?:(\d+)$/.exec(dial ?? '');
	return match ? Number(match[1]) : null;
}
