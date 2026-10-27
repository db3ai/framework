import type { AppGroup, ContainerRole, ContainerSnapshot, DiskUsage, HostDefinition, InboundRoute, ListeningPort, RequestStats, SlotGroup, TunnelInfo } from '../../shared/hostContracts.js';
import { emptyHistory, type UsageHistory } from '../../shared/usageHistory.js';
import type { InspectRow, PsRow, StatsRow } from './parseDocker.js';
import { upstreamRole, type NginxRoutes } from './parseNginxRoutes.js';
import type { TunnelLog, TunnelMetrics } from './parseRuntime.js';

/** Everything sampled from one host, ready to be turned into snapshots. */
export interface TopologyInput {
	ps: PsRow[];
	/** By container name; may lag behind `ps` by one slow sample. */
	inspect: Map<string, InspectRow>;
	stats: Map<string, StatsRow>;
	/** nginx routes by container name. */
	routes: Map<string, NginxRoutes>;
	/** Network throughput in bytes per second, by container name. */
	rates?: Map<string, { rx: number; tx: number }>;
	pending?: Map<string, ContainerSnapshot['pending']>;
	/** Listening ports by container name; null where they could not be read. */
	listening?: Map<string, ListeningPort[] | null>;
	/** Filesystems behind each container's mounts; null where `df` could not run. */
	disks?: Map<string, DiskUsage[] | null>;
	/** cloudflared log facts by container name. */
	tunnelLogs?: Map<string, TunnelLog>;
	/** cloudflared metrics with request rates derived from the previous sample. */
	tunnelMetrics?: Map<string, { metrics: TunnelMetrics; requestRate: number | null; errorRate: number | null }>;
	/** nginx access-log request rates by container name. */
	requests?: Map<string, RequestStats>;
	/** Recent CPU and memory samples by container name. */
	history?: Map<string, UsageHistory>;
	host: Pick<HostDefinition, 'publicNetworks' | 'apps'>;
}

/** Containers and the apps they make up. */
export interface Topology {
	containers: ContainerSnapshot[];
	apps: AppGroup[];
}

const ROLE_ORDER: ContainerRole[] = ['gateway', 'tunnel', 'web', 'api', 'app', 'scheduler', 'worker', 'database', 'backup'];

/**
 * Builds container snapshots and app groups from one host sample.
 *
 * - **Apps:** compose projects are grouped by name. Blue/green suffixes
 *   (`scout-blue`) and release-id suffixes (`db3-site-20261009124935-7faa46a66fa1`)
 *   mark slots of one app, and a project named `<app>-<anything>` (such as
 *   `scout-hosted-blog`) joins that app. A host's `apps` setting overrides this.
 * - **Roles** come from the command, image and service name.
 * - **Traffic** follows tunnel ingress rules, nginx upstreams and `proxy_pass`
 *   targets across Docker network aliases. It starts at the tunnels when their
 *   ingress is known (else at every container on a public network) and at
 *   ports published beyond loopback: what that reaches through `*_active` or
 *   direct routes is live, and what sits behind a `*_previous` upstream is standby.
 *
 * @param input - Parsed samples.
 * @returns Snapshots and groups.
 */
