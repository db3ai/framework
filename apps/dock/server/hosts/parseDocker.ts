import type { ContainerPort } from '../../shared/hostContracts.js';

/** A row of `docker ps --format '{{json .}}'`. */
export interface PsRow {
	id: string;
	name: string;
	image: string;
	command: string;
	state: string;
	status: string;
	project: string | null;
	service: string | null;
	replica: number | null;
	workingDir: string | null;
	networks: string[];
	ports: ContainerPort[];
}

/** A row of `docker stats --no-stream --format '{{json .}}'`. */
export interface StatsRow {
	name: string;
	cpu: number | null;
	memory: number | null;
	memoryLimit: number | null;
	pids: number | null;
	/** Cumulative bytes received and sent since the container started. */
	rx: number | null;
	tx: number | null;
}

/** The parts of `docker inspect` the Dock uses, from {@link INSPECT_FORMAT}. */
export interface InspectRow {
	id: string;
	name: string;
	cmd: string[];
	entrypoint: string[];
	image: string;
	labels: Record<string, string>;
	networks: Array<{ name: string; aliases: string[]; ip?: string }>;
	health: 'healthy' | 'unhealthy' | 'starting' | null;
	healthOutput: string | null;
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	restartCount: number;
	restartPolicy: string;
}

/** Engine facts from `docker info`. */
export interface EngineInfo {
	version: string;
	os: string;
	cpus: number;
	memory: number;
}

/**
 * A Go template for `docker inspect --format` that prints one compact JSON object
 * per container, leaving out the large parts (mounts, full config, environment).
 * `.State` is taken whole because `.State.Health` is absent without a health
 * check, and a missing key fails the template for that container.
 * Environment variables are never read, so secrets in them never leave the host.
 */
export const INSPECT_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"cmd":{{json .Config.Cmd}},"entrypoint":{{json .Config.Entrypoint}},"image":{{json .Config.Image}},"labels":{{json .Config.Labels}},"networks":{{json .NetworkSettings.Networks}},"state":{{json .State}},"restartCount":{{.RestartCount}},"restartPolicy":{{json .HostConfig.RestartPolicy.Name}}}';

/** Sections of the sampling script's output, by `@@name` header. */
export type ScriptSections = Map<string, string[]>;

/**
 * Splits sampling-script output into sections. A line `@@nginx scout-gateway-1`
 * starts the section `nginx scout-gateway-1`.
 *
 * @param output - Raw script output.
 * @returns Lines by section name.
 */
export function splitSections(output: string): ScriptSections {
	const sections: ScriptSections = new Map();
	let current: string[] | null = null;
	for (const line of output.split('\n')) {
		if (line.startsWith('@@')) {
			current = [];
			sections.set(line.slice(2).trim(), current);
		} else if (current && line.trim()) {
			current.push(line);
		}
	}
	return sections;
}

/**
 * @param lines - `docker ps -a --no-trunc --format '{{json .}}'` lines.
 * @returns Parsed rows; malformed lines are skipped.
 */
export function parsePs(lines: string[]): PsRow[] {
	const rows: PsRow[] = [];
	for (const line of lines) {
		const raw = parseJson<Record<string, unknown>>(line);
		if (!raw) continue;
		const labels = String(raw.Labels ?? '');
		const replica = labelFromList(labels, 'com.docker.compose.container-number');
		rows.push({
			id: String(raw.ID ?? ''),
			name: String(raw.Names ?? '').split(',')[0]!,
			image: String(raw.Image ?? ''),
			command: unquote(String(raw.Command ?? '')),
			state: String(raw.State ?? ''),
			status: String(raw.Status ?? ''),
			project: labelFromList(labels, 'com.docker.compose.project'),
			service: labelFromList(labels, 'com.docker.compose.service'),
			replica: replica ? Number(replica) || null : null,
			workingDir: labelFromList(labels, 'com.docker.compose.project.working_dir'),
			networks: String(raw.Networks ?? '').split(',').filter(Boolean),
			ports: parsePorts(String(raw.Ports ?? '')),
		});
	}
	return rows;
}

/**
 * Reads one label from `docker ps`'s comma-joined `Labels`. Values may themselves
 * contain commas (compose's config file list), so a value runs until the next
 * `, key=` pair rather than the next comma.
 *
 * @param labels - Comma-joined `key=value` pairs.
 * @param key - Label name.
 * @returns Its value, or null.
 */
export function labelFromList(labels: string, key: string): string | null {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = new RegExp(`(?:^|,)${escaped}=(.*?)(?=,[A-Za-z0-9_.-]+=|$)`).exec(labels);
	return match ? match[1]! : null;
}

/**
 * @param ports - `docker ps` ports, such as `127.0.0.1:3307->3306/tcp, 8787/tcp`.
 * @returns Distinct container ports, published ones with their host binding.
 */
