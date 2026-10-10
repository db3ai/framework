import type { AddProcessRequest, DockEvent, DockState, OutputChunk, ProcessSnapshot, ProjectDefinition } from '../shared/contracts.js';
import { realpath } from 'node:fs/promises';

import type { ProxyRoute } from '../shared/contracts.js';
import { pickListeningPort } from '../shared/pickListeningPort.js';
import { ensurePtyHelper } from './processes/ensurePtyHelper.js';
import { scanProcesses, type ProcessScan } from './processes/listExternalProcesses.js';
import { readCaddyRoutes } from './proxies/readCaddyRoutes.js';
import { sampleProcessGroups } from './processes/sampleProcessGroups.js';
import { SupervisedProcess, type SupervisedProcessOptions } from './processes/SupervisedProcess.js';
import { ProjectStore } from './projects/ProjectStore.js';

/** Receives every Dock event. */
export type DockListener = (event: DockEvent) => void;

/** Dock construction options. */
export interface DockOptions {
	/** Spawn options for every process. */
	process?: SupervisedProcessOptions;
	/** Milliseconds between CPU/memory samples; 0 disables sampling. */
	sampleEveryMs?: number;
	/** Milliseconds between scans for jobs started outside Dock; 0 disables scanning. */
	discoverEveryMs?: number;
	/** Scans processes and listening ports; replaceable in tests. */
	scan?: () => Promise<ProcessScan>;
	/** Reads local domain → port routes (Caddy by default); replaceable in tests. */
	listProxies?: () => Promise<ProxyRoute[]>;
	/** Milliseconds between proxy config reads. */
	proxiesEveryMs?: number;
}

/**
 * The process manager behind the Dock UI.
 *
 * Owns one {@link SupervisedProcess} per definition in the {@link ProjectStore},
 * fans out lifecycle and output events to listeners, and samples resource use.
 * It has no HTTP knowledge, so it can be embedded in another host such as Studio.
 */
export class Dock {
	private readonly processes = new Map<string, SupervisedProcess>();
	private readonly listeners = new Set<DockListener>();
	private sampler: NodeJS.Timeout | null = null;
	private discoverer: NodeJS.Timeout | null = null;
	private discovering: Promise<void> | null = null;
	private readonly realPaths = new Map<string, string>();
	private proxies: ProxyRoute[] = [];
	private proxiesReadAt = 0;

	constructor(readonly store: ProjectStore, private readonly options: DockOptions = {}) {}

	/** Loads saved projects, finds jobs already running and begins sampling. Does not start any process. */
	async open(): Promise<void> {
		await ensurePtyHelper();
		await this.store.load();
		this.sync();
		const every = this.options.sampleEveryMs ?? 3000;
		if (every > 0) {
			this.sampler = setInterval(() => void this.sample(), every);
			this.sampler.unref();
		}
		const discoverEvery = this.options.discoverEveryMs ?? 4000;
		if (discoverEvery > 0) {
			await this.discover();
			this.discoverer = setInterval(() => void this.discover(), discoverEvery);
			this.discoverer.unref();
		}
	}

	/**
	 * Stops processes Dock started, plus sampling and scanning. Jobs that were
	 * found running outside Dock are left running: Dock did not start them.
	 */
	async close(): Promise<void> {
		if (this.sampler) clearInterval(this.sampler);
		if (this.discoverer) clearInterval(this.discoverer);
		this.sampler = null;
		this.discoverer = null;
		await this.discovering;
		await Promise.all([...this.processes.values()].filter(process => process.ownedPid !== null).map(process => process.stop()));
	}

	/**
	 * Matches `npm run` jobs started outside Dock to projects (by folder) and
	 * processes (by script name), and notices when they end. A job with no idle
	 * definition for its script, such as a second queue worker, gets a
	 * session-only entry that disappears when the job ends.
	 */
	discover(): Promise<void> {
		this.discovering ??= this.runDiscovery().finally(() => {
			this.discovering = null;
		});
		return this.discovering;
	}

