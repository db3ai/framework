import { KnowledgeNote } from './KnowledgeNote';

/**
 * Saves allowed request fields under a workspace already authorized by the host.
 *
 * @param workspaceId - Trusted workspace identity, never taken from the payload.
 * @param input - Untrusted form data; only title and body are fillable.
 * @returns The persisted note, or rejects with RecordValidationError.
 */
export async function createWorkspaceNote(workspaceId: string, input: unknown): Promise<KnowledgeNote> {
	const note = new KnowledgeNote();
	note.setFromRequest(input);
	note.assign({ workspace: workspaceId });
	await note.save();
	return note;
}

/**
 * Reads a bounded list using logical model fields, not database column names.
 *
 * @param workspaceId - Workspace the caller is already allowed to read.
 * @returns Up to twenty notes, newest first with a stable primary-key tie-break.
 */
export async function listWorkspaceNotes(workspaceId: string): Promise<KnowledgeNote[]> {
	return KnowledgeNote.where('workspace', workspaceId)
		.orderBy('createdAt', 'desc')
		.orderBy('id', 'desc')
		.limit(20)
		.all();
}

/**
 * Updates a note only when it belongs to the caller's authorized workspace.
 *
 * @param workspaceId - Trusted workspace identity.
 * @param noteId - Note identity to look up within that workspace.
 * @param input - Untrusted editable fields; omitted values remain unchanged.
 * @returns The saved record; a missing or cross-workspace note is not found.
 */
export async function updateWorkspaceNote(workspaceId: string, noteId: string, input: unknown): Promise<KnowledgeNote> {
	const note = await KnowledgeNote.where({ workspace: workspaceId, id: noteId }).firstOrFail();
	note.setFromRequest(input);
	await note.save();
	return note;
}

/**
 * Permanently deletes a note within an already authorized workspace.
 *
 * @param workspaceId - Trusted workspace identity.
 * @param noteId - Note identity scoped to that workspace.
 * @returns The number of deleted rows; throws when the scoped record is absent.
 */
export async function deleteWorkspaceNote(workspaceId: string, noteId: string): Promise<number> {
	const note = await KnowledgeNote.where({ workspace: workspaceId, id: noteId }).firstOrFail();
	return note.delete();
}
