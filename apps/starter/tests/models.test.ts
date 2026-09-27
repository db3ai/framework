import { expect, expectTypeOf, it } from 'vitest';
import { Note } from '../server/models/Note';
import { RoomAccess } from '../server/models/RoomAccess';
import { CollaborationRoom } from '../server/models/CollaborationRoom';
import { SocialOpportunity } from '../apps/social/server/models/SocialOpportunity';
import type { RoomContents } from '../server/collaboration/contracts';

it('infers note fields while preserving unsaved defaults, request guards and validation', async () => {
	const note = new Note({ owner: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
	expectTypeOf(note.title).toEqualTypeOf<string | null>();
	expectTypeOf(note.createdAt).toEqualTypeOf<Date | null>();
	expectTypeOf(note.updatedAt).toEqualTypeOf<Date | null>();
	expect(note.title).toBeNull();
	expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	expect(note.isPersisted()).toBe(false);
	note.setFromRequest({ owner: 'forged-owner', title: '  A note  ', body: 'Contents' });
	expect(note.owner).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
	expect(note.title).toBe('A note');
	expect(await note.validate()).toBe(true);
	note.title = '';
	expect(await note.validate()).toBe(false);
	expect(note.getFieldErrors('title').length).toBeGreaterThan(0);
});

it('infers room JSON and access fields without duplicate property declarations', async () => {
	const room = new CollaborationRoom({ name: 'lobby', contents: { messages: [], strokes: [] } });
	const access = new RoomAccess({ key: 'studio:member' });
	expectTypeOf(room.contents).toEqualTypeOf<RoomContents | null>();
	expectTypeOf(room.name).toEqualTypeOf<string | null>();
	expectTypeOf(access.key).toEqualTypeOf<string | null>();
	expect(room.toJSON()).toMatchObject({ name: 'lobby', contents: { messages: [], strokes: [] } });
	expect(await room.validate()).toBe(true);
	expect(await access.validate()).toBe(true);
	room.contents = null;
	expect(await room.validate()).toBe(false);
});

it('preserves social defaults and serialization on the inferred subclass', async () => {
	const opportunity = new SocialOpportunity({ owner: '01ARZ3NDEKTSV4RRFFQ69G5FAV', title: '  Discussion  ', url: 'https://example.test/topic', notes: 'Follow up' });
	expectTypeOf(opportunity.title).toEqualTypeOf<string | null>();
	expectTypeOf(opportunity.status).toEqualTypeOf<string | null>();
	expect(opportunity.status).toBe('saved');
	expect(opportunity.isPersisted()).toBe(false);
	expect(await opportunity.validate()).toBe(true);
	expect(opportunity.toJSON()).toMatchObject({ title: 'Discussion', status: 'saved', notes: 'Follow up' });
});