export function buildTopology(input: TopologyInput): Topology {
	const publicNetworks = new Set(input.host.publicNetworks?.length ? input.host.publicNetworks : ['edge']);
	const appOf = appResolver(input.ps.map(row => row.project).filter((project): project is string => !!project), input.host.apps ?? []);

	const containers: ContainerSnapshot[] = input.ps.map(row => {
		const inspect = input.inspect.get(row.name);
		const stats = row.state === 'running' ? input.stats.get(row.name) : undefined;
		const rate = row.state === 'running' ? input.rates?.get(row.name) : undefined;
		const networks = inspect?.networks ?? row.networks.map(name => ({ name, aliases: [] }));
		const argv = inspect ? [...inspect.entrypoint, ...inspect.cmd] : [];
		const command = argv.length ? argv.join(' ') : row.command;
		const routes = input.routes.get(row.name);
		const slot = row.project ? slotOf(row.project) : null;
		const image = inspect?.image && !inspect.image.startsWith('sha256:') ? inspect.image : row.image;
		const role = inferRole(row.service ?? '', image, command, routes);
		const publicOn = networks.filter(network => publicNetworks.has(network.name));
		const running = row.state === 'running';
		return {
			id: row.id,
			name: row.name,
			project: row.project,
			service: row.service,
			replica: row.replica,
			app: row.project ? appOf(row.project) : 'standalone',
			slot: slot ? row.project : null,
			role,
			detail: describe(role, image, command, routes),
			pool: role === 'worker' ? workerPool(command) : null,
			title: inspect?.labels['dock.title']?.trim() || null,
			description: inspect?.labels['dock.description']?.trim() || null,
			command,
			image,
			release: releaseOf(row.workingDir) ?? (slot && /^\d{14}-/.test(slot.label) ? slot.label : null),
			state: row.state,
			status: row.status,
			health: inspect?.health ?? healthFromStatus(row.status),
			healthOutput: inspect?.healthOutput ?? null,
			startedAt: inspect?.startedAt ?? null,
			finishedAt: inspect?.finishedAt ?? null,
			exitCode: inspect?.exitCode ?? null,
			restartCount: inspect?.restartCount ?? 0,
			restartPolicy: inspect?.restartPolicy ?? '',
			ports: row.ports,
			listening: running ? input.listening?.get(row.name) ?? null : null,
			networks,
			disks: running ? input.disks?.get(row.name) ?? null : null,
			proxy: null,
			tunnel: role === 'tunnel' && running ? tunnelInfo(input.tunnelLogs?.get(row.name), input.tunnelMetrics?.get(row.name)) : null,
			requests: running ? input.requests?.get(row.name) ?? null : null,
			public: publicOn.length > 0,
			publicAliases: [...new Set(publicOn.flatMap(network => network.aliases).filter(alias => alias !== row.name && alias !== row.service && !/^[0-9a-f]{12}$/.test(alias)))],
			traffic: 'internal',
			routesIn: [],
			cpu: stats?.cpu ?? null,
			memory: stats?.memory ?? null,
			pids: stats?.pids ?? null,
			history: running ? input.history?.get(row.name) ?? emptyHistory() : emptyHistory(),
			rxRate: rate?.rx ?? null,
			txRate: rate?.tx ?? null,
			pending: input.pending?.get(row.name) ?? null,
			runtime: row.runtime ?? 'docker',
		};
	});

	traceTraffic(containers, input.routes);
	return { containers, apps: groupApps(containers) };
}

function tunnelInfo(log: TunnelLog | undefined, sample: { metrics: TunnelMetrics; requestRate: number | null; errorRate: number | null } | undefined): TunnelInfo | null {
	if (!log && !sample) return null;
	return {
		id: log?.id ?? null,
		version: log?.version ?? null,
		connections: sample?.metrics.connections ?? null,
		requestRate: sample?.requestRate ?? null,
		errorRate: sample?.errorRate ?? null,
		concurrent: sample?.metrics.concurrent ?? null,
		totalRequests: sample?.metrics.requests ?? null,
		totalErrors: sample?.metrics.errors ?? null,
		responses: sample?.metrics.responses ?? null,
		ingress: log?.ingress?.map(rule => ({ ...rule, targets: [] })) ?? null,
		configVersion: log?.configVersion ?? null,
		configAt: log?.configAt ?? null,
		reconnects: log?.reconnects ?? 0,
	};
}

/**
 * @param project - Compose project name.
 * @returns Its app stem and slot label, when it is a blue/green or release slot.
 */
export function slotOf(project: string): { stem: string; label: string } | null {
	const colour = /^(.+)-(blue|green)$/.exec(project);
	if (colour) return { stem: colour[1]!, label: colour[2]! };
	const release = /^(.+)-(\d{14}-[0-9a-f]{6,})$/.exec(project);
	if (release) return { stem: release[1]!, label: release[2]! };
	return null;
}

