import type { ChildProcess } from 'node:child_process';

import type { ContainerAction, ContainerSnapshot, DiskUsage, HostActivity, HostDefinition, HostSnapshot, KubernetesInfo, ListeningPort, RequestStats } from '../../shared/hostContracts.js';
import { emptyHistory, pushSample, type UsageHistory } from '../../shared/usageHistory.js';
import { DockRequestError } from '../projects/ProjectStore.js';
import { buildTopology } from './buildTopology.js';
import { cpuPercent, INSPECT_FORMAT, parseApiStats, parseEvent, parseInfo, parseInspect, parsePs, parseStats, splitSections, type ApiStats, type EngineInfo, type InspectRow, type PsRow, type StatsRow } from './parseDocker.js';
import { KUBE_PRELUDE, parseKubeNodes, parseKubePods, type KubeNodes, type KubeTarget } from './parseKube.js';
import { parseNginxRoutes, type NginxRoutes } from './parseNginxRoutes.js';
import { LISTEN_OK, NO_MOUNTS, parseAccessCounts, parseDisks, parseListening, parseTunnelLog, parseTunnelMetrics, type TunnelLog, type TunnelMetrics } from './parseRuntime.js';
import { CONTAINER_NAME, RemoteShell } from './RemoteShell.js';

/** Tunnel logs are read in full, so only this often (and when containers change). */
const TUNNEL_LOG_EVERY_MS = 5 * 60 * 1000;
/** cloudflared's default metrics port when its log does not say. */
const DEFAULT_METRICS_PORT = 20241;

const KUBE_DENIED = 'k3s is installed, but this user cannot read the cluster. On the machine, run: mkdir -p ~/.kube && sudo k3s kubectl config view --raw > ~/.kube/config && chmod 600 ~/.kube/config';

/** Sampling intervals; tests shorten them. */
export interface WatcherOptions {
	/** Containers, usage and traffic. */
	fastEveryMs: number;
	/** Inspect details and gateway routes, also refreshed whenever containers change. */
	slowEveryMs: number;
	/** Shell factory; tests pass a fake. */
	shell?: (host: HostDefinition) => Pick<RemoteShell, 'run' | 'stream' | 'target'>;
}

const ACTIVITY_LIMIT = 200;
/** Events that change what runs, so the topology is sampled again straight away. */
const TOPOLOGY_EVENTS = new Set(['create', 'start', 'restart', 'stop', 'die', 'destroy', 'pause', 'unpause', 'rename', 'oom']);
/** Events shown in the activity feed. `kill` always comes with `die`, so it is noise. */
const SHOWN_EVENTS = new Set([...TOPOLOGY_EVENTS, 'health_status: unhealthy', 'health_status: healthy']);

/**
 * Watches the containers on one Docker host while started.
 *
 * Every few seconds it lists containers and their usage. Container details and
 * nginx routes are read again whenever the set of containers or their states
 * change (from the sample or from `docker events`), and at a slower interval.
 * Containers are mostly started and stopped by other tools (deploy scripts,
 * restart policies), so `docker events` is followed to notice that at once and
 * to keep an activity log.
 */
export class HostWatcher {
	readonly #host: HostDefinition;
	readonly #shell: Pick<RemoteShell, 'run' | 'stream' | 'target'>;
	readonly #options: WatcherOptions;
	readonly #publish: (host: HostSnapshot) => void;
	readonly #docker: string;

