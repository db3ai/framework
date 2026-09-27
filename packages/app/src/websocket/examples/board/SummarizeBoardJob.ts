import { QueueableJob } from '@db3.ai/app/queue';
import { app } from '@db3.ai/app/server';
import { z } from 'zod';
import { LiveBoard } from './LiveBoard';

/** Immutable identities persisted in the SQL queue; permissions are checked again by the worker. */
interface SummarizeBoardData extends Record<string, unknown> { boardId: string; userId: string; runId: string }

/** Server-owned work whose durable UI state outlives any browser connection. */
export class SummarizeBoardJob extends QueueableJob<SummarizeBoardData> {
	static readonly jobName = 'boards.summarize.v1';

	/** Validates new and rehydrated queue payloads. */
	constructor(data: SummarizeBoardData) {
		super(z.object({ boardId: z.string().min(1), userId: z.string().min(1), runId: z.string().uuid() }).parse(data));
	}

	/**
	 * Builds a deterministic summary. Replace computation with your slow server activity.
	 * Browser disconnect never cancels this job; a repeated attempt safely replaces the same result.
	 */
	async handle(): Promise<void> {
		const snapshot = await app().db.transaction(async () => {
			const board = await LiveBoard.where('id', this.data.boardId).forUpdate().firstOrFail();
			if (board.activity?.id !== this.data.runId || ['completed', 'failed'].includes(board.activity.status)) return null;
			if (!board.members.includes(this.data.userId)) throw new Error('Board access revoked.');
			board.activity = { ...board.activity, status: 'running' };
			board.revision++;
			await board.save();
			return board.snapshot();
		});
		if (!snapshot) return;
		await LiveBoard.publishChanged(this.data.boardId);
		const result = `${snapshot.cards.filter(card => card.column === 'done').length} of ${snapshot.cards.length} cards complete`;
		await this.#finish('completed', result);
	}

	/** Makes terminal failure visible after Queue persists its failed-job record. */
	override async onFinalFailure(): Promise<void> { await this.#finish('failed', null); }

	/** Fences an old attempt from overwriting a newer run and publishes only after commit. */
	async #finish(status: 'completed' | 'failed', result: string | null): Promise<void> {
		await app().db.transaction(async () => {
			const board = await LiveBoard.where('id', this.data.boardId).forUpdate().first();
			if (!board || board.activity?.id !== this.data.runId || ['completed', 'failed'].includes(board.activity.status)) return;
			board.activity = { id: this.data.runId, status, result };
			board.revision++;
			await board.save();
		});
		await LiveBoard.publishChanged(this.data.boardId);
	}
}
