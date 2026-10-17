import type { AddHostRequest, ContainerAction, HostDefinition, HostEvent, HostSnapshot } from '../../shared/hostContracts.js';
import type { HostStore } from './HostStore.js';
import { HostWatcher, type WatcherOptions } from './HostWatcher.js';

/** Listener for host events. */
export type HostListener = (event: HostEvent) => void;

const DEFAULTS: WatcherOptions = { fastEveryMs: 5000, slowEveryMs: 30000 };

/**
 * Watches every saved Docker host while someone is looking.
 *
 * Remote hosts are only sampled while a client holds a {@link retain} (an open
 * Dock window), so an idle Dock does not keep SSH sessions busy. Like {@link Dock},
 * this has no HTTP knowledge.
 */
export class HostMonitor {
	readonly #watchers = new Map<string, HostWatcher>();
	readonly #listeners = new Set<HostListener>();
	readonly #options: WatcherOptions;
	#retained = 0;
	#idleTimer: NodeJS.Timeout | null = null;

	/**
	 * @param store - Saved hosts.
	 * @param options - Sampling intervals and shell, for tests.
	 */
	constructor(readonly store: HostStore, options: Partial<WatcherOptions> = {}) {
		this.#options = { ...DEFAULTS, ...options };
	}

	/** Loads saved hosts. */
	async open(): Promise<void> {
		await this.store.load();
		for (const host of this.store.list()) this.#watch(host);
	}

	/** Every host's latest snapshot. */
	state(): HostSnapshot[] {
		return [...this.#watchers.values()].map(watcher => watcher.snapshot());
	}

	/**
	 * Subscribes to events.
	 *
	 * @param listener - Event callback.
	 * @returns Unsubscribe function.
	 */
	subscribe(listener: HostListener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * Keeps hosts sampled until the returned function is called. Sampling stops
	 * shortly after the last holder lets go, so a page reload does not reconnect.
	 *
	 * @returns Release function.
	 */
	retain(): () => void {
		this.#retained++;
		if (this.#idleTimer) clearTimeout(this.#idleTimer);
		this.#idleTimer = null;
		if (this.#retained === 1) for (const watcher of this.#watchers.values()) watcher.start();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#retained--;
			if (this.#retained > 0) return;
			this.#idleTimer = setTimeout(() => {
				for (const watcher of this.#watchers.values()) watcher.stop();
			}, 15000);
		};
	}

	/**
	 * @param request - Name and SSH destination.
	 * @returns The saved host.
	 */
	async addHost(request: AddHostRequest): Promise<HostDefinition> {
		const host = await this.store.add(request);
		const watcher = this.#watch(host);
		this.#broadcast({ type: 'host', host: watcher.snapshot() });
		if (this.#retained > 0) watcher.start();
		return host;
	}

	/**
	 * @param id - Host id.
	 */
	async removeHost(id: string): Promise<void> {
		await this.store.remove(id);
		this.#watchers.get(id)?.stop();
		this.#watchers.delete(id);
		this.#broadcast({ type: 'host-removed', id });
	}

	/**
	 * @param hostId - Host id.
	 * @param container - Container name.
	 * @param action - Start, stop or restart.
	 */
	async action(hostId: string, container: string, action: ContainerAction): Promise<void> {
		await this.#watcher(hostId).action(container, action);
	}

	/**
	 * Follows a container's logs; see {@link HostWatcher.logs}.
	 *
	 * @returns Stop function.
	 */
	logs(hostId: string, container: string, onData: (text: string) => void, onEnd: (message: string) => void, tail?: number): () => void {
		return this.#watcher(hostId).logs(container, onData, onEnd, tail);
	}

	/**
	 * Samples a host now.
	 *
	 * @param hostId - Host id.
	 */
	async refresh(hostId: string): Promise<void> {
		await this.#watcher(hostId).sample();
	}

	/** Stops all sampling and streams. */
	close(): void {
		if (this.#idleTimer) clearTimeout(this.#idleTimer);
		for (const watcher of this.#watchers.values()) watcher.stop();
	}

	#watcher(id: string): HostWatcher {
		this.store.get(id);
		return this.#watchers.get(id)!;
	}

	#watch(host: HostDefinition): HostWatcher {
		const watcher = new HostWatcher(host, this.#options, snapshot => this.#broadcast({ type: 'host', host: snapshot }));
		this.#watchers.set(host.id, watcher);
		return watcher;
	}

	#broadcast(event: HostEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}
