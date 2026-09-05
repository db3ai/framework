import { ActiveRecord } from '@db3.ai/app/db';
import { app } from '@db3.ai/app/server';
import { createWorkspaceNote } from './workspaceNotes';
import type { KnowledgeNote } from './KnowledgeNote';

/**
 * Saves a group of notes atomically using the active application's database.
 *
 * Records are constructed inside the transaction scope. An error rolls back
 * all writes; existing records bound to another connection are not rebound.
 *
 * @param workspaceId - Workspace the host has authorized for creation.
 * @param inputs - Note inputs; each goes through the same filling and validation.
 * @returns Persisted notes after the transaction commits successfully.
 */
export async function createNotesTogether(workspaceId: string, inputs: unknown[]): Promise<KnowledgeNote[]> {
	return app().db.knex.transaction(transaction => ActiveRecord.withDb(transaction, async () => {
		const notes: KnowledgeNote[] = [];
		for (const input of inputs) {
			notes.push(await createWorkspaceNote(workspaceId, input));
		}
		return notes;
	}));
}