	private async runDiscovery(): Promise<void> {
		const owned = new Set([...this.processes.values()].map(process => process.ownedPid).filter((pid): pid is number => pid !== null));
		const [scan] = await Promise.all([(this.options.scan ?? scanProcesses)(), this.refreshProxies()]);
		const jobs = scan.jobs.filter(job => !owned.has(job.pid));
		for (const process of this.processes.values()) {
			if (process.ownedPid !== null) {
				const ports = scan.ports.get(process.ownedPid) ?? [];
				process.setListening(ports, this.pickPort(ports));
			}
		}
		const byPid = new Map(jobs.map(job => [job.pid, job]));
		let changed = false;

		// Jobs already shown: update their port, or mark them ended.
		const attached = new Set<number>();
		for (const process of this.processes.values()) {
			const pid = process.externalPid;
			if (pid === null) continue;
			const job = byPid.get(pid);
			if (job) {
				attached.add(pid);
				process.setListening(job.ports, this.pickPort(job.ports));
			} else {
				process.externalEnded();
			}
		}

		for (const project of this.store.list()) {
			const projectPath = await this.realPath(project.path);
			for (const job of jobs) {
				if (attached.has(job.pid) || (await this.realPath(job.cwd)) !== projectPath) continue;
				let definition = project.processes.find(item => item.script === job.script && this.processes.get(item.id)?.isIdle);
				if (!definition) {
					definition = this.store.addDiscovered(project.id, job.script);
					project.processes.push(definition);
					this.sync();
					changed = true;
				}
				if (this.processes.get(definition.id)?.attach({ ...job, port: this.pickPort(job.ports) })) attached.add(job.pid);
			}
		}

		// Session-only entries for ended outside jobs go away.
		for (const project of this.store.list()) {
			for (const definition of project.processes) {
				if (definition.discovered && this.processes.get(definition.id)?.isIdle) {
					await this.store.removeProcess(definition.id);
					changed = true;
				}
			}
		}
		if (changed) this.syncAndBroadcast();
	}

	/** The port worth showing among a group's listening ports. */
	private pickPort(ports: number[] | undefined): number | null {
		return pickListeningPort(ports ?? [], new Set(this.proxies.map(route => route.port)));
	}

	/** Re-reads proxy routes at most every `proxiesEveryMs`, broadcasting changes. */
	private async refreshProxies(): Promise<void> {
		if (Date.now() - this.proxiesReadAt < (this.options.proxiesEveryMs ?? 10000)) return;
		this.proxiesReadAt = Date.now();
		const proxies = await (this.options.listProxies ?? (() => readCaddyRoutes(process.env.DOCK_CADDY_ADMIN)))();
		if (JSON.stringify(proxies) === JSON.stringify(this.proxies)) return;
		this.proxies = proxies;
		this.broadcast({ type: 'proxies', proxies });
	}

	private async realPath(path: string): Promise<string> {
		let resolved = this.realPaths.get(path);
		if (!resolved) {
			resolved = await realpath(path).catch(() => path);
			this.realPaths.set(path, resolved);
		}
		return resolved;
	}

