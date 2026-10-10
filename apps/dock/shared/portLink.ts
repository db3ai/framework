import type { ProxyRoute } from './contracts.js';

/** Where a process's port link goes and what it says. */
export interface PortLink {
	href: string;
	/** `local.growthscout.io`, `local.db3.ai/framework` or `:5173`. */
	label: string;
	/** Every address that reaches the port, for a tooltip. */
	title: string;
}

/**
 * Chooses the best link for a listening port: a proxied domain when one
 * forwards to it (preferring a whole host over a path prefix), else localhost.
 *
 * @param port - Listening port.
 * @param proxies - Known proxy routes.
 * @returns Link details.
 */
export function portLink(port: number, proxies: ProxyRoute[]): PortLink {
	const local = `http://localhost:${port}`;
	const matches = proxies.filter(route => route.port === port)
		.sort((a, b) => Number(hasPath(a.url)) - Number(hasPath(b.url)) || a.url.length - b.url.length);
	const best = matches[0];
	if (!best) return { href: `${local}/`, label: `:${port}`, title: local };
	return {
		href: hasPath(best.url) ? best.url : `${best.url}/`,
		label: best.url.replace(/^https?:\/\//, ''),
		title: [...matches.map(route => route.url), local].join('\n'),
	};
}

function hasPath(url: string): boolean {
	return /^https?:\/\/[^/]+\/./.test(url);
}
