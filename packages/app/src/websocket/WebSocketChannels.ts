import type { WebSocketContext, WebSocketChannelDefinition } from './contracts';

/** Local fan-out for trusted server memberships and authorized browser subscriptions. */
export class WebSocketChannels {
	readonly #subscriptions = new Map<string, Map<string, { context: WebSocketContext<any>; definition: WebSocketChannelDefinition; params: Record<string, string>; leave: () => void }>>();
	readonly #counts = new Map<string, number>();
	readonly #channels = new Map<string, Map<string, { context: WebSocketContext<any>; leave: () => void }>>();

	/** Joins an already-authorized connection and automatically leaves when its signal aborts. */
	join(name: string, context: WebSocketContext<any>): () => void {
		if (context.signal.aborted) return () => {};
		let members = this.#channels.get(name);
		if (!members) { members = new Map(); this.#channels.set(name, members); }
		const existing = members.get(context.id);
		if (existing) return existing.leave;
		/** Removes only this membership and releases its abort listener. */
		const leave = () => {
			if (members.get(context.id)?.context === context) members.delete(context.id);
			if (!members.size && this.#channels.get(name) === members) this.#channels.delete(name);
			context.signal.removeEventListener('abort', leave);
		};
		context.signal.addEventListener('abort', leave, { once: true });
		members.set(context.id, { context, leave });
		return leave;
	}

	/** Sends JSON to current local members. Returns accepted transport sends, never durable delivery. */
	async publish(name: string, data: unknown): Promise<number> {
		const results = await Promise.all([...this.#channels.get(name)?.values() ?? []].map(member => member.context.send(data)));
		return results.filter(Boolean).length;
	}

	/**
	 * Handles the reserved subscription protocol. Unknown channels and denied access reveal no payload.
	 * @returns Whether this was a framework subscription command.
	 */
	async handle(definitions: readonly WebSocketChannelDefinition[], context: WebSocketContext<any>, data: unknown): Promise<boolean> {
		if (!data || typeof data !== 'object' || !('type' in data) || !['channel.subscribe', 'channel.unsubscribe'].includes(String(data.type))) return false;
		const name = 'channel' in data ? data.channel : null;
		if (typeof name !== 'string' || name.length > 256 || !/^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)*$/.test(name)) { context.close(); return true; }
		const existing = this.#subscriptions.get(name)?.get(context.id);
		if (data.type === 'channel.unsubscribe') { existing?.leave(); return true; }
		const matches = definitions.map(definition => ({ definition, params: matchChannel(definition.pattern, name) })).filter(match => match.params !== null);
		const match = matches.length === 1 ? matches[0] : undefined;
		if (!context.user || !context.userId || !match || !await match.definition.authorize({ ...context, userId: context.userId, channel: name, params: match.params! })) {
			existing?.leave();
			await context.send({ type: 'channel.denied', channel: name });
			return true;
		}
		if (context.signal.aborted) return true;
		if (!existing) {
			if ((this.#counts.get(context.id) ?? 0) >= 128) { await context.send({ type: 'channel.denied', channel: name }); return true; }
			let members = this.#subscriptions.get(name);
			if (!members) { members = new Map(); this.#subscriptions.set(name, members); }
			/** Removes this connection's subscription exactly once, including during in-flight authorization. */
			const leave = () => {
				if (!members.delete(context.id)) return;
				if (!members.size) this.#subscriptions.delete(name);
				const count = (this.#counts.get(context.id) ?? 1) - 1;
				if (count) this.#counts.set(context.id, count); else this.#counts.delete(context.id);
				context.signal.removeEventListener('abort', leave);
			};
			members.set(context.id, { context, definition: match.definition, params: match.params!, leave });
			this.#counts.set(context.id, (this.#counts.get(context.id) ?? 0) + 1);
			context.signal.addEventListener('abort', leave, { once: true });
		}
		await context.send({ type: 'channel.subscribed', channel: name });
		return true;
	}

	/** Publishes a named event only to current authorized resource subscribers in this process. */
	async publishEvent(name: string, event: string, data: unknown): Promise<number> {
		if (!event || event.length > 256) throw new Error('Invalid channel event.');
		const members = this.#subscriptions.get(name);
		const results = await Promise.all([...members?.values() ?? []].map(member => member.context.send({ type: 'channel.event', channel: name, event, data }, async context => {
			if (members?.get(context.id) !== member) return false;
			if (!context.user || !context.userId || !await member.definition.authorize({ ...context, userId: context.userId, channel: name, params: member.params })) { member.leave(); return false; }
			return members?.get(context.id) === member;
		})));
		return results.filter(Boolean).length;
	}

	/** Drops local memberships during application shutdown. */
	clear(): void { for (const members of this.#subscriptions.values()) for (const member of members.values()) member.leave(); for (const members of this.#channels.values()) for (const member of members.values()) member.leave(); }
}

/** Matches whole colon-delimited segments; parameter values never include separators. */
function matchChannel(pattern: string, name: string): Record<string, string> | null {
	const expected = pattern.split(':');
	const actual = name.split(':');
	if (expected.length !== actual.length) return null;
	const params: Record<string, string> = Object.create(null);
	for (let index = 0; index < expected.length; index++) {
		const segment = expected[index]!;
		if (/^\{[a-zA-Z][a-zA-Z0-9_]*\}$/.test(segment)) params[segment.slice(1, -1)] = actual[index]!;
		else if (segment !== actual[index]) return null;
	}
	return params;
}
