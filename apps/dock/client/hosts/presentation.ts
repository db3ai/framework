import type { ContainerAction, ContainerRole, ContainerSnapshot, DiskUsage, HostSnapshot, ResponseClasses, SlotGroup } from '../../shared/hostContracts.js';
import type { ProjectNavItem } from '../dock/projectNav.js';
import { formatDuration, formatMemory, initials, type StatusTone } from '../dock/presentation.js';

/** Visual identity of a container role. */
export interface RoleMeta {
	label: string;
	icon: 'api' | 'web' | 'queue' | 'scheduler' | 'script' | 'route' | 'cloud' | 'database' | 'archive';
	color: string;
	tint: string;
}

const ROLES: Record<ContainerRole, RoleMeta> = {
	gateway: role('Gateway / router', 'route', 'gateway'),
	tunnel: role('Tunnel', 'cloud', 'gateway'),
	web: role('Web server', 'web', 'web'),
	api: role('API server', 'api', 'api'),
	worker: role('Queue worker', 'queue', 'queue'),
	scheduler: role('Scheduler', 'scheduler', 'scheduler'),
	database: role('Database', 'database', 'database'),
	backup: role('Backup', 'archive', 'script'),
	app: role('App', 'script', 'script'),
};

function role(label: string, icon: RoleMeta['icon'], token: string): RoleMeta {
	return { label, icon, color: `var(--kind-${token})`, tint: `color-mix(in srgb, var(--kind-${token}) 14%, transparent)` };
}

/**
 * @param value - Container role.
 * @returns Label, icon and colours.
 */
export function roleMeta(value: ContainerRole): RoleMeta {
	return ROLES[value] ?? ROLES.app;
}

/**
 * @param container - Container.
 * @param now - Current epoch milliseconds.
 * @returns Short status label and tone: `Up 2d 4h`, `Unhealthy · up 4d`, `Exited (1) · 2d ago`.
 */
export function containerStatus(container: ContainerSnapshot, now: number): { label: string; tone: StatusTone } {
	if (container.pending) return { label: `${container.pending[0]!.toUpperCase()}${container.pending.slice(1)}…`, tone: 'busy' };
	const since = (time: number | null) => (time ? formatDuration(now - time) : null);
	switch (container.state) {
		case 'running': {
			const up = since(container.startedAt);
			if (container.health === 'unhealthy') return { label: up ? `Unhealthy · up ${up}` : 'Unhealthy', tone: 'bad' };
			if (container.health === 'starting') return { label: 'Starting…', tone: 'busy' };
			return { label: up ? `Up ${up}` : container.status, tone: 'ok' };
		}
		case 'restarting':
			return { label: `Restarting (${container.restartCount})`, tone: 'bad' };
		case 'paused':
			return { label: 'Paused', tone: 'busy' };
		case 'exited':
		case 'dead': {
			const ago = since(container.finishedAt);
			const code = container.exitCode ?? Number(/Exited \((\d+)\)/.exec(container.status)?.[1] ?? 0);
			return { label: `Exited (${code})${ago ? ` · ${ago} ago` : ''}`, tone: code === 0 ? 'off' : 'bad' };
		}
		default:
			return { label: container.status || container.state, tone: 'off' };
	}
}

/**
 * @param container - Container.
 * @returns Whether it is running or on its way up.
 */
export function isRunning(container: ContainerSnapshot): boolean {
	return container.state === 'running' || container.state === 'restarting';
}

/**
 * @param bytesPerSecond - Throughput.
 * @returns `1.2 KB/s`, `340 B/s`, or `—`.
 */
