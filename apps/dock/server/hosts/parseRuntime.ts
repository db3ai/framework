import type { DiskUsage, ListeningPort, ResponseClasses } from '../../shared/hostContracts.js';

/** Marker the sampling script prints when `/proc/net/tcp` could be read. */
export const LISTEN_OK = '#ok';

/**
 * Reads the TCP ports a container listens on, from the local addresses of
 * `LISTEN` (state `0A`) rows in `/proc/net/tcp` and `/proc/net/tcp6`.
 * Docker's embedded DNS resolver (127.0.0.11) is left out: it is in every
 * container and is not the app's.
 *
 * @param lines - Local addresses such as `0B00007F:9993`, then {@link LISTEN_OK}.
 * @returns Ports, or null when the container's sockets could not be read (no `cat`).
 */
export function parseListening(lines: string[]): ListeningPort[] | null {
	if (!lines.includes(LISTEN_OK)) return null;
	const ports = new Map<number, ListeningPort>();
	for (const line of lines) {
		const match = /^([0-9A-F]+):([0-9A-F]{4})$/i.exec(line.trim());
		if (!match) continue;
		const address = match[1]!.toUpperCase();
		const port = Number.parseInt(match[2]!, 16);
		if (address === '0B00007F') continue;
		const loopback = address === '0100007F' || address === '00000000000000000000000001000000' || /^[0-9A-F]{6}7F$/.test(address);
		const known = ports.get(port);
		// Listening anywhere wins over loopback-only for the same port.
		if (!known || (known.loopback && !loopback)) ports.set(port, { port, loopback });
	}
	return [...ports.values()].sort((a, b) => a.port - b.port);
}

/** What a cloudflared connector's log says about it. */
export interface TunnelLog {
	id: string | null;
	version: string | null;
	metricsPort: number | null;
	ingress: Array<{ hostname: string | null; service: string }> | null;
	configVersion: number | null;
	/** Epoch milliseconds of the latest configuration. */
	configAt: number | null;
	/** Edge connections registered (including reconnects) in the last 24 hours. */
	reconnects: number;
}

/**
 * Reads the last tunnel id, version, metrics address and ingress configuration
 * lines that the sampling script picked out of a cloudflared log.
 *
 * @param lines - Selected log lines and a `reconnects=<n>` line.
 * @returns Parsed facts; missing ones are null.
 */
export function parseTunnelLog(lines: string[]): TunnelLog {
	const result: TunnelLog = { id: null, version: null, metricsPort: null, ingress: null, configVersion: null, configAt: null, reconnects: 0 };
	for (const line of lines) {
		const id = /tunnelID=([0-9a-f-]{36})/.exec(line);
		if (id) result.id = id[1]!;
		const version = / INF Version (\S+)/.exec(line);
		if (version) result.version = version[1]!;
		const metrics = /Starting metrics server on .*:(\d+)\/metrics/.exec(line);
		if (metrics) result.metricsPort = Number(metrics[1]);
		const reconnects = /^reconnects=(\d+)$/.exec(line.trim());
		if (reconnects) result.reconnects = Number(reconnects[1]);
		const config = /Updated to new configuration config="(.*)" version=(\d+)/.exec(line);
		if (config) {
			try {
				const parsed = JSON.parse(config[1]!.replace(/\\"/g, '"')) as { ingress?: Array<{ hostname?: string; service?: string }> };
				result.ingress = (parsed.ingress ?? []).map(rule => ({ hostname: rule.hostname ?? null, service: String(rule.service ?? '') }));
				result.configVersion = Number(config[2]);
				const at = Date.parse(line.slice(0, 20));
				result.configAt = Number.isFinite(at) ? at : null;
			} catch {
				// A configuration line we cannot read leaves the previous one.
			}
		}
	}
	return result;
}

/** Counters from a cloudflared metrics endpoint. */
export interface TunnelMetrics {
	connections: number | null;
	requests: number | null;
	errors: number | null;
	concurrent: number | null;
	responses: ResponseClasses;
}

/**
 * @param lines - Prometheus text lines from cloudflared's `/metrics`.
 * @returns Counters; null when the endpoint gave nothing.
 */
export function parseTunnelMetrics(lines: string[]): TunnelMetrics | null {
	const values = new Map<string, number>();
	const responses: ResponseClasses = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
	for (const line of lines) {
		if (line.startsWith('#')) continue;
		const code = /^cloudflared_tunnel_response_by_code\{status_code="([1-5])\d\d"\}\s+([\d.e+]+)/.exec(line);
		if (code) {
			const key = `${code[1]}xx` as keyof ResponseClasses;
			if (key in responses) responses[key] += Number(code[2]);
			continue;
		}
		const metric = /^(cloudflared_tunnel_\w+)\s+([\d.e+]+)$/.exec(line.trim());
		if (metric) values.set(metric[1]!, Number(metric[2]));
	}
	if (!values.size) return null;
	return {
		connections: values.get('cloudflared_tunnel_ha_connections') ?? null,
		requests: values.get('cloudflared_tunnel_total_requests') ?? null,
		errors: values.get('cloudflared_tunnel_request_errors') ?? null,
		concurrent: values.get('cloudflared_tunnel_concurrent_requests_per_tunnel') ?? null,
		responses,
	};
}

/**
 * @param line - `<window seconds> <total> <2xx> <3xx> <4xx> <5xx>` counted from nginx access logs.
 * @returns Requests per second, overall and by status class; null when unreadable.
 */
export function parseAccessCounts(line: string | undefined): { perSecond: number; byClass: ResponseClasses } | null {
	const numbers = (line ?? '').trim().split(/\s+/).map(Number);
	if (numbers.length < 6 || numbers.some(number => !Number.isFinite(number)) || numbers[0]! <= 0) return null;
	const [window, total, ok, redirect, client, server] = numbers as [number, number, number, number, number, number];
	return {
		perSecond: total / window,
		byClass: { '2xx': ok / window, '3xx': redirect / window, '4xx': client / window, '5xx': server / window },
	};
}

/** Marker the sampling script prints for a container without mounts. */
export const NO_MOUNTS = '#none';

/** Mount points that hold configuration or sockets rather than data. */
const NOT_DATA = /^\/(etc|run|var\/run|proc|sys|dev)(\/|$)|\.(sock|conf|cnf|ini|json|ya?ml|pem|key|crt|sh|js|env|txt)$|\/localtime$/;

/**
 * Reads `df -P -k` rows into filesystems. Rows for the same filesystem are
 * merged, keeping each path. Bind-mounted files (configuration, sockets) are left
 * out unless `keepAll`, since they only repeat the host's disk.
 *
 * @param lines - `df -P -k` output; header lines are ignored.
 * @param keepAll - Keep every path, for the host's own disks.
 * @returns Filesystems in the order first seen.
 */
export function parseDisks(lines: string[], keepAll = false): DiskUsage[] {
	const disks = new Map<string, DiskUsage>();
	for (const line of lines) {
		const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\/.*)$/.exec(line.trim());
		if (!match) continue;
		const [, filesystem, size, used, free, path] = match as unknown as [string, string, string, string, string, string];
		if (!keepAll && NOT_DATA.test(path)) continue;
		const key = `${filesystem}|${size}`;
		const known = disks.get(key);
		if (known) {
			if (!known.paths.includes(path)) known.paths.push(path);
			continue;
		}
		disks.set(key, { filesystem, paths: [path], size: Number(size) * 1024, used: Number(used) * 1024, free: Number(free) * 1024 });
	}
	return [...disks.values()];
}