export function parsePorts(ports: string): ContainerPort[] {
	const byKey = new Map<string, ContainerPort>();
	for (const part of ports.split(',').map(item => item.trim()).filter(Boolean)) {
		const published = /^(.*):(\d+)->(\d+)(?:-\d+)?\/(\w+)$/.exec(part);
		if (published) {
			const port: ContainerPort = { port: Number(published[3]), protocol: published[4]!, hostIp: published[1]!.replace(/^\[|\]$/g, ''), hostPort: Number(published[2]) };
			const key = `${port.port}/${port.protocol}`;
			// IPv4 and IPv6 bindings of one port show twice; keep the first.
			if (!byKey.get(key)?.hostPort) byKey.set(key, port);
			continue;
		}
		const exposed = /^(\d+)(?:-\d+)?\/(\w+)$/.exec(part);
		if (exposed) {
			const key = `${exposed[1]}/${exposed[2]}`;
			if (!byKey.has(key)) byKey.set(key, { port: Number(exposed[1]), protocol: exposed[2]! });
		}
	}
	return [...byKey.values()].sort((a, b) => a.port - b.port);
}

/**
 * @param lines - `docker stats --no-stream --format '{{json .}}'` lines.
 * @returns Usage by container name.
 */
export function parseStats(lines: string[]): Map<string, StatsRow> {
	const rows = new Map<string, StatsRow>();
	for (const line of lines) {
		const raw = parseJson<Record<string, string>>(line);
		if (!raw?.Name) continue;
		const [used, limit] = (raw.MemUsage ?? '').split('/').map(part => parseSize(part));
		const [rx, tx] = (raw.NetIO ?? '').split('/').map(part => parseSize(part));
		const cpu = Number.parseFloat(raw.CPUPerc ?? '');
		const pids = Number.parseInt(raw.PIDs ?? '', 10);
		rows.set(raw.Name, {
			name: raw.Name,
			cpu: Number.isFinite(cpu) ? cpu : null,
			memory: used ?? null,
			memoryLimit: limit ?? null,
			pids: Number.isFinite(pids) ? pids : null,
			rx: rx ?? null,
			tx: tx ?? null,
		});
	}
	return rows;
}

/** Exact counters from the Engine API's one-shot stats. */
export interface ApiStats {
	name: string;
	/** Container CPU time and host CPU time, in nanoseconds. */
	cpuTotal: number;
	systemCpu: number;
	cpus: number;
	memory: number | null;
	memoryLimit: number | null;
	pids: number | null;
	rx: number;
	tx: number;
}

/**
 * @param lines - Responses of `GET /containers/{id}/stats?stream=false&one-shot=true`, one per line.
 * @returns Counters by container name.
 */