export function formatRate(bytesPerSecond: number | null): string {
	if (bytesPerSecond === null) return '—';
	if (bytesPerSecond < 1000) return `${Math.round(bytesPerSecond)} B/s`;
	if (bytesPerSecond < 1e6) return `${(bytesPerSecond / 1e3).toFixed(1)} KB/s`;
	return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`;
}

/**
 * @param container - Container.
 * @returns `2.1% · 602 MB` while running, else `—`.
 */
export function formatContainerUsage(container: ContainerSnapshot): string {
	if (container.state !== 'running' || container.cpu === null) return container.state === 'running' && container.memory !== null ? formatMemory(container.memory) : '—';
	return `${container.cpu.toFixed(1)}% · ${formatMemory(container.memory)}`;
}

/**
 * How a container receives traffic, for the traffic column.
 *
 * @param container - Container.
 * @returns Badge label and tone, and a line saying where requests come from.
 */
export function trafficOf(container: ContainerSnapshot): { badge: string | null; tone: 'ok' | 'busy' | 'off'; via: string } {
	const routes = container.routesIn.filter(route => route.role !== 'previous' || container.traffic !== 'live');
	const via = routes.length
		? routes.map(route => (route.upstream === '*' ? 'catch-all' : route.upstream ?? route.from.replace(/-\d+$/, ''))).filter((value, index, all) => all.indexOf(value) === index).join(', ')
		: container.role === 'tunnel' ? 'Cloudflare edge'
			: container.public ? `public${container.publicAliases.length ? ` · ${container.publicAliases.join(', ')}` : ''}` : '';
	if (container.traffic === 'live') return { badge: 'Live', tone: 'ok', via };
	if (container.traffic === 'standby') return { badge: 'Standby', tone: 'busy', via };
	return { badge: null, tone: 'off', via };
}

/**
 * Ports for the traffic column. When the container's sockets could be read these
 * are the ports something really listens on (`:8787`, `127.0.0.1:3307→3306` when
 * published, `:9229 local` for loopback only); otherwise the declared ones.
 *
 * @param container - Container.
 * @returns Labels, and whether they are only declared (not checked).
 */
export function formatPorts(container: ContainerSnapshot): { labels: string[]; declared: boolean } {
	const published = (port: number) => container.ports.find(item => item.port === port && item.hostPort);
	const label = (port: number) => {
		const binding = published(port);
		return binding ? `${binding.hostIp && binding.hostIp !== '0.0.0.0' ? binding.hostIp : ''}:${binding.hostPort}→${port}` : `:${port}`;
	};
	if (container.listening) {
		return { labels: container.listening.map(item => (item.loopback ? `:${item.port} local` : label(item.port))), declared: false };
	}
	return { labels: container.ports.map(item => label(item.port)), declared: container.ports.length > 0 };
}

/**
 * @param bytes - Size in bytes.
 * @returns `812 MB`, `41.3 GB`, `1.82 TB`.
 */
export function formatDiskSize(bytes: number): string {
	const gb = bytes / 1024 ** 3;
	if (gb >= 1024) return `${(gb / 1024).toFixed(2)} TB`;
	if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
	return `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** Below either limit a disk needs attention: databases stop writing on a full disk. */
const DISK_WARN = { share: 0.9, free: 10 * 1024 ** 3 };
const DISK_BAD = { share: 0.97, free: 2 * 1024 ** 3 };

/**
 * @param disk - Filesystem.
 * @returns Share used (0–1, of what can be used: root's reserved blocks left out) and a tone.
 */
export function diskState(disk: DiskUsage): { share: number; tone: 'ok' | 'warn' | 'bad' } {
	const share = disk.used + disk.free ? disk.used / (disk.used + disk.free) : 0;
	const tone = share >= DISK_BAD.share || disk.free < DISK_BAD.free ? 'bad' : share >= DISK_WARN.share || disk.free < DISK_WARN.free ? 'warn' : 'ok';
	return { share, tone };
}

/**
 * @param disk - Filesystem.
 * @returns `41.3 GB free of 250 GB`.
 */
export function formatDisk(disk: DiskUsage): string {
	return `${formatDiskSize(disk.free)} free of ${formatDiskSize(disk.size)}`;
}

/**
 * @param perSecond - Requests per second.
 * @returns `0 req/s`, `0.4 req/s`, `12 req/s`.
 */
export function formatRequests(perSecond: number): string {
	if (perSecond === 0) return '0 req/s';
	if (perSecond < 10) return `${perSecond.toFixed(perSecond < 0.1 ? 2 : 1)} req/s`;
	return `${Math.round(perSecond)} req/s`;
}

/**
 * Observed request traffic for a row: a tunnel's rate from its metrics, an nginx
 * container's from its access log (its own health checks left out).
 *
 * @param container - Container.
 * @returns Short summary such as `1.2 req/s · 3% 5xx`, or null when not measured.
 */
export function requestSummary(container: ContainerSnapshot): string | null {
	if (container.tunnel?.requestRate != null) {
		const errors = container.tunnel.errorRate ? ` · ${formatRequests(container.tunnel.errorRate).replace('req', 'err')}` : '';
		return `${formatRequests(container.tunnel.requestRate)}${errors}`;
	}
	if (container.requests) {
		const { perSecond, byClass } = container.requests;
		const failing = byClass['5xx'] / (perSecond || 1);
		return `${formatRequests(perSecond)}${perSecond && failing >= 0.01 ? ` · ${Math.round(failing * 100)}% 5xx` : ''}`;
	}
	return null;
}

/**
 * @param classes - Counts or rates by status class.
 * @returns Share of each class (0–1), for a stacked bar.
 */
export function responseShares(classes: ResponseClasses): Array<{ key: keyof ResponseClasses; share: number; value: number }> {
	const total = classes['2xx'] + classes['3xx'] + classes['4xx'] + classes['5xx'];
	return (['2xx', '3xx', '4xx', '5xx'] as const).map(key => ({ key, value: classes[key], share: total ? classes[key] / total : 0 }));
}

/**
 * @param count - A large count.
 * @returns `195,943` style grouping.
 */
export function formatCount(count: number): string {
	return Math.round(count).toLocaleString('en-GB');
}

/** Labels for slot states. */
export const SLOT_STATE: Record<SlotGroup['state'], { label: string; tone: StatusTone; hint: string }> = {
	live: { label: 'Live', tone: 'ok', hint: 'A gateway sends public traffic to this slot.' },
	standby: { label: 'Standby', tone: 'busy', hint: 'Behind the gateway’s previous upstream: the rollback target.' },
	idle: { label: 'Idle', tone: 'off', hint: 'Running, but no gateway routes to it.' },
	stopped: { label: 'Stopped', tone: 'off', hint: 'Nothing in this slot is running.' },
};

/**
 * @param label - Slot label: `blue`, `green` or a release id.
 * @returns A short label: release ids lose their time-of-day digits.
 */
export function slotName(label: string): string {
	const release = /^(\d{4})(\d{2})(\d{2})(\d{6})-([0-9a-f]{6})/.exec(label);
	return release ? `${release[1]}-${release[2]}-${release[3]} · ${release[5]}` : label;
}

/**
 * A container's name within its app. Outside a slot that is the full container
 * name (`scout-hosted-blog-tunnel-1`): those containers come from different
 * compose projects, so the service alone (`tunnel`) says too little. Inside a
 * slot, whose header names it, the service is enough, with its replica number
 * when the service has several. Queue workers are named by the work they take,
 * `worker: images`, since their pool decides which queues they claim.
 *
 * @param container - Container.
 * @param replicated - Whether the service runs more than one container.
 * @returns Display name.
 */
export function containerLabel(container: ContainerSnapshot, replicated: boolean): string {
	const replica = replicated && container.replica ? ` ${container.replica}` : '';
	if (container.title) return `${container.title}${replica}`;
	if (container.role === 'worker') return `worker: ${container.pool ?? 'default'}${replica}`;
	if (!container.slot) return container.name;
	if (!container.service) return container.name;
	return `${container.service}${replica}`;
}

/**
 * The second line under a container's name. For a worker the pool is already in
 * its name, so this shows the compose service it runs as instead.
 *
 * @param container - Container.
 * @returns Description.
 */
export function containerDetail(container: ContainerSnapshot): string {
	// A deployment-given title replaces the name, so the real name moves here.
	if (container.title) return container.description ? `${container.name} · ${container.description}` : container.name;
	if (container.role === 'worker' && container.service) return `${container.service} service`;
	if (container.tunnel) {
		const { connections, ingress } = container.tunnel;
		const parts = [connections !== null ? `${connections} edge connection${connections === 1 ? '' : 's'}` : null, ingress ? `${ingress.filter(rule => rule.hostname || rule.targets.length).length} route${ingress.length === 1 ? '' : 's'}` : null].filter(Boolean);
		return parts.length ? parts.join(' · ') : container.detail;
	}
	return container.detail;
}

/**
 * The question to ask before an action, so a click in a production view does
 * not take down live traffic by accident. Stopping and restarting always ask.
 *
 * @param container - Target container.
 * @param action - Action.
 * @param host - Host name.
 * @returns Confirmation text, or null to go ahead.
 */
export function confirmAction(container: ContainerSnapshot, action: ContainerAction, host: string): string | null {
	if (action === 'start') return null;
	const verb = action === 'stop' ? 'Stop' : 'Restart';
	const lines = [`${verb} ${container.name} on ${host}?`];
	if (container.traffic === 'live') lines.push('It is serving live traffic; requests will fail until it is back.');
	else if (container.traffic === 'standby') lines.push('It is the rollback target behind the previous upstream.');
	if (container.role === 'database') lines.push('It is a database: everything that uses it will fail until it is back.');
	if (container.role === 'worker' && action === 'stop') lines.push('Docker waits for its stop timeout so the current job can finish.');
	if (container.slot) lines.push('Its slot is normally managed by the deploy script; a deploy may undo this.');
	return lines.join('\n\n');
}

/** Something on a host worth looking at. */
export interface HostWarning {
	/** Container to select, or null for the host itself. */
	container: string | null;
	message: string;
}

/**
 * Finds what needs attention: disks running out of space, unhealthy or
 * restarting containers, crashes, and a standby slot that could not take traffic
 * back on rollback.
 *
 * @param host - Host snapshot.
 * @returns Warnings, most serious first.
 */
export function hostWarnings(host: HostSnapshot): HostWarning[] {
	const warnings: HostWarning[] = [];
	const byName = new Map(host.containers.map(container => [container.name, container]));
	const diskWarning = (disk: DiskUsage, where: string) => {
		const { share, tone } = diskState(disk);
		return tone === 'ok' ? null : `${where} is ${Math.round(share * 100)}% full: ${formatDisk(disk)}`;
	};
	const diskKey = (disk: DiskUsage) => `${disk.filesystem}|${disk.size}`;
	// Databases first, so a shared volume disk is reported against the database.
	const storing = [...host.containers].sort((a, b) => Number(b.role === 'database') - Number(a.role === 'database'));
	for (const disk of host.disks ?? []) {
		const message = diskWarning(disk, `Disk ${disk.paths.join(', ')}`);
		const databases = storing.filter(container => container.role === 'database' && container.disks?.some(own => diskKey(own) === diskKey(disk)));
		if (message) warnings.push({ container: null, message: databases.length ? `${message} (holds ${databases.map(container => container.name).join(', ')} data)` : message });
	}
	// Containers on the same filesystem (one Docker volume disk) warn once.
	const seen = new Set((host.disks ?? []).map(diskKey));
	for (const container of storing) {
		for (const disk of container.disks ?? []) {
			const key = diskKey(disk);
			if (seen.has(key)) continue;
			seen.add(key);
			const message = diskWarning(disk, `has ${disk.paths.join(', ')} on a disk that`);
			if (message) warnings.push({ container: container.name, message });
		}
	}
	for (const container of host.containers) {
		if (container.state === 'restarting') warnings.push({ container: container.name, message: `is restarting (${container.restartCount} restarts)` });
		else if (container.state === 'running' && container.health === 'unhealthy') warnings.push({ container: container.name, message: `is unhealthy${container.traffic !== 'internal' ? ` while ${container.traffic}` : ''}` });
	}
	for (const container of host.containers) {
		const tunnel = container.tunnel;
		if (!tunnel || container.state !== 'running') continue;
		if (tunnel.connections !== null && tunnel.connections < 4) warnings.push({ container: container.name, message: `has ${tunnel.connections} of 4 edge connections` });
		// 4 connections a day is a quiet tunnel; hundreds means it keeps dropping them.
		if (tunnel.reconnects > 96) warnings.push({ container: container.name, message: `re-registered edge connections ${tunnel.reconnects} times in 24 hours` });
		for (const rule of tunnel.ingress ?? []) {
			if (/^https?:/.test(rule.service) && !rule.targets.length) warnings.push({ container: container.name, message: `routes ${rule.hostname ?? 'everything else'} to ${rule.service}, which no running container answers` });
		}
	}
	for (const app of host.apps) {
		for (const slot of app.slots) {
			const members = slot.containers.map(name => byName.get(name)!).filter(Boolean);
			const live = slot.state === 'live' || slot.state === 'standby';
			for (const member of members) {
				if ((member.state === 'exited' || member.state === 'dead') && member.exitCode && live) {
					warnings.push({ container: member.name, message: `exited with code ${member.exitCode} in the ${SLOT_STATE[slot.state].label.toLowerCase()} slot` });
				}
			}
			if (slot.state === 'standby') {
				const down = members.filter(member => member.role === 'api' && member.state !== 'running');
				if (down.length) warnings.push({ container: down[0]!.name, message: `is stopped, so rolling back to ${slotName(slot.label)} would serve errors` });
			}
		}
	}
	return warnings;
}

/**
 * @param hosts - Host snapshots.
 * @returns Navigation items for the Servers group, with ids `host:<id>`.
 */
export function hostNav(hosts: HostSnapshot[]): ProjectNavItem[] {
	return hosts.map(host => {
		const running = host.containers.filter(isRunning).length;
		const health = host.status === 'error' || hostWarnings(host).length ? 'bad' : host.status === 'online' ? 'ok' : 'off';
		return { id: `host:${host.id}`, label: host.name, initials: initials(host.name), running, total: host.containers.length, health };
	});
}

/**
 * @param container - Container.
 * @param query - Filter text.
 * @returns Whether the container matches the filter.
 */
export function matchesFilter(container: ContainerSnapshot, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [container.name, container.role, container.detail, container.traffic, container.app, container.slot ?? ''].some(text => text.toLowerCase().includes(needle));
}