/**
 * Builds a function mapping a compose project to its app id.
 *
 * @param projects - Every project on the host.
 * @param explicit - Configured groups, which win over name matching.
 * @returns Project → app id.
 */
export function appResolver(projects: string[], explicit: Array<{ name: string; match: string[] }>): (project: string) => string {
	const stems = [...new Set(projects.map(project => slotOf(project)?.stem ?? project))].sort((a, b) => a.length - b.length);
	const rootOf = new Map<string, string>();
	for (const stem of stems) {
		const parent = stems.find(other => other !== stem && stem.startsWith(`${other}-`));
		rootOf.set(stem, parent ? rootOf.get(parent) ?? parent : stem);
	}
	const patterns = explicit.map(group => ({ name: group.name, tests: group.match.map(wildcard) }));
	return project => {
		const configured = patterns.find(group => group.tests.some(test => test.test(project)));
		if (configured) return configured.name;
		const stem = slotOf(project)?.stem ?? project;
		return rootOf.get(stem) ?? stem;
	};
}

function wildcard(pattern: string): RegExp {
	return new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/**
 * Infers what a container does.
 *
 * @param service - Compose service name.
 * @param image - Image reference.
 * @param command - Entrypoint and command.
 * @param routes - nginx routes when the container runs nginx.
 * @returns Role.
 */
export function inferRole(service: string, image: string, command: string, routes?: NginxRoutes): ContainerRole {
	const text = `${service} ${image} ${command}`.toLowerCase();
	const blueGreen = routes && [...routes.upstreams.keys()].some(name => upstreamRole(name) !== 'direct');
	if (blueGreen || /^(gateway|router|proxy|edge-proxy)$/.test(service)) return 'gateway';
	if (/cloudflared|\btunnel\b|ngrok|tailscale/.test(text)) return 'tunnel';
	if (/mariadb|mysql|postgres|redis|valkey|mongo|clickhouse/.test(text)) return 'database';
	if (/scheduler(:work)?\b|\bcron\b/.test(text)) return 'scheduler';
	if (/queue:work|\bworker\b|sidekiq|celery/.test(text)) return 'worker';
	if (/backup|rclone|restic/.test(text)) return 'backup';
	if (/^(api|server|backend)$/.test(service) || /server\/index\.[tj]s/.test(command)) return 'api';
	if (/nginx|caddy|traefik|haproxy|httpd/.test(text) || /^(web|frontend|client)$/.test(service)) return 'web';
	return 'app';
}

function describe(role: ContainerRole, image: string, command: string, routes?: NginxRoutes): string {
	if (role === 'worker') {
		const pool = /--pool[= ]([\w:-]+)/.exec(command)?.[1];
		const queues = /--queues?[= ]([\w:,*-]+)/.exec(command)?.[1];
		if (pool) return `pool ${pool}`;
		if (queues) return `queues ${queues}`;
		return 'queue worker';
	}
	if (role === 'gateway' && routes?.upstreams.size) {
		return [...routes.upstreams.keys()].filter(name => upstreamRole(name) !== 'direct').join(' · ') || 'reverse proxy';
	}
	if (role === 'database' || role === 'tunnel') {
		const named = /^(?:[\w.-]+\/)*([\w.-]+)(?::([\w.-]+))?(?:@.*)?$/.exec(image);
		if (named && !image.startsWith('sha256:')) return named[2] && named[2] !== 'latest' ? `${named[1]} ${named[2]}` : named[1]!;
	}
	return shortCommand(command);
}

/**
 * @param command - Full command line.
 * @returns The meaningful part: `node server/console.ts queue:work`, not the entrypoint wrapper and flags.
 */
export function shortCommand(command: string): string {
	const server = /(?:^|[\s/])(nginx|caddy|httpd|haproxy|traefik)(?:\s|$)/.exec(command);
	if (server) return server[1]!;
	return command
		.replace(/^\S*docker-entrypoint\.sh\s+/, '')
		.replace(/^sh -c\s+['"]?(?:exec\s+)?/, '')
		.replace(/\s--import\s+tsx/, '')
		.replace(/\s+--?[\w-]+(=("[^"]*"|\S+))?/g, '')
		.replace(/['"]$/, '')
		.trim();
}

/**
 * The work a queue worker takes: its `--pool` (a checked-in queue selection), else
 * the queues it names. `--name` only sets the process title, so it is ignored.
 *
 * @param command - Worker command line.
 * @returns Pool or queue list, or null when the worker uses its defaults.
 */
export function workerPool(command: string): string | null {
	return /--pool[= ]([\w:-]+)/.exec(command)?.[1] ?? /--queues?[= ]['"]?([\w:,*-]+)/.exec(command)?.[1] ?? null;
}

function releaseOf(workingDir: string | null): string | null {
	return workingDir ? /\/releases\/([^/]+)\//.exec(workingDir)?.[1] ?? null : null;
}

function healthFromStatus(status: string): ContainerSnapshot['health'] {
	const match = /\((healthy|unhealthy|health: starting)\)/.exec(status);
	if (!match) return null;
	return match[1] === 'health: starting' ? 'starting' : (match[1] as 'healthy' | 'unhealthy');
}

/** Fills `routesIn` and `traffic` by resolving each proxy's targets on its own networks. */
function traceTraffic(containers: ContainerSnapshot[], routes: Map<string, NginxRoutes>): void {
	const byName = new Map(containers.map(container => [container.name, container]));
	// network → alias → containers answering to it there.
	const dns = new Map<string, Map<string, ContainerSnapshot[]>>();
	for (const container of containers) {
		for (const network of container.networks) {
			const names = dns.get(network.name) ?? new Map<string, ContainerSnapshot[]>();
			dns.set(network.name, names);
			for (const alias of new Set([container.name, ...network.aliases])) names.set(alias, [...(names.get(alias) ?? []), container]);
		}
	}
	const resolve = (from: ContainerSnapshot, host: string): ContainerSnapshot[] => {
		const found = new Set<ContainerSnapshot>();
		for (const network of from.networks) for (const target of dns.get(network.name)?.get(host) ?? []) if (target !== from) found.add(target);
		return [...found];
	};

	const outbound = new Map<string, Array<{ to: ContainerSnapshot; role: InboundRoute['role'] }>>();
	const add = (from: string, to: ContainerSnapshot, upstream: string | null, role: InboundRoute['role']) => {
		if (to.routesIn.some(route => route.from === from && route.upstream === upstream)) return;
		to.routesIn.push({ from, upstream, role });
		outbound.set(from, [...(outbound.get(from) ?? []), { to, role }]);
	};
	const names = (list: ContainerSnapshot[]) => list.map(container => container.name);

	for (const [name, config] of routes) {
		const from = byName.get(name);
		if (!from) continue;
		const upstreamTargets = new Map<string, ContainerSnapshot[]>();
		for (const [upstream, hosts] of config.upstreams) {
			const targets = hosts.flatMap(host => resolve(from, host));
			upstreamTargets.set(upstream, targets);
			for (const target of targets) add(name, target, upstream, upstreamRole(upstream));
		}
		for (const host of config.proxyPasses) {
			if (config.upstreams.has(host)) continue;
			for (const target of resolve(from, host)) add(name, target, null, 'direct');
		}
		from.proxy = {
			upstreams: [...config.upstreams].map(([upstream, servers]) => ({ name: upstream, role: upstreamRole(upstream), servers, targets: names(upstreamTargets.get(upstream) ?? []) })),
			servers: config.servers.map(server => ({
				...server,
				locations: server.locations.map(location => ({
					...location,
					targets: location.proxyPass ? names(upstreamTargets.get(location.proxyPass) ?? resolve(from, location.proxyPass)) : [],
				})),
			})),
		};
	}

	// Tunnel ingress: `growthscout.io` → `http://growthscout:80` on the tunnel's networks.
	for (const tunnel of containers) {
		for (const rule of tunnel.tunnel?.ingress ?? []) {
			const host = /^https?:\/\/([^/:]+)/.exec(rule.service)?.[1];
			if (!host) continue;
			const targets = resolve(tunnel, host);
			rule.targets = names(targets);
			for (const target of targets) add(tunnel.name, target, rule.hostname ?? '*', 'direct');
		}
	}

	// Entry points are live. With tunnel ingress known, the tunnels are the way in;
	// otherwise anything on a public network is. Ports published beyond loopback
	// take traffic directly. Active and direct routes pass on the proxy's own state;
	// a previous upstream makes its target standby at best.
	const running = containers.filter(container => container.state === 'running');
	const tunnelsKnown = running.some(container => container.tunnel?.ingress?.length);
	const queue = running.filter(container =>
		(tunnelsKnown ? container.role === 'tunnel' : container.public)
		|| container.ports.some(port => port.hostPort && port.hostIp !== '127.0.0.1' && port.hostIp !== '::1'));
	for (const entry of queue) entry.traffic = 'live';
	while (queue.length) {
		const container = queue.shift()!;
		for (const edge of outbound.get(container.name) ?? []) {
			if (edge.to.state !== 'running') continue;
			const next = edge.role === 'previous' ? 'standby' : container.traffic;
			if (rank(next) > rank(edge.to.traffic)) {
				edge.to.traffic = next;
				queue.push(edge.to);
			}
		}
	}
}

function rank(traffic: ContainerSnapshot['traffic']): number {
	return traffic === 'live' ? 2 : traffic === 'standby' ? 1 : 0;
}

function sortContainers(list: ContainerSnapshot[]): ContainerSnapshot[] {
	return [...list].sort((a, b) =>
		ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
		// Workers are labelled by pool, so they sort by it too.
		|| (a.pool ?? a.service ?? a.name).localeCompare(b.pool ?? b.service ?? b.name)
		|| (a.replica ?? 0) - (b.replica ?? 0));
}

function groupApps(containers: ContainerSnapshot[]): AppGroup[] {
	const apps = new Map<string, AppGroup>();
	const slots = new Map<string, ContainerSnapshot[]>();
	for (const container of sortContainers(containers)) {
		let app = apps.get(container.app);
		if (!app) {
			app = { id: container.app, name: container.app === 'standalone' ? 'Standalone containers' : container.app, projects: [], routing: [], slots: [], databases: [], services: [] };
			apps.set(container.app, app);
		}
		if (container.project && !app.projects.includes(container.project)) app.projects.push(container.project);
		if (container.slot) slots.set(container.slot, [...(slots.get(container.slot) ?? []), container]);
		else if (container.role === 'gateway' || container.role === 'tunnel') app.routing.push(container.name);
		else if (container.role === 'database') app.databases.push(container.name);
		else app.services.push(container.name);
	}
	for (const [project, members] of slots) {
		const app = apps.get(members[0]!.app)!;
		const state: SlotGroup['state'] = members.some(member => member.traffic === 'live') ? 'live'
			: members.some(member => member.traffic === 'standby') ? 'standby'
				: members.some(member => member.state === 'running') ? 'idle' : 'stopped';
		app.slots.push({ id: project, label: slotOf(project)!.label, release: members.find(member => member.release)?.release ?? null, state, containers: members.map(member => member.name) });
	}
	const slotRank = { live: 0, standby: 1, idle: 2, stopped: 3 };
	for (const app of apps.values()) {
		app.projects.sort();
		app.slots.sort((a, b) => slotRank[a.state] - slotRank[b.state] || b.label.localeCompare(a.label));
	}
	// Apps serving traffic first, larger deployments before small ones; loose containers last.
	const live = (app: AppGroup) => containers.some(container => container.app === app.id && container.traffic === 'live');
	const size = (app: AppGroup) => containers.filter(container => container.app === app.id).length;
	return [...apps.values()].sort((a, b) =>
		Number(a.id === 'standalone') - Number(b.id === 'standalone')
		|| Number(live(b)) - Number(live(a))
		|| size(b) - size(a)
		|| a.name.localeCompare(b.name));
}
