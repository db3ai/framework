/**
 * Wire contracts for servers: Docker hosts the Dock watches over SSH (or on this
 * machine). Everything here is plain JSON so it can cross HTTP and server-sent events.
 */

import type { UsageHistory } from './usageHistory.js';

/** A Docker host saved in the Dock config. */
export interface HostDefinition {
	/** Stable id, such as `mac-server`. */
	id: string;
	/** Display name. */
	name: string;
	/** SSH destination such as `steve@mac-server`; omitted for this machine. */
	ssh?: string;
	/** Docker CLI on the host. Defaults to `docker` with common install folders on `PATH`. */
	docker?: string;
	/** Networks whose members receive public traffic (a Cloudflare tunnel's, say). Defaults to `edge`. */
	publicNetworks?: string[];
	/** Explicit app groups, matched against compose project names (`*` wildcards). */
	apps?: Array<{ name: string; match: string[] }>;
}

/** What a container does, inferred from its service, image and command. */
export type ContainerRole = 'gateway' | 'tunnel' | 'web' | 'api' | 'worker' | 'scheduler' | 'database' | 'backup' | 'app';

/** Whether a container is in the request path. */
export type TrafficState =
	/** Reached from a public entry point through active routes. */
	| 'live'
	/** Behind a gateway's previous/standby upstream: rollback target, still reachable. */
	| 'standby'
	/** Not routed to: workers, schedulers, databases, an idle slot. */
	| 'internal';

/** A container port, published to the host or only exposed to other containers. */
export interface ContainerPort {
	port: number;
	protocol: string;
	/** Host address and port when published, such as `127.0.0.1` and `3307`. */
	hostIp?: string;
	hostPort?: number;
}

/** A TCP port a container's processes actually listen on, from its own `/proc/net/tcp`. */
export interface ListeningPort {
	port: number;
	/** Bound to 127.0.0.1 or ::1 only: not reachable from other containers. */
	loopback: boolean;
}

/** Counts or rates by HTTP status class. */
export interface ResponseClasses {
	'2xx': number;
	'3xx': number;
	'4xx': number;
	'5xx': number;
}

/** Requests seen recently, from an nginx container's access log. */
export interface RequestStats {
	perSecond: number;
	/** Requests per second by status class. */
	byClass: ResponseClasses;
}

/** How an nginx container routes, read from `nginx -T`. */
export interface ProxyInfo {
	upstreams: Array<{
		name: string;
		role: 'active' | 'previous' | 'direct';
		/** Hosts as written in the config. */
		servers: string[];
		/** Containers those hosts resolve to on this proxy's networks. */
		targets: string[];
	}>;
	servers: Array<{
		listen: string[];
		names: string[];
		locations: Array<{
			path: string;
			/** Upstream or host from `proxy_pass`. */
			proxyPass: string | null;
			returns: string | null;
			/** Named location used when this one errors, such as `@previous_assets`. */
			fallback: string | null;
			/** Containers the proxy target resolves to (through the upstream when it is one). */
			targets: string[];
		}>;
	}>;
}

/** A Cloudflare Tunnel connector (cloudflared): its edge connections, traffic and ingress. */
export interface TunnelInfo {
	id: string | null;
	version: string | null;
	/** Live connections to Cloudflare's edge (normally 4); null without metrics. */
	connections: number | null;
	/** Requests and failed requests per second between the last two samples. */
	requestRate: number | null;
	errorRate: number | null;
	concurrent: number | null;
	/** Totals since the connector started. */
	totalRequests: number | null;
	totalErrors: number | null;
	responses: ResponseClasses | null;
	/** Public hostnames and where they go, from the latest configuration in its log. */
	ingress: Array<{ hostname: string | null; service: string; targets: string[] }> | null;
	configVersion: number | null;
	configAt: number | null;
	/** Edge connections registered in the last 24 hours; many more than 4 means churn. */
	reconnects: number;
}

/** A filesystem's size and use, from `df`. */
export interface DiskUsage {
	/** Device or volume name as `df` reports it. */
	filesystem: string;
	/** Where it is mounted: host folders, or the container paths stored on it. */
	paths: string[];
	/** Bytes. */
	size: number;
	used: number;
	free: number;
}

/** A route into a container from a reverse proxy on the same host. */
export interface InboundRoute {
	/** Container name of the proxy. */
	from: string;
	/** nginx upstream name or tunnel hostname, or null for a direct `proxy_pass`. */
	upstream: string | null;
	/** `active`/`previous` for blue/green upstreams, else `direct`. */
	role: 'active' | 'previous' | 'direct';
}

