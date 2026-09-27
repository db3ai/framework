import { randomUUID } from 'node:crypto';
import type { App } from '@db3.ai/app';
import { defineWebSocket, type WebSocketContext } from '@db3.ai/app/websocket';
import { z } from 'zod';
import { CollaborationRoom } from '../models/CollaborationRoom';
import { RoomAccess } from '../models/RoomAccess';
import type { Participant } from './contracts';

const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict();
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
const command = z.discriminatedUnion('type', [
	z.object({ type: z.literal('profile'), name: z.string().trim().min(1).max(32), color }).strict(),
	z.object({ type: z.literal('cursor'), point: point.nullable() }).strict(),
	z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(500) }).strict(),
	z.object({ type: z.literal('stroke'), color, points: z.array(point).min(2).max(200) }).strict(),
]);

/** Controller actions own room policy and state; the framework only transports JSON. */
export class RoomController {
	readonly #application: App;
	readonly #room: 'lobby' | 'members' | 'studio';
	#participants = new Map<string, Participant>();
	#rates = new Map<string, { at: number; count: number }>();
	#work: Promise<unknown> = Promise.resolve();
	/** Creates one process-local room coordinator. */
	constructor(application: App, room: 'lobby' | 'members' | 'studio') { this.#application = application; this.#room = room; }
	/** Builds a public, authenticated, or explicitly gated endpoint. */
	endpoint() {
		const actions = {
			/** Rejects unknown commands, forged attribution and out-of-range coordinates. */
			parse: (data: unknown) => command.parse(data),
			/** Orders initial history with changes made by other room members. */
			open: (context: WebSocketContext<any>) => this.#serial(() => this.#open(context)),
			/** Serializes mutations across all connections in this local room. */
			message: (context: WebSocketContext<any>, data: z.infer<typeof command>) => this.#serial(() => this.#message(context, data)),
		};
		if (this.#room === 'lobby') return defineWebSocket({ auth: 'public', ...actions });
		return defineWebSocket({ ...actions, authorize: async context => this.#room !== 'studio' || !!await RoomAccess.where('key', `studio:${context.userId}`).first() });
	}
	/** Orders joins and committed changes so initial history cannot miss an intervening write. */
	#serial<T>(action: () => Promise<T>): Promise<T> {
		const next = this.#work.then(action);
		this.#work = next.catch(() => undefined);
		return next;
	}
	/** Publishes only to server-approved members of this room. */
	#publish(data: unknown) { return this.#application.webSockets.channels.publish(`room:${this.#room}`, data); }
	/** Broadcasts tab-level presence, excluding users from other rooms. */
	async #presence() { await this.#publish({ type: 'presence', participants: [...this.#participants.values()] }); }
	/** Loads bounded durable history before joining the live channel. */
	async #open(context: WebSocketContext<any>) {
		let record = await CollaborationRoom.where('name', this.#room).first();
		if (!record) { record = CollaborationRoom.create({ name: this.#room, contents: { strokes: [], messages: [] } }); await record.save(); }
		const contents = record.contents;
		if (!contents) throw new Error('Stored collaboration room is missing its contents.');
		if (context.signal.aborted) return;
		const member: Participant = { id: context.id, userId: context.userId, name: context.user?.name || `Guest ${context.id.slice(0, 4)}`, color: '#6366f1', cursor: null };
		this.#participants.set(context.id, member);
		context.signal.addEventListener('abort', () => {
			this.#participants.delete(context.id);
			this.#rates.delete(context.id);
			void this.#serial(async () => { await this.#publish({ type: 'left', name: member.name }); await this.#presence(); }).catch(() => undefined);
		}, { once: true });
		await context.send({ type: 'history-start', id: context.id, messages: [] });
		for (const message of contents.messages) await context.send({ type: 'chat', message });
		for (const stroke of contents.strokes) await context.send({ type: 'stroke', stroke });
		await context.send({ type: 'history-end' });
		if (context.signal.aborted) return;
		this.#application.webSockets.channels.join(`room:${this.#room}`, context);
		await this.#publish({ type: 'joined', name: member.name });
		await this.#presence();
	}
	/** Validates rate, attributes identity server-side, and publishes only committed edits. */
	async #message(context: WebSocketContext<any>, data: z.infer<typeof command>) {
		const member = this.#participants.get(context.id);
		if (!member || context.signal.aborted) return;
		const rate = this.#rates.get(context.id);
		const current = rate && Date.now() - rate.at < 1000 ? rate : { at: Date.now(), count: 0 };
		this.#rates.set(context.id, current);
		if (++current.count > 30) { context.close(); return; }
		if (data.type === 'profile') { member.name = context.user?.name || data.name; member.color = data.color; await this.#presence(); return; }
		if (data.type === 'cursor') { member.cursor = data.point; await this.#publish({ type: 'cursor', id: context.id, point: data.point }); return; }
		const record = await CollaborationRoom.where('name', this.#room).firstOrFail();
		const contents = record.contents;
		if (!contents) throw new Error('Stored collaboration room is missing its contents.');
		if (data.type === 'chat') {
			const message = { id: randomUUID(), author: member.name, text: data.text, at: new Date().toISOString() };
			record.contents = { ...contents, messages: [...contents.messages, message].slice(-50) };
			await record.save();
			await this.#publish({ type: 'chat', message });
		} else {
			if (contents.strokes.length >= 500) { await context.send({ type: 'error', message: 'This demo board has reached its 500-stroke limit.' }); return; }
			const stroke = { id: randomUUID(), author: member.name, color: data.color, points: data.points };
			record.contents = { ...contents, strokes: [...contents.strokes, stroke] };
			await record.save();
			await this.#publish({ type: 'stroke', stroke });
		}
	}
}
