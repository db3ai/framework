/**
 * Wire contracts shared by the Dock server and its browser client.
 * Everything here is plain JSON so it can cross HTTP and server-sent events.
 */

/** Broad role of a process, used for its icon, colour and add-process defaults. */
export type ProcessKind = 'api' | 'web' | 'queue' | 'scheduler' | 'script';

/** Lifecycle state of a supervised process. */
export type ProcessStatus = 'running' | 'stopping' | 'stopped' | 'crashed';

/** A process definition saved with its project, or added for this session only. */
export interface ProcessDefinition {
	/** Stable id, unique across all projects. */
	id: string;
	/** Display name, such as `api` or `queue · emails`. */
	name: string;
	/** npm script to run from the project folder. */
	script: string;
	/** Extra arguments passed after `--` to the script. */
	args: string[];
	/** Role used for presentation. */
	kind: ProcessKind;
	/** Whether the definition is saved in the Dock config, or lives only until Dock exits. */
	saved: boolean;
	/** Added automatically for a job found running outside Dock; removed when that job ends. */
	discovered?: boolean;
}

/** A project folder whose npm scripts the Dock runs. */
export interface ProjectDefinition {
	id: string;
	name: string;
	/** Absolute folder containing the project's package.json. */
	path: string;
	processes: ProcessDefinition[];
}

/** Live view of one process. */
export interface ProcessSnapshot {
	id: string;
	projectId: string;
	status: ProcessStatus;
	pid: number | null;
	/** Epoch milliseconds when the current run started. */
	startedAt: number | null;
	/** Exit code of the last run, when it has ended. */
	exitCode: number | null;
	/** Main port: announced in the output, else chosen from `ports`. */
	port: number | null;
	/** Every TCP port the process group listens on, from the last scan. */
	ports: number[];
	/** Summed CPU percentage of the process group, when sampled. */
	cpu: number | null;
	/** Summed resident memory in bytes of the process group, when sampled. */
	memory: number | null;
	/** Full command line as it is spawned. */
	command: string;
	/**
	 * The running job was started outside Dock (for example in a terminal). Dock
	 * can stop it but cannot read its output or send it input; restarting runs
	 * it inside Dock.
	 */
	external: boolean;
}

/**
 * A piece of raw terminal output from a process's pseudo-terminal, ANSI
 * escapes included, exactly as a terminal emulator should receive it.
 */
export interface OutputChunk {
	/** Monotonic sequence number within the process. */
	seq: number;
	data: string;
}

/** A local domain a reverse proxy (Caddy) forwards to a port, such as `https://local.growthscout.io` → 8000. */
export interface ProxyRoute {
	/** Origin plus any path prefix, without a trailing slash. */
	url: string;
	port: number;
}

/** Everything the client needs to draw the Dock. */
export interface DockState {
	projects: ProjectDefinition[];
	processes: ProcessSnapshot[];
	proxies: ProxyRoute[];
}

/** An npm script found in a project's package.json. */
export interface PackageScript {
	name: string;
	body: string;
	kind: ProcessKind;
}

/** Queue names and pools discovered in a project's source. */
export interface QueueTopology {
	queues: string[];
	pools: string[];
}

/** Request body for adding processes to a project. */
export interface AddProcessRequest {
	script: string;
	args: string[];
	name: string;
	kind?: ProcessKind;
	/** Number of identical processes to add. */
	count: number;
	/** Save the definitions to the Dock config. */
	save: boolean;
	/** Start the processes immediately. */
	start: boolean;
}

/** Events pushed to the client. */
export type DockEvent =
	| { type: 'state'; state: DockState }
	| { type: 'process'; process: ProcessSnapshot }
	| { type: 'output'; processId: string; chunks: OutputChunk[] }
	| { type: 'cleared'; processId: string }
	| { type: 'proxies'; proxies: ProxyRoute[] };