export function parseApiStats(lines: string[]): Map<string, ApiStats> {
	const rows = new Map<string, ApiStats>();
	for (const line of lines) {
		const raw = parseJson<Record<string, any>>(line);
		const name = typeof raw?.name === 'string' ? raw.name.replace(/^\//, '') : '';
		if (!raw || !name) continue;
		const memory = raw.memory_stats ?? {};
		// As `docker stats` does on cgroup v2: page cache that can be reclaimed is not usage.
		const usage = typeof memory.usage === 'number' ? memory.usage - (memory.stats?.inactive_file ?? 0) : null;
		let rx = 0;
		let tx = 0;
		for (const network of Object.values((raw.networks ?? {}) as Record<string, { rx_bytes?: number; tx_bytes?: number }>)) {
			rx += network.rx_bytes ?? 0;
			tx += network.tx_bytes ?? 0;
		}
		rows.set(name, {
			name,
			cpuTotal: Number(raw.cpu_stats?.cpu_usage?.total_usage) || 0,
			systemCpu: Number(raw.cpu_stats?.system_cpu_usage) || 0,
			cpus: Number(raw.cpu_stats?.online_cpus) || 1,
			memory: usage,
			memoryLimit: typeof memory.limit === 'number' ? memory.limit : null,
			pids: typeof raw.pids_stats?.current === 'number' ? raw.pids_stats.current : null,
			rx,
			tx,
		});
	}
	return rows;
}

/**
 * CPU percentage between two API samples, as `docker stats` computes it
 * (100 = one core busy).
 *
 * @param previous - Earlier counters of the same container.
 * @param current - Later counters.
 * @returns Percentage, or null when the samples cannot be compared.
 */
export function cpuPercent(previous: ApiStats | undefined, current: ApiStats): number | null {
	if (!previous) return null;
	const used = current.cpuTotal - previous.cpuTotal;
	const system = current.systemCpu - previous.systemCpu;
	if (used < 0 || system <= 0) return null;
	return (used / system) * current.cpus * 100;
}

const UNITS: Record<string, number> = {
	b: 1,
	kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
	kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
};

/**
 * @param text - A Docker size such as `574.1MiB`, `1.06GB`, `0B` or `--`.
 * @returns Bytes, or null when it cannot be read.
 */
export function parseSize(text: string | undefined): number | null {
	const match = /^\s*([\d.]+)\s*([a-zA-Z]+)\s*$/.exec(text ?? '');
	if (!match) return null;
	const unit = UNITS[match[2]!.toLowerCase()];
	return unit ? Number(match[1]) * unit : null;
}

/**
 * @param lines - Output of `docker inspect --format` with {@link INSPECT_FORMAT}.
 * @returns Parsed rows; malformed lines are skipped.
 */
export function parseInspect(lines: string[]): InspectRow[] {
	const rows: InspectRow[] = [];
	for (const line of lines) {
		const raw = parseJson<Record<string, any>>(line);
		if (!raw) continue;
		const labels: Record<string, string> = {};
		// Only compose and Dock labels: image labels can be large and say nothing about the deployment.
		for (const [key, value] of Object.entries((raw.labels ?? {}) as Record<string, string>)) {
			if (key.startsWith('com.docker.compose.') || key.startsWith('dock.')) labels[key] = String(value);
		}
		const state = (raw.state ?? {}) as { Health?: { Status?: string; Log?: Array<{ ExitCode?: number; Output?: string }> }; StartedAt?: string; FinishedAt?: string; ExitCode?: number };
		const health = state.Health;
		const failing = health?.Log?.filter(entry => entry.ExitCode !== 0).at(-1);
		rows.push({
			id: String(raw.id ?? ''),
			name: String(raw.name ?? '').replace(/^\//, ''),
			cmd: Array.isArray(raw.cmd) ? raw.cmd.map(String) : [],
			entrypoint: Array.isArray(raw.entrypoint) ? raw.entrypoint.map(String) : [],
			image: String(raw.image ?? ''),
			labels,
			networks: Object.entries((raw.networks ?? {}) as Record<string, { Aliases?: string[] | null; DNSNames?: string[] | null; IPAddress?: string }>).map(([name, network]) => ({
				name,
				aliases: [...new Set([...(network.Aliases ?? []), ...(network.DNSNames ?? [])])],
				...(network.IPAddress ? { ip: network.IPAddress } : {}),
			})),
			health: health?.Status === 'healthy' || health?.Status === 'unhealthy' || health?.Status === 'starting' ? health.Status : null,
			healthOutput: health?.Status === 'unhealthy' && failing?.Output ? failing.Output.trim().slice(0, 600) : null,
			startedAt: parseTime(state.StartedAt),
			finishedAt: parseTime(state.FinishedAt),
			exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
			restartCount: Number(raw.restartCount) || 0,
			restartPolicy: String(raw.restartPolicy ?? ''),
		});
	}
	return rows;
}

/**
 * @param lines - `docker info --format '{{json .}}'`-style line with ServerVersion, OperatingSystem, NCPU, MemTotal.
 * @returns Engine facts, or null.
 */
export function parseInfo(lines: string[]): EngineInfo | null {
	const raw = parseJson<Record<string, unknown>>(lines[0] ?? '');
	if (!raw) return null;
	return {
		version: String(raw.ServerVersion ?? ''),
		os: String(raw.OperatingSystem ?? ''),
		cpus: Number(raw.NCPU) || 0,
		memory: Number(raw.MemTotal) || 0,
	};
}

/**
 * @param line - A `docker events --format '{{json .}}'` line.
 * @returns The container event, or null for other event types.
 */
export function parseEvent(line: string): { time: number; container: string; project: string | null; action: string; exitCode: number | null } | null {
	const raw = parseJson<{ Type?: string; Action?: string; time?: number; timeNano?: number; Actor?: { Attributes?: Record<string, string> } }>(line);
	if (!raw || raw.Type !== 'container' || !raw.Action) return null;
	const attributes = raw.Actor?.Attributes ?? {};
	// exec_* events fire for every health check and `docker exec`, including Dock's own.
	if (raw.Action.startsWith('exec_') || raw.Action.startsWith('attach') || raw.Action === 'top' || raw.Action === 'resize') return null;
	const exitCode = attributes.exitCode !== undefined ? Number(attributes.exitCode) : null;
	return {
		time: raw.timeNano ? Math.round(raw.timeNano / 1e6) : (raw.time ?? 0) * 1000,
		container: attributes.name ?? '',
		project: attributes['com.docker.compose.project'] ?? null,
		action: raw.Action,
		exitCode: Number.isFinite(exitCode) ? exitCode : null,
	};
}

function parseTime(value: unknown): number | null {
	if (typeof value !== 'string' || value.startsWith('0001-')) return null;
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
}

function parseJson<T>(line: string): T | null {
	try {
		return JSON.parse(line) as T;
	} catch {
		return null;
	}
}

/** `docker ps` wraps the command in double quotes. */
function unquote(command: string): string {
	return command.startsWith('"') && command.endsWith('"') ? command.slice(1, -1) : command;
}