/** Live view of one container. */
export interface ContainerSnapshot {
	id: string;
	name: string;
	/** Compose project, or null for a container started by hand. */
	project: string | null;
	/** Compose service. */
	service: string | null;
	/** Replica number within the service. */
	replica: number | null;
	/** App group id this container belongs to. */
	app: string;
	/** Slot (compose project) for blue/green or release-id deployments, else null. */
	slot: string | null;
	role: ContainerRole;
	/** Short description of the work, such as `pool shared` or `mariadb 12.3`. */
	detail: string;
	/**
	 * Name and purpose given by the deployment as `dock.title` and `dock.description`
	 * labels on the compose service, so every Dock shows the same; null when unset.
	 */
	title: string | null;
	description: string | null;
	/**
	 * Queue worker selection: the `--pool` (which decides the queues it claims), or
	 * its `--queues`/`--queue` list when started without a pool. Null for other roles.
	 */
	pool: string | null;
	/** Command line, entrypoint included. */
	command: string;
	image: string;
	/** Release id from the compose working folder, when deployed as a release. */
	release: string | null;
	/** Docker state: `running`, `exited`, `restarting`, `created`, `paused`, `dead`. */
	state: string;
	/** Docker's status text, such as `Up 2 days (healthy)`. */
	status: string;
	health: 'healthy' | 'unhealthy' | 'starting' | null;
	/** Output of the last failing health check. */
	healthOutput: string | null;
	/** Epoch milliseconds. */
	startedAt: number | null;
	finishedAt: number | null;
	exitCode: number | null;
	restartCount: number;
	restartPolicy: string;
	/** Ports the image or compose file declares or publishes; see `listening` for what is really open. */
	ports: ContainerPort[];
	/** Ports something in the container listens on, or null when that could not be read. */
	listening: ListeningPort[] | null;
	networks: Array<{ name: string; aliases: string[]; ip?: string }>;
	/** Routing, for nginx containers. */
	proxy: ProxyInfo | null;
	/** Connector details, for cloudflared containers. */
	tunnel: TunnelInfo | null;
	/** Request rate from the access log, for nginx containers. */
	requests: RequestStats | null;
	/** Attached to a public network; `publicAliases` are its names there. */
	public: boolean;
	publicAliases: string[];
	traffic: TrafficState;
	routesIn: InboundRoute[];
	/**
	 * Filesystems behind the container's volumes and bind-mounted folders, as the
	 * container sees them (inside the Docker VM on a Mac). Empty without
	 * mounts; null while stopped, before the first sample, or when `df` could not
	 * run in the image.
	 */
	disks: DiskUsage[] | null;
	/** CPU percentage (100 = one core), memory in bytes, process count: while running. */
	cpu: number | null;
	memory: number | null;
	pids: number | null;
	/** Recent CPU and memory samples for the sparklines; empty while stopped. */
	history: UsageHistory;
	/**
	 * `kubernetes` for a container in a k3s pod: Kubernetes keeps it running, so it
	 * can be restarted (its pod is replaced) but not stopped or started from Dock.
	 */
	runtime: 'docker' | 'kubernetes';
	/** Network throughput in bytes per second between the last two samples. */
	rxRate: number | null;
	txRate: number | null;
	/** An action Dock started that has not finished yet. */
	pending: 'starting' | 'stopping' | 'restarting' | null;
}

/** One blue/green or release slot of an app. */
export interface SlotGroup {
	/** Compose project, such as `scout-blue`. */
	id: string;
	/** `blue`, `green`, or a release id. */
	label: string;
	release: string | null;
	/** `live` serves traffic, `standby` is the previous upstream, `idle` runs unrouted, `stopped` has nothing running. */
	state: 'live' | 'standby' | 'idle' | 'stopped';
	containers: string[];
}

/** Containers of one app, split into the parts of a deployment. */
export interface AppGroup {
	id: string;
	name: string;
	/** Compose projects in this app. */
	projects: string[];
	/** Long-lived proxies and tunnels outside the slots. */
	routing: string[];
	slots: SlotGroup[];
	databases: string[];
	/** Everything else outside the slots: backups, single-container apps. */
	services: string[];
}

/** A container lifecycle event, from `docker events`. */
export interface HostActivity {
	/** Epoch milliseconds. */
	time: number;
	container: string;
	project: string | null;
	/** `start`, `stop`, `die`, `restart`, `health_status: unhealthy`, … */
	action: string;
	exitCode: number | null;
}

/** A k3s cluster found on a host. */
export interface KubernetesInfo {
	/** Kubelet version such as `v1.33.5+k3s1`; empty until the nodes are read. */
	version: string;
	nodes: number;
	cpus: number;
	memory: number;
	/** Why the cluster could not be read, with what to run to fix it. */
	error: string | null;
}

/** Live view of one host. */
export interface HostSnapshot {
	id: string;
	name: string;
	/** `ssh steve@mac-server` or `this machine`. */
	target: string;
	status: 'connecting' | 'online' | 'error';
	error: string | null;
	/** Epoch milliseconds of the last successful sample. */
	sampledAt: number | null;
	/** Round trip of the last sample, SSH included. */
	latencyMs: number | null;
	engine: { version: string; os: string; cpus: number; memory: number } | null;
	/**
	 * The k3s cluster on this machine, when there is one: version and node count,
	 * or why it could not be read. Its pods are listed with the containers.
	 */
	kubernetes: KubernetesInfo | null;
	/** The host's own disks: its system or data volume, home folder and Docker root. Null until sampled. */
	disks: DiskUsage[] | null;
	containers: ContainerSnapshot[];
	apps: AppGroup[];
	activity: HostActivity[];
}

/** Request body for adding a host. */
export interface AddHostRequest {
	name: string;
	ssh?: string;
}

/** Container actions the Dock can run. */
export type ContainerAction = 'start' | 'stop' | 'restart';

/** Events pushed to the client about hosts. */
export type HostEvent =
	| { type: 'hosts'; hosts: HostSnapshot[] }
	| { type: 'host'; host: HostSnapshot }
	| { type: 'host-removed'; id: string };
