import { WebSocketClient, type WebSocketClientOptions } from '@db3.ai/app/websocket/client';

/** A snapshot binding owned by one feature; stopping it must not close the shared socket. */
export interface SnapshotBinding { refresh(): Promise<void>; stop(): void; denied(): void }

/**
 * Owns one browser-tab connection and routes subscription acknowledgements to snapshot loaders.
 * Create once at app boot. Snapshot GETs use the app's existing authenticated HTTP client.
 * This is copyable application code, not automatic ORM broadcasting or a framework store API.
 */
export function createChannelSync(options: Omit<WebSocketClientOptions, 'onSubscribed' | 'onChannelDenied'>) {
	const bindings = new Map<string, Set<SnapshotBinding>>();
	const client = new WebSocketClient({ ...options,
		/** Reconcile only after the server has installed membership, including after reconnect. */
		onSubscribed: channel => { for (const binding of bindings.get(channel) ?? []) void binding.refresh(); },
		/** Clear feature data and fence any old HTTP response when membership is refused. */
		onChannelDenied: channel => { for (const binding of bindings.get(channel) ?? []) binding.denied(); },
	});
	return {
		client,
		/**
		 * Binds invalidations to an authoritative snapshot, coalescing concurrent refreshes.
		 * A change during a GET schedules another GET, so an older response cannot swallow it.
		 * load must validate HTTP status and payload; apply should reject older model revisions.
		 */
		watch<T>(channel: string, load: () => Promise<T>, apply: (value: T) => void, fail: (error: unknown) => void): SnapshotBinding {
			let active = true;
			let dirty = false;
			let pending: Promise<void> | undefined;
			let group = bindings.get(channel);
			if (!group) { group = new Set(); bindings.set(channel, group); }
			const binding: SnapshotBinding = {
				/** At most one HTTP read per binding is in flight; errors require explicit refresh or reconnect. */
				refresh() {
					if (!active) return Promise.resolve();
					dirty = true;
					return pending ??= (async () => {
						try {
							while (active && dirty) {
								dirty = false;
								try { const value = await Promise.resolve().then(load); if (active) apply(value); }
								catch (error) { if (active) fail(error); }
							}
						} finally { pending = undefined; }
					})();
				},
				/** Removes listeners and ignores late responses; the shared connection stays alive. */
				stop() {
					active = false;
					unsubscribe();
					group.delete(binding);
					if (!group.size) bindings.delete(channel);
				},
				/** Reports access loss after clearing the binding's ability to apply late responses. */
				denied() { binding.stop(); fail(new Error('Channel access denied.')); },
			};
			const unsubscribe = client.channel(channel).on('changed', () => { void binding.refresh(); });
			group.add(binding);
			// HTTP still provides initial state if the socket is unavailable. The subscription ACK refresh closes the race.
			void binding.refresh();
			return binding;
		},
		/** Dispose once on logout or app teardown, not when an individual route unmounts. */
		close() { for (const group of bindings.values()) for (const binding of group) binding.stop(); client.close(); },
	};
}