	/**
	 * Subscribes to events.
	 *
	 * @param listener - Event callback.
	 * @returns Unsubscribe function.
	 */
	subscribe(listener: DockListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Projects with every process's live snapshot. */
	state(): DockState {
		return {
			projects: this.store.list(),
			processes: [...this.processes.values()].map(process => process.snapshot()),
			proxies: this.proxies,
		};
	}

	/**
	 * Adds a project folder.
	 *
	 * @param path - Folder with package.json.
	 * @param name - Optional display name.
	 * @returns The project.
	 */
	async addProject(path: string, name?: string): Promise<ProjectDefinition> {
		const project = await this.store.addProject(path, name);
		this.syncAndBroadcast();
		await this.discover();
		return this.store.get(project.id);
	}

	/**
	 * Stops the processes Dock started for a project and removes it. Jobs found
	 * running outside Dock keep running.
	 *
	 * @param id - Project id.
	 */
	async removeProject(id: string): Promise<void> {
		const project = this.store.get(id);
		await Promise.all(project.processes.map(definition => this.processes.get(definition.id)).filter(process => process?.ownedPid != null).map(process => process!.stop()));
		await this.store.removeProject(id);
		this.syncAndBroadcast();
	}

	/**
	 * Adds processes to a project and optionally starts them.
	 *
	 * @param projectId - Project id.
	 * @param request - What to add.
	 * @returns Snapshots of the new processes.
	 */
	async addProcesses(projectId: string, request: AddProcessRequest): Promise<ProcessSnapshot[]> {
		const added = await this.store.addProcesses(projectId, request);
		this.syncAndBroadcast();
		if (request.start) for (const definition of added) this.process(definition.id).start();
		return added.map(definition => this.process(definition.id).snapshot());
	}

	/**
	 * Stops (if Dock started it) and removes a process definition.
	 *
	 * @param processId - Process id.
	 */
	async removeProcess(processId: string): Promise<void> {
		const process = this.process(processId);
		if (process.ownedPid !== null) await process.stop();
		await this.store.removeProcess(processId);
		this.syncAndBroadcast();
	}

	/** @param processId - Process to start. */
	start(processId: string): void {
		this.process(processId).start();
	}

	/** @param processId - Process to stop. */
	stop(processId: string): Promise<void> {
		return this.process(processId).stop();
	}

	/** @param processId - Process to restart. */
	restart(processId: string): Promise<void> {
		return this.process(processId).restart();
	}

	/**
	 * Applies an action to every process in a project.
	 *
	 * @param projectId - Project id.
	 * @param action - `start` skips running processes; `restart` starts stopped ones too.
	 */
	async projectAction(projectId: string, action: 'start' | 'stop' | 'restart'): Promise<void> {
		const project = this.store.get(projectId);
		const targets = project.processes.map(definition => this.process(definition.id));
		if (action === 'start') targets.forEach(process => process.start());
		else if (action === 'stop') await Promise.all(targets.map(process => process.stop()));
		else await Promise.all(targets.map(process => process.restart()));
	}

	/**
	 * Sends keystrokes to a process's terminal.
	 *
	 * @param processId - Process id.
	 * @param data - Raw input, as a terminal emulator produces it.
	 */
	write(processId: string, data: string): void {
		this.process(processId).write(data);
	}

	/**
	 * Sets a process's terminal size.
	 *
	 * @param processId - Process id.
	 * @param cols - Columns.
	 * @param rows - Rows.
	 */
	resize(processId: string, cols: number, rows: number): void {
		this.process(processId).resize(cols, rows);
	}

	/**
	 * Clears a process's scrollback.
	 *
	 * @param processId - Process id.
	 */
	clear(processId: string): void {
		this.process(processId).clearOutput();
		this.broadcast({ type: 'cleared', processId });
	}

	/**
	 * Retained output for a process.
	 *
	 * @param processId - Process id.
	 * @param afterSeq - Only chunks after this sequence number.
	 * @returns Raw terminal chunks in order.
	 */
	output(processId: string, afterSeq = 0): OutputChunk[] {
		return this.process(processId).output.since(afterSeq);
	}

	private process(id: string): SupervisedProcess {
		const process = this.processes.get(id);
		if (!process) this.store.findProcess(id);
		return process ?? this.processes.get(id)!;
	}

	/** Creates supervisors for new definitions and drops removed ones. */
	private sync(): void {
		const seen = new Set<string>();
		for (const project of this.store.list()) {
			for (const definition of project.processes) {
				seen.add(definition.id);
				const existing = this.processes.get(definition.id);
				if (existing) {
					existing.update(definition);
					continue;
				}
				this.processes.set(definition.id, new SupervisedProcess(project.id, definition, project.path, {
					change: snapshot => this.broadcast({ type: 'process', process: snapshot }),
					output: (processId, chunks) => this.broadcast({ type: 'output', processId, chunks }),
				}, this.options.process));
			}
		}
		for (const [id, process] of this.processes) {
			if (!seen.has(id)) {
				if (process.ownedPid !== null) void process.stop();
				this.processes.delete(id);
			}
		}
	}

	private syncAndBroadcast(): void {
		this.sync();
		this.broadcast({ type: 'state', state: this.state() });
	}

	private broadcast(event: DockEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// A failing listener must not break supervision.
			}
		}
	}

	private async sample(): Promise<void> {
		const running = [...this.processes.values()].filter(process => process.isRunning && process.pid);
		if (!running.length) return;
		const usage = await sampleProcessGroups(running.map(process => process.pid!));
		for (const process of running) {
			const group = usage.get(process.pid!);
			process.setStats(group?.cpu ?? null, group?.memory ?? null);
		}
	}
}