	#status: HostSnapshot['status'] = 'connecting';
	#error: string | null = null;
	#sampledAt: number | null = null;
	#latencyMs: number | null = null;
	#engine: EngineInfo | null = null;
	#ps: PsRow[] = [];
	#inspect = new Map<string, InspectRow>();
	#routes = new Map<string, NginxRoutes>();
	#api = new Map<string, ApiStats & { at: number }>();
	#stats = new Map<string, StatsRow>();
	#rates = new Map<string, { rx: number; tx: number }>();
	#pending = new Map<string, ContainerSnapshot['pending']>();
	#listening = new Map<string, ListeningPort[] | null>();
	#disks: DiskUsage[] | null = null;
	#containerDisks = new Map<string, DiskUsage[] | null>();
	#tunnelLogs = new Map<string, TunnelLog>();
	#tunnelLogAt = 0;
	#tunnelMetrics = new Map<string, { metrics: TunnelMetrics; requestRate: number | null; errorRate: number | null; at: number }>();
	#requests = new Map<string, RequestStats>();
	#history = new Map<string, UsageHistory>();
	#kubeTargets = new Map<string, KubeTarget>();
	#kubeNodes: KubeNodes | null = null;
	#kube: 'none' | 'ok' | 'denied' = 'none';
	#accessAt = 0;
	#activity: HostActivity[] = [];
	#snapshot: HostSnapshot;

	#active = false;
	#sampling = false;
	#again = false;
	#dirty = true;
	#signature = '';
	#slowAt = 0;
	#timer: NodeJS.Timeout | null = null;
	#publishTimer: NodeJS.Timeout | null = null;
	#events: { child: ChildProcess; stop: () => void } | null = null;
	#eventsRetry: NodeJS.Timeout | null = null;

	/**
	 * @param host - Host definition.
	 * @param options - Intervals and shell.
	 * @param publish - Called with a new snapshot whenever something changes.
	 */
	constructor(host: HostDefinition, options: WatcherOptions, publish: (host: HostSnapshot) => void) {
		this.#host = host;
		this.#options = options;
		this.#shell = options.shell ? options.shell(host) : new RemoteShell(host);
		this.#publish = publish;
		this.#docker = host.docker && /^[\w./-]+$/.test(host.docker) ? host.docker : 'docker';
		this.#snapshot = this.#build();
	}

	/** The latest snapshot. */
	snapshot(): HostSnapshot {
		return this.#snapshot;
	}

