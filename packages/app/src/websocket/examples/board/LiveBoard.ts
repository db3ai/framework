import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';
import { app } from '@db3.ai/app/server';
import { defineChannel, defineWebSocket } from '@db3.ai/app/websocket';
import { z } from 'zod';
import { boardSnapshotSchema, type BoardSnapshot } from './boardSnapshot';
import { SummarizeBoardJob } from './SummarizeBoardJob';

/** Application-owned example: a small shared board and its latest durable background activity. */
export class LiveBoard extends ActiveRecord {
	static override table = 'example_live_boards';
	static override requestFillable = [];

	/** Defines durable state. Register this model in the host's normal migration workflow. */
	static override fields(field: FieldBuilder) {
		return {
			id: field.ulid(), members: field.json<string[]>(),
			cards: field.json<BoardSnapshot['cards']>(),
			revision: field.integer({ required: true, default: 0 }),
			activity: field.json<BoardSnapshot['activity']>(),
		};
	}
	declare id: string;
	declare members: string[];
	declare cards: BoardSnapshot['cards'];
	declare revision: number;
	declare activity: BoardSnapshot['activity'];

	/** Checks fresh membership for HTTP reads/writes and each subscription or event delivery. */
	static async canAccess(id: string, userId: string): Promise<boolean> {
		const board = await this.where('id', id).first();
		return board?.members.includes(userId) ?? false;
	}

	/** Creates channel definitions to merge into the app's one authenticated endpoint. */
	static endpoint() {
		return defineWebSocket({ channels: [defineChannel('board:{boardId}', {
			/** A client-controlled board ID is never proof of access. */
			authorize: ({ userId, params }) => LiveBoard.canAccess(params.boardId!, userId),
		})] });
	}

	/** Returns an authorized projection; derive userId from the HTTP session, never its body. */
	static async snapshot(id: string, userId: string): Promise<BoardSnapshot> {
		const board = await this.where('id', id).first();
		if (!board?.members.includes(userId)) throw new Error('Board unavailable.');
		return board.snapshot();
	}

	/** Produces a bounded public projection, excluding membership and private model fields. */
	snapshot(): BoardSnapshot {
		return boardSnapshotSchema.parse({ id: this.id, revision: this.revision, cards: this.cards, activity: this.activity });
	}

	/** Serializes edits and rejects stale revisions rather than silently overwriting another user's move. */
	static async move(id: string, userId: string, input: unknown): Promise<BoardSnapshot> {
		const command = z.object({ cardId: z.string(), column: z.enum(['todo', 'doing', 'done']), revision: z.number().int().nonnegative() }).strict().parse(input);
		const snapshot = await app().db.transaction(async () => {
			const board = await this.where('id', id).forUpdate().first();
			if (!board?.members.includes(userId)) throw new Error('Board unavailable.');
			if (board.revision !== command.revision) throw new Error('Board changed; reload before saving.');
			if (!board.cards.some(card => card.id === command.cardId)) throw new Error('Card unavailable.');
			board.cards = board.cards.map(card => card.id === command.cardId ? { ...card, column: command.column } : card);
			board.revision++;
			await board.save();
			return board.snapshot();
		});
		await this.publishChanged(id);
		return snapshot;
	}

	/**
	 * Commits loading state and SQL queue dispatch together; duplicate active requests reuse the run.
	 * Call outside an outer transaction, with the database queue driver on the same database.
	 * A client retains requestId across a lost HTTP response; it is an idempotency key, not authority.
	 */
	static async startSummary(id: string, userId: string, requestId: string): Promise<BoardSnapshot> {
		z.string().uuid().parse(requestId);
		const snapshot = await app().db.transaction(async () => {
			const board = await this.where('id', id).forUpdate().first();
			if (!board?.members.includes(userId)) throw new Error('Board unavailable.');
			if (board.activity?.id === requestId || ['queued', 'running'].includes(board.activity?.status ?? '')) return board.snapshot();
			board.activity = { id: requestId, status: 'queued', result: null };
			board.revision++;
			await board.save();
			await app().queue.dispatch(new SummarizeBoardJob({ boardId: id, userId, runId: requestId }), { queue: 'boards', maxTries: 1 });
			return board.snapshot();
		});
		await this.publishChanged(id);
		return snapshot;
	}

	/** Emits a small post-commit invalidation. Transport failure must not make a saved edit look rolled back. */
	static async publishChanged(id: string): Promise<void> {
		try { await app().webSockets.channel(`board:${id}`).publish('changed', { boardId: id }); }
		catch (error) { app().log.error({ error, boardId: id }, 'Board saved but live notification failed'); }
	}
}
