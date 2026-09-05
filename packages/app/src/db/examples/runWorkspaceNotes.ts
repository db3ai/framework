import { pathToFileURL } from 'node:url';
import { RecordValidationError } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { App } from '@db3.ai/app/server';
import { createNotesTogether } from './createNotesTogether';
import { KnowledgeNote } from './KnowledgeNote';
import { createWorkspaceNote, deleteWorkspaceNote, listWorkspaceNotes, updateWorkspaceNote } from './workspaceNotes';

/** Observable, deterministic outcomes from the disposable notes walkthrough. */
export interface WorkspaceNotesOutcome {
	/** Trimmed title read back through the model query. */
	title: string | null;
	/** Number of notes visible in the authorized workspace. */
	visibleNotes: number;
	/** Whether request filling refused a payload-supplied ownership change. */
	workspaceProtected: boolean;
	/** Whether transport conversion rendered the timestamp as a string. */
	jsonTimestamp: boolean;
	/** Validation codes returned for a blank required title. */
	validationCodes: string[];
	/** Whether a failed transaction left no new rows behind. */
	rollbackPreservedCount: boolean;
	/** Rows remaining after deleting the original workspace note. */
	remainingNotes: number;
}

/**
 * Runs the guide against a newly created database and removes it afterwards.
 *
 * Requires a local SQL account allowed to create/drop db3_app_test_* databases.
 * Database.install is deliberately used only inside this disposable lab.
 * Normal applications use reviewed migrations instead of boot-time schema work.
 *
 * @returns Actual database, validation and transport outcomes for the guide.
 */
export async function runWorkspaceNotes(): Promise<WorkspaceNotesOutcome> {
	const database = await createGeneratedTestDatabase('notes_guide');
	const application = new App({ db: database.db });

	try {
		await application.db.install(KnowledgeNote);
		const workspace = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
		const otherWorkspace = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
		const note = await createWorkspaceNote(workspace, { title: '  Client brief  ', body: 'Prepare the proposal.', workspace: otherWorkspace });
		await createWorkspaceNote(otherWorkspace, { title: 'Another client' });
		const notes = await listWorkspaceNotes(workspace);
		const updated = await updateWorkspaceNote(workspace, note.id!, { body: 'Review the brief, then prepare the proposal.' });
		const validationCodes: string[] = [];

		try {
			await createWorkspaceNote(workspace, { title: '   ' });
		} catch (error) {
			if (!(error instanceof RecordValidationError)) throw error;
			validationCodes.push(...error.errors.flatMap(field => field.code ? [field.code] : []));
		}

		const before = await KnowledgeNote.where('workspace', workspace).count();
		try {
			await createNotesTogether(workspace, [{ title: 'This note must roll back' }, { title: '' }]);
		} catch (error) {
			if (!(error instanceof RecordValidationError)) throw error;
		}
		const after = await KnowledgeNote.where('workspace', workspace).count();
		await deleteWorkspaceNote(workspace, note.id!);

		return {
			title: notes[0]?.title ?? null,
			visibleNotes: notes.length,
			workspaceProtected: updated.workspace === workspace,
			jsonTimestamp: typeof updated.toJSON().createdAt === 'string',
			validationCodes,
			rollbackPreservedCount: before === after,
			remainingNotes: await KnowledgeNote.where('workspace', workspace).count(),
		};
	} finally {
		try {
			await application.close();
		} finally {
			await database.destroy();
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	console.log(JSON.stringify(await runWorkspaceNotes(), null, 2));
}