	/** Starts sampling and following events. */
	start(): void {
		if (this.#active) return;
		this.#active = true;
		this.#schedule(0);
		this.#followEvents();
	}

	/** Stops sampling and the events stream; the last snapshot is kept. */
	stop(): void {
		this.#active = false;
		for (const timer of [this.#timer, this.#eventsRetry, this.#publishTimer]) if (timer) clearTimeout(timer);
		this.#timer = this.#eventsRetry = this.#publishTimer = null;
		this.#events?.stop();
		this.#events = null;
	}

	/** Samples now (or right after the sample in flight). */
	async sample(): Promise<void> {
		if (this.#sampling) {
			this.#again = true;
			return;
		}
		this.#sampling = true;
		if (this.#timer) clearTimeout(this.#timer);
		const slow = this.#dirty || Date.now() - this.#slowAt >= this.#options.slowEveryMs;
		const started = Date.now();
		try {
			const output = await this.#shell.run(this.#script(slow, started), 30000);
			this.#apply(output, slow, Date.now());
			this.#status = 'online';
			this.#error = null;
			this.#latencyMs = Date.now() - started;
			this.#sampledAt = Date.now();
		} catch (error) {
			this.#status = 'error';
			this.#error = (error as Error).message;
		} finally {
			this.#sampling = false;
		}
		this.#snapshot = this.#build();
		this.#publish(this.#snapshot);
		if (this.#again || (this.#dirty && this.#status === 'online')) {
			this.#again = false;
			this.#schedule(300);
		} else {
			this.#schedule(this.#status === 'error' ? Math.max(this.#options.fastEveryMs, 15000) : this.#options.fastEveryMs);
		}
	}

	/**
	 * Starts, stops or restarts a container. Stopping honours the container's own
	 * stop timeout, so a queue worker can finish its job; the call returns when
	 * Docker does.
	 *
	 * @param name - Container name.
	 * @param action - Action.
	 */
	async action(name: string, action: ContainerAction): Promise<void> {
		const pod = this.#kubeTargets.get(name);
		if (pod) return this.#podAction(name, pod, action);
		this.#container(name);
		this.#pending.set(name, action === 'start' ? 'starting' : action === 'stop' ? 'stopping' : 'restarting');
		this.#refresh();
		try {
			await this.#shell.run(`${this.#docker} ${action} ${name}`, 20 * 60 * 1000);
		} catch (error) {
			throw new DockRequestError(`Could not ${action} ${name}: ${(error as Error).message}`, 502);
		} finally {
			this.#pending.delete(name);
			this.#dirty = true;
			void this.sample();
		}
	}

	/**
	 * Follows a container's log output.
	 *
	 * @param name - Container name.
	 * @param onData - Receives terminal-ready text (CRLF line ends).
	 * @param onEnd - Called once when the stream ends by itself.
	 * @param tail - Lines of history to start with.
	 * @returns Stop function.
	 */
	logs(name: string, onData: (text: string) => void, onEnd: (message: string) => void, tail = 500): () => void {
		const lines = Math.max(0, Math.min(tail, 10000));
		const pod = this.#kubeTargets.get(name);
		if (!pod) this.#container(name);
		const { child, stop } = this.#shell.stream(pod ? `${KUBE_PRELUDE}\n$KC logs -f --tail ${lines} -n ${pod.namespace} ${pod.pod} -c ${pod.container} 2>&1` : `${this.#docker} logs -f --tail ${lines} ${name} 2>&1`);
		// docker logs prints bare newlines; a terminal needs carriage returns too.
		child.stdout!.on('data', (text: string) => onData(text.replace(/\r?\n/g, '\r\n')));
		let stderr = '';
		child.stderr!.on('data', chunk => (stderr += chunk));
		child.on('close', () => onEnd(stderr.trim() ? stderr.trim().split('\n').at(-1)! : 'Log stream ended.'));
		child.on('error', error => onEnd(error.message));
		return stop;
	}

	/**
	 * Restarts a pod's container by deleting the pod, so its Deployment or
	 * StatefulSet replaces it. Kubernetes keeps pods running, so stop and start
	 * are refused: scaling belongs to whatever deployed it.
	 */
	async #podAction(name: string, pod: KubeTarget, action: ContainerAction): Promise<void> {
		if (action !== 'restart') throw new DockRequestError(`${name} runs in Kubernetes, which starts it again if stopped. Restart replaces the pod; scale it where it is deployed.`, 400);
		this.#pending.set(name, 'restarting');
		this.#refresh();
		try {
			await this.#shell.run(`${KUBE_PRELUDE}\n$KC delete pod -n ${pod.namespace} ${pod.pod} --wait=false`, 60 * 1000);
		} catch (error) {
			throw new DockRequestError(`Could not restart ${name}: ${(error as Error).message}`, 502);
		} finally {
			this.#pending.delete(name);
			this.#dirty = true;
			void this.sample();
		}
	}

	/**
	 * @param name - Container name.
	 * @throws DockRequestError when it is not a known container name.
	 */
	#container(name: string): PsRow {
		const row = CONTAINER_NAME.test(name) ? this.#ps.find(item => item.name === name) : undefined;
		if (!row) throw new DockRequestError(`No container "${name}" on ${this.#host.name}.`, 404);
		return row;
	}

	#schedule(delayMs: number): void {
		if (!this.#active) return;
		if (this.#timer) clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.sample(), delayMs);
	}

	/** Rebuilds the snapshot and publishes it soon, coalescing bursts of events. */
	#refresh(): void {
		this.#snapshot = this.#build();
		if (this.#publishTimer) return;
		this.#publishTimer = setTimeout(() => {
			this.#publishTimer = null;
			this.#publish(this.#snapshot);
		}, 150);
	}

	/**
	 * The sampling script. Independent steps run in parallel on the host, each
	 * writing its own `@@section` to a file in a temporary folder that is printed
	 * at the end: `docker logs` and `docker exec` take a few hundred milliseconds
	 * each, which would add up across containers.
	 */
	#script(slow: boolean, at: number): string {
		const docker = this.#docker;
		const lines = [
			'J=$(mktemp -d) || exit 4',
			`trap 'rm -rf "$J"' EXIT`,
			KUBE_PRELUDE,
			'case "$KC" in',
			'\tdenied) echo @@k8s-denied ;;',
			// Each ends with `echo`: `--raw` output has no final newline to end its section.
			`\t?*) { echo @@k8s-pods; $KC get pods -A -o json; echo; } > "$J/k" & { echo @@k8s-metrics; $KC get --raw /apis/metrics.k8s.io/v1beta1/pods 2>/dev/null; echo; } > "$J/km" &${slow ? ` { echo @@k8s-nodes; $KC get nodes -o json; echo; } > "$J/kn" &` : ''} ;;`,
			'esac',
			'echo @@ps',
			// A k3s machine may have no Docker at all.
			`${docker} ps -a --no-trunc --format '{{json .}}' 2>/dev/null || [ -n "$KC" ] || exit 3`,
			// The Engine API gives exact counters and is faster than `docker stats`.
			`SOCK=$(${docker} context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null | sed -n 's#^unix://##p')`,
			'[ -S "$SOCK" ] || SOCK=/var/run/docker.sock',
			'if command -v curl >/dev/null 2>&1 && [ -S "$SOCK" ]; then',
			'\techo @@stats-api > "$J/s"',
			`\tfor id in $(${docker} ps -q); do { curl -s --max-time 3 --unix-socket "$SOCK" "http://docker/containers/$id/stats?stream=false&one-shot=true"; echo; } > "$J/s-$id" & done`,
			'else',
			`\t{ echo @@stats; ${docker} stats --no-stream --format '{{json .}}'; } > "$J/s" &`,
			'fi',
			...this.#runtimeScript(at),
		];
		if (slow) {
			lines.push(
				`{ echo @@info; ${docker} info --format '{"ServerVersion":{{json .ServerVersion}},"OperatingSystem":{{json .OperatingSystem}},"NCPU":{{.NCPU}},"MemTotal":{{.MemTotal}}}'; } > "$J/i" &`,
				`IDS=$(${docker} ps -aq)`,
				`{ echo @@inspect; [ -n "$IDS" ] && ${docker} inspect --format '${INSPECT_FORMAT}' $IDS; } > "$J/n" &`,
				// Disk space as each running container sees its volumes, which on a Mac
				// (Docker Desktop, OrbStack) live in the VM's own disk. One inspect, then one
				// exec at a time, started before the loops below: only a few containers
				// have mounts, and each call over an SSH Docker context is a new connection.
				`[ -n "$IDS" ] && { ${docker} inspect --format '{{.Name}}|{{.State.Running}}|{{range .Mounts}}{{if ne .Type "tmpfs"}}{{.Destination}} {{end}}{{end}}' $IDS | while IFS="|" read -r c R M; do`,
				'\t[ "$R" = true ] || continue',
				'\tc=${c#/}',
				`\t{ echo "@@disk $c"; if [ -z "$M" ]; then echo '${NO_MOUNTS}'; else ${docker} exec "$c" df -P -k $M </dev/null 2>/dev/null; fi; } > "$J/d-$c"`,
				'done; } 2>/dev/null &',
				// Proxy routes, from every running nginx; comments and blank lines dropped.
				`for c in $(${docker} ps --no-trunc --format '{{.Names}}|{{.Image}}|{{.Command}}' | awk -F'|' 'tolower($2 $3) ~ /nginx/ {print $1}'); do`,
				`\t{ echo "@@nginx $c"; ${docker} exec "$c" nginx -T 2>/dev/null | grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$'; } > "$J/g-$c" &`,
				'done',
				// What really listens, from each container's own socket table (the image's
				// declared ports often say nothing: workers share the API's image).
				`for c in $(${docker} ps --format '{{.Names}}'); do`,
				`\t{ echo "@@listen $c"; OUT=$(${docker} exec "$c" cat /proc/net/tcp /proc/net/tcp6 2>/dev/null); case "$OUT" in *local_address*) printf '%s\\n' "$OUT" | awk '$4 == "0A" {print $2}'; echo '${LISTEN_OK}';; esac; } > "$J/l-$c" &`,
				'done',
				// Disk space on the host: its data volume (macOS keeps the system one
				// read-only), the home folder and Docker's root when it is on this machine.
				`{ echo @@disk-host; R=$(${docker} info --format '{{.DockerRootDir}}' 2>/dev/null); P=/; [ -d /System/Volumes/Data ] && P=/System/Volumes/Data; for d in "$P" "$HOME" "$R"; do [ -n "$d" ] && [ -d "$d" ] && df -P -k "$d" 2>/dev/null; done; } > "$J/h" &`,
			);
		}
		if (slow && (this.#dirty || at - this.#tunnelLogAt >= TUNNEL_LOG_EVERY_MS)) {
			// The latest ingress configuration, version and metrics address, and how
			// often edge connections were re-registered in the last day.
			const since = new Date(at - 24 * 3600 * 1000).toISOString().slice(0, 19);
			lines.push(
				'echo @@tunnel-logs',
				`for c in $(${docker} ps --no-trunc --format '{{.Names}}|{{.Image}}|{{.Command}}' | awk -F'|' 'tolower($2 $3) ~ /cloudflared/ {print $1}'); do`,
				`\t{ echo "@@tunnel $c"; ${docker} logs "$c" 2>&1 | awk -v since='${since}' '/tunnelID=/ {t=$0} / INF Version / {v=$0} /Starting metrics server/ {m=$0} /Updated to new configuration/ {g=$0} /Registered tunnel connection/ && $1 >= since {n++} END {print t; print v; print m; print g; print "reconnects=" n+0}'; } > "$J/t-$c" &`,
				'done',
			);
		}
		lines.push('wait', 'cat "$J"/* 2>/dev/null', 'exit 0');
		return lines.join('\n');
	}

	/**
	 * Script lines for every sample, run in the background: cloudflared metrics
	 * (straight to the container's address, else from a neighbouring container
	 * with `wget`) and request counts from nginx access logs since the last
	 * sample. Requests from the container itself (its health check) are not counted.
	 */
	#runtimeScript(at: number): string[] {
		const docker = this.#docker;
		const lines: string[] = [];
		const running = new Set(this.#ps.filter(row => row.state === 'running').map(row => row.name));
		const proxies = [...this.#routes.keys()].filter(name => running.has(name) && CONTAINER_NAME.test(name));
		for (const name of this.#tunnelLogs.keys()) {
			if (!running.has(name) || !CONTAINER_NAME.test(name)) continue;
			const networks = this.#inspect.get(name)?.networks ?? [];
			const ip = networks.map(network => network.ip).find(address => address && /^[\d.]+$/.test(address));
			const port = this.#tunnelLogs.get(name)?.metricsPort ?? DEFAULT_METRICS_PORT;
			const neighbour = proxies.find(proxy => this.#inspect.get(proxy)?.networks.some(network => networks.some(own => own.name === network.name)));
			const fetches = [
				ip ? `curl -s -m 2 'http://${ip}:${port}/metrics'` : null,
				neighbour ? `${docker} exec ${neighbour} wget -qO- -T 2 'http://${name}:${port}/metrics'` : null,
			].filter(Boolean);
			if (!fetches.length) continue;
			lines.push(`{ echo "@@metrics ${name}"; { ${fetches.join(' || ')}; } 2>/dev/null | grep -E '^cloudflared_tunnel_(ha_connections|total_requests|request_errors|concurrent_requests_per_tunnel|response_by_code)'; } > "$J/m-${name}" &`);
		}
		const window = this.#accessAt ? Math.min(60, Math.max(3, Math.round((at - this.#accessAt) / 1000))) : 30;
		for (const name of proxies) {
			lines.push(`{ echo "@@access ${name}"; ${docker} logs --since $(( $(date +%s) - ${window} )) ${name} 2>/dev/null | awk '$1 !~ /^(127\\.|::1)/ && match($0, /" [1-5][0-9][0-9] /) {c = substr($0, RSTART + 2, 1); n[c]++; t++} END {print ${window}, t + 0, n[2] + 0, n[3] + 0, n[4] + 0, n[5] + 0}'; } > "$J/x-${name}" &`);
		}
		return lines;
	}

	#apply(output: string, slow: boolean, at: number): void {
		const sections = splitSections(output);
		const kube = parseKubePods(sections.get('k8s-pods'), sections.get('k8s-metrics'));
		this.#kube = sections.has('k8s-denied') ? 'denied' : sections.has('k8s-pods') ? 'ok' : 'none';
		this.#kubeTargets = kube.targets;
		if (sections.has('k8s-nodes')) this.#kubeNodes = parseKubeNodes(sections.get('k8s-nodes'));
		this.#ps = [...parsePs(sections.get('ps') ?? []), ...kube.ps];
		const signature = this.#ps.map(row => `${row.id}:${row.state}`).sort().join(',');
		if (slow) {
			this.#inspect = new Map(parseInspect(sections.get('inspect') ?? []).map(row => [row.name, row]));
			this.#routes = new Map();
			for (const [section, lines] of sections) {
				if (section.startsWith('nginx ')) this.#routes.set(section.slice(6), parseNginxRoutes(lines.join('\n')));
			}
			this.#engine = parseInfo(sections.get('info') ?? []) ?? this.#engine;
			this.#listening = new Map();
			for (const [section, lines] of sections) {
				if (section.startsWith('listen ')) this.#listening.set(section.slice(7), parseListening(lines));
			}
			// A busy engine or SSH server sometimes refuses a call: keep the last reading then.
			const disks = new Map<string, DiskUsage[] | null>();
			for (const row of this.#ps) {
				if (row.state !== 'running') continue;
				const lines = sections.get(`disk ${row.name}`);
				disks.set(row.name, lines?.includes(NO_MOUNTS) ? [] : lines?.length ? parseDisks(lines) : this.#containerDisks.get(row.name) ?? null);
			}
			this.#containerDisks = disks;
			if (sections.has('disk-host')) this.#disks = parseDisks(sections.get('disk-host')!, true);
			if (sections.has('tunnel-logs')) {
				this.#tunnelLogs = new Map();
				for (const [section, lines] of sections) {
					if (section.startsWith('tunnel ')) this.#tunnelLogs.set(section.slice(7), parseTunnelLog(lines));
				}
				this.#tunnelLogAt = at;
			}
			this.#slowAt = at;
			this.#signature = signature;
			this.#dirty = false;
		} else if (signature !== this.#signature) {
			this.#dirty = true;
		}

		const requests = new Map<string, RequestStats>();
		for (const [section, lines] of sections) {
			if (section.startsWith('access ')) {
				const counts = parseAccessCounts(lines[0]);
				if (counts) requests.set(section.slice(7), counts);
			}
			if (section.startsWith('metrics ')) {
				const name = section.slice(8);
				const metrics = parseTunnelMetrics(lines);
				if (!metrics) continue;
				const previous = this.#tunnelMetrics.get(name);
				const seconds = previous ? (at - previous.at) / 1000 : 0;
				const rate = (now: number | null, before: number | null | undefined) => (now !== null && before != null && seconds > 0 && now >= before ? (now - before) / seconds : null);
				this.#tunnelMetrics.set(name, { metrics, requestRate: rate(metrics.requests, previous?.metrics.requests), errorRate: rate(metrics.errors, previous?.metrics.errors), at });
			}
		}
		this.#requests = requests;
		this.#accessAt = at;

		if (sections.has('stats-api')) {
			const stats = new Map<string, StatsRow>();
			const rates = new Map<string, { rx: number; tx: number }>();
			const api = new Map<string, ApiStats & { at: number }>();
			for (const [name, current] of parseApiStats(sections.get('stats-api') ?? [])) {
				const previous = this.#api.get(name);
				const seconds = previous ? (at - previous.at) / 1000 : 0;
				stats.set(name, { name, cpu: cpuPercent(previous, current), memory: current.memory, memoryLimit: current.memoryLimit, pids: current.pids, rx: current.rx, tx: current.tx });
				if (previous && seconds > 0 && current.rx >= previous.rx && current.tx >= previous.tx) {
					rates.set(name, { rx: (current.rx - previous.rx) / seconds, tx: (current.tx - previous.tx) / seconds });
				}
				api.set(name, { ...current, at });
			}
			this.#api = api;
			this.#stats = stats;
			this.#rates = rates;
		} else {
			// `docker stats` rounds its counters, so rates are only a rough guide.
			const stats = parseStats(sections.get('stats') ?? []);
			const rates = new Map<string, { rx: number; tx: number }>();
			for (const [name, current] of stats) {
				const previous = this.#stats.get(name);
				const seconds = this.#sampledAt ? (at - this.#sampledAt) / 1000 : 0;
				if (previous?.rx != null && previous.tx != null && current.rx != null && current.tx != null && seconds > 0) {
					rates.set(name, { rx: Math.max(0, current.rx - previous.rx) / seconds, tx: Math.max(0, current.tx - previous.tx) / seconds });
				}
			}
			this.#stats = stats;
			this.#rates = rates;
		}

		for (const [name, row] of kube.inspect) this.#inspect.set(name, row);
		for (const [name, row] of kube.stats) this.#stats.set(name, row);

		const history = new Map<string, UsageHistory>();
		for (const row of this.#ps) {
			if (row.state !== 'running') continue;
			const stats = this.#stats.get(row.name);
			history.set(row.name, pushSample(this.#history.get(row.name) ?? emptyHistory(), stats?.cpu ?? null, stats?.memory ?? null));
		}
		this.#history = history;
	}

	#build(): HostSnapshot {
		const topology = buildTopology({
			ps: this.#ps,
			inspect: this.#inspect,
			stats: this.#stats,
			routes: this.#routes,
			rates: this.#rates,
			pending: this.#pending,
			listening: this.#listening,
			disks: this.#containerDisks,
			tunnelLogs: this.#tunnelLogs,
			tunnelMetrics: this.#tunnelMetrics,
			requests: this.#requests,
			history: this.#history,
			host: this.#host,
		});
		return {
			id: this.#host.id,
			name: this.#host.name,
			target: this.#shell.target,
			status: this.#status,
			error: this.#error,
			sampledAt: this.#sampledAt,
			latencyMs: this.#latencyMs,
			engine: this.#engine,
			kubernetes: this.#kubernetes(),
			disks: this.#disks,
			containers: topology.containers,
			apps: topology.apps,
			activity: this.#activity,
		};
	}

	#kubernetes(): KubernetesInfo | null {
		if (this.#kube === 'none') return null;
		if (this.#kube === 'denied') return { version: '', nodes: 0, cpus: 0, memory: 0, error: KUBE_DENIED };
		const nodes = this.#kubeNodes;
		return { version: nodes?.version ?? '', nodes: nodes?.nodes ?? 0, cpus: nodes?.cpus ?? 0, memory: nodes?.memory ?? 0, error: null };
	}

	#followEvents(): void {
		if (!this.#active || this.#events) return;
		const stream = this.#shell.stream(`${this.#docker} events --format '{{json .}}' --filter type=container`);
		this.#events = stream;
		let buffer = '';
		stream.child.stdout!.on('data', (text: string) => {
			buffer += text;
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) this.#onEvent(line);
		});
		stream.child.on('close', () => {
			if (this.#events !== stream) return;
			this.#events = null;
			// The connection dropped or the engine restarted: follow again shortly.
			if (this.#active) this.#eventsRetry = setTimeout(() => this.#followEvents(), 10000);
		});
		stream.child.on('error', () => undefined);
	}

	#onEvent(line: string): void {
		const event = parseEvent(line);
		if (!event || !event.container) return;
		if (SHOWN_EVENTS.has(event.action)) {
			this.#activity = [event, ...this.#activity].slice(0, ACTIVITY_LIMIT);
			this.#refresh();
		}
		if (TOPOLOGY_EVENTS.has(event.action)) {
			this.#dirty = true;
			this.#schedule(800);
		}
	}
}
