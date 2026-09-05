import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RecordNotFoundError, RecordValidationError } from '@db3.ai/app/db';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { App } from '@db3.ai/app/server';
import { KnowledgeNote } from '../../examples/KnowledgeNote';
import { createWorkspaceNote, deleteWorkspaceNote, listWorkspaceNotes, updateWorkspaceNote } from '../../examples/workspaceNotes';
import { runWorkspaceNotes } from '../../examples/runWorkspaceNotes';
import { createNotesTogether } from '../../examples/createNotesTogether';

describe('ActiveRecord documentation examples', () => {
	it('runs the complete disposable guide and matches its published output', async () => {
		const expected = JSON.parse(readFileSync(new URL('../../examples/outputs/workspace-notes.json', import.meta.url), 'utf8'));
		expect(await runWorkspaceNotes()).toEqual(expected);
	});
});

describe('workspace note behaviour through public framework imports', () => {
	let database: GeneratedTestDatabase;
	let application: App;
	const workspace = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
	const otherWorkspace = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

	beforeAll(async () => {
		database = await createGeneratedTestDatabase('notes_examples');
		application = new App({ db: database.db });
		await application.db.install(KnowledgeNote);
	});

	afterAll(async () => {
		await application?.close();
		await database?.destroy();
	});

	it('separates in-memory creation from persistence', async () => {
		const note = KnowledgeNote.create({ workspace, title: 'Unsaved note' });
		expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(note.isPersisted()).toBe(false);
		expect(await KnowledgeNote.findByPk(note.id)).toBeNull();
		await note.save();
		expect(note.isPersisted()).toBe(true);
		expect(await KnowledgeNote.findByPk(note.id)).toBeInstanceOf(KnowledgeNote);
	});

	it('guards workspace/id, queries logical fields and serializes dates', async () => {
		const note = await createWorkspaceNote(workspace, { id: 'ignored', workspace: otherWorkspace, title: '  Protected note  ' });
		expect(note.workspace).toBe(workspace);
		expect(note.title).toBe('Protected note');
		expect(note.id).not.toBe('ignored');
		expect((await listWorkspaceNotes(workspace)).some(row => row.id === note.id)).toBe(true);
		expect((await listWorkspaceNotes(otherWorkspace)).some(row => row.id === note.id)).toBe(false);
		const row = await KnowledgeNote.where({ workspace, id: note.id }).firstOrFail();
		expect(row.createdAt).toBeInstanceOf(Date);
		expect(typeof row.toJSON().createdAt).toBe('string');
	});

	it('rejects blank and oversized titles without inserting rows', async () => {
		const before = await KnowledgeNote.where('workspace', workspace).count();
		await expect(createWorkspaceNote(workspace, { title: ' ' })).rejects.toBeInstanceOf(RecordValidationError);
		await expect(createWorkspaceNote(workspace, { title: 'x'.repeat(121) })).rejects.toBeInstanceOf(RecordValidationError);
		expect(await KnowledgeNote.where('workspace', workspace).count()).toBe(before);
	});

	it('scopes edits/deletes and preserves omitted fields during updates', async () => {
		const note = await createWorkspaceNote(workspace, { title: 'Edit me', body: 'Keep me' });
		await expect(updateWorkspaceNote(otherWorkspace, note.id!, { title: 'Forbidden' })).rejects.toBeInstanceOf(RecordNotFoundError);
		await expect(deleteWorkspaceNote(otherWorkspace, note.id!)).rejects.toBeInstanceOf(RecordNotFoundError);
		const edited = await updateWorkspaceNote(workspace, note.id!, { title: 'Edited', workspace: otherWorkspace });
		expect(edited.body).toBe('Keep me');
		expect(edited.workspace).toBe(workspace);
		await expect(deleteWorkspaceNote(workspace, note.id!)).resolves.toBe(1);
		expect(await KnowledgeNote.findByPk(note.id)).toBeNull();
	});

	it('rolls back an earlier write when a later record fails validation', async () => {
		const before = await KnowledgeNote.where('workspace', workspace).count();
		await expect(createNotesTogether(workspace, [{ title: 'First' }, { title: '' }])).rejects.toBeInstanceOf(RecordValidationError);
		expect(await KnowledgeNote.where('workspace', workspace).count()).toBe(before);
	});
});
