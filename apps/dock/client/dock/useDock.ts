import { computed, onScopeDispose, reactive, ref, shallowRef } from 'vue';

import type { CreateAppRequest, DockEvent, GitBranch, OutputChunk, ProcessSnapshot, ProjectDefinition, ProxyRoute } from '../../shared/contracts.js';
import type { AddHostRequest, ContainerAction, HostEvent, HostSnapshot } from '../../shared/hostContracts.js';
import { portLink, type PortLink } from '../../shared/portLink.js';
import { dockApi } from '../api.js';
import { useTerminalSocket } from '../terminal/useTerminalSocket.js';
import { mergeChunks } from './mergeChunks.js';

/**
 * Live Dock state from the server's event stream, plus the actions that change it.
 *
 * Opens one `EventSource` for its owning scope, reconnecting automatically, and
 * closes it when the scope is disposed. Output for a process is fetched the first
 * time it is requested and then kept current from events.
 */
export function useDock() {
	const projects = shallowRef<ProjectDefinition[]>([]);
	const proxies = shallowRef<ProxyRoute[]>([]);
	const branches = shallowRef<Record<string, GitBranch | null>>({});
	/** Docker hosts, in saved order; each replaced whole when it changes. */
	const hosts = shallowRef<HostSnapshot[]>([]);
	const snapshots = reactive(new Map<string, ProcessSnapshot>());
	const output = reactive(new Map<string, OutputChunk[]>());
	const terminal = useTerminalSocket();
	const connected = ref(false);
	const loaded = ref(false);
	const error = ref<string | null>(null);
	const requested = new Set<string>();

	const source = new EventSource('/api/events');
	source.onopen = () => {
		connected.value = true;
	};
	source.onerror = () => {
		connected.value = false;
	};
	source.onmessage = message => apply(JSON.parse(message.data) as DockEvent | HostEvent);
	onScopeDispose(() => source.close());

	function apply(event: DockEvent | HostEvent): void {
		if (event.type === 'hosts') {
			hosts.value = event.hosts;
		} else if (event.type === 'host') {
			const index = hosts.value.findIndex(host => host.id === event.host.id);
			hosts.value = index < 0 ? [...hosts.value, event.host] : hosts.value.map((host, at) => (at === index ? event.host : host));
		} else if (event.type === 'host-removed') {
			hosts.value = hosts.value.filter(host => host.id !== event.id);
		} else if (event.type === 'state') {
			projects.value = event.state.projects;
			proxies.value = event.state.proxies ?? [];
			branches.value = event.state.branches ?? {};
			const ids = new Set(event.state.processes.map(process => process.id));
			for (const id of [...snapshots.keys()]) if (!ids.has(id)) snapshots.delete(id);
			for (const process of event.state.processes) snapshots.set(process.id, process);
			loaded.value = true;
			// Lines may have been missed while disconnected; refetch what is on screen.
			for (const id of requested) void fetchOutput(id);
		} else if (event.type === 'process') {
			snapshots.set(event.process.id, event.process);
		} else if (event.type === 'output') {
			output.set(event.processId, mergeChunks(output.get(event.processId) ?? [], event.chunks));
		} else if (event.type === 'cleared') {
			output.set(event.processId, []);
		} else if (event.type === 'proxies') {
			proxies.value = event.proxies;
		} else if (event.type === 'branches') {
			branches.value = event.branches;
		}
	}

	async function fetchOutput(id: string): Promise<void> {
		try {
			const { chunks } = await dockApi.output(id);
			output.set(id, mergeChunks(output.get(id) ?? [], chunks));
		} catch {
			// The process may have been removed; the next state event drops it.
		}
	}

	/**
	 * Loads a process's scrollback the first time it is shown; later lines arrive as events.
	 *
	 * @param id - Process id.
	 */
	function loadOutput(id: string): void {
		if (requested.has(id)) return;
		requested.add(id);
		void fetchOutput(id);
	}

	/**
	 * @param id - Process id.
	 * @returns Raw terminal chunks held so far (empty until loaded).
	 */
	function chunksOf(id: string): OutputChunk[] {
		return output.get(id) ?? [];
	}

	/** Runs an action and records its error message for display. */
	async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
		error.value = null;
		try {
			return await action();
		} catch (failure) {
			error.value = (failure as Error).message;
			return undefined;
		}
	}

	/**
	 * @param port - Listening port.
	 * @returns The local domain for the port when a proxy maps one, else localhost.
	 */
	function linkFor(port: number): PortLink {
		return portLink(port, proxies.value);
	}

	/**
	 * @param projectId - Project id.
	 * @returns The project's current git branch, or `null` when it is not in a git repository (or not read yet).
	 */
	function branchOf(projectId: string): GitBranch | null {
		return branches.value[projectId] ?? null;
	}

	const runningCount = computed(() => [...snapshots.values()].filter(process => process.status === 'running').length);
	const processCount = computed(() => projects.value.reduce((total, project) => total + project.processes.length, 0));

	return {
		projects,
		hosts,
		snapshots,
		connected,
		loaded,
		error,
		runningCount,
		processCount,
		loadOutput,
		linkFor,
		branchOf,
		chunksOf,
		clearError: () => {
			error.value = null;
		},
		start: (id: string) => run(() => dockApi.processAction(id, 'start')),
		stop: (id: string) => run(() => dockApi.processAction(id, 'stop')),
		restart: (id: string) => run(() => dockApi.processAction(id, 'restart')),
		clear: (id: string) => run(() => dockApi.processAction(id, 'clear')),
		remove: (id: string) => run(() => dockApi.removeProcess(id)),
		/** Sends keystrokes to a process's terminal. */
		input: terminal.input,
		/** Reports a pane's terminal size to its process. */
		resize: terminal.resize,
		projectAction: (id: string, action: 'start' | 'stop' | 'restart' | 'open-editor') => run(() => dockApi.projectAction(id, action)),
		addProject: (path: string, name?: string) => run(() => dockApi.addProject(path, name)),
		createApp: (body: CreateAppRequest) => run(() => dockApi.createApp(body)),
		removeProject: (id: string) => run(() => dockApi.removeProject(id)),
		addHost: (body: AddHostRequest) => run(() => dockApi.addHost(body)),
		removeHost: (id: string) => run(() => dockApi.removeHost(id)),
		refreshHost: (id: string) => run(() => dockApi.refreshHost(id)),
		containerAction: (hostId: string, name: string, action: ContainerAction) => run(() => dockApi.containerAction(hostId, name, action)),
	};
}

/** The object returned by {@link useDock}. */
export type DockStore = ReturnType<typeof useDock>;
