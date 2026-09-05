import { expect, it } from 'vitest';
import { runFieldNotes } from '../../examples/runFieldNotes';

it('persists field-owned values, scopes reads and hides deliberately selected encrypted data', async () => {
	const output = await runFieldNotes();
	expect(output).toEqual({ code: 'BRIEF-1', tags: ['SEO', 'Agency'], metadata: { client: { name: 'Ada' }, draft: true }, ownerProtected: true, ciphertextStored: true, omittedByDefault: true, decryptedOnRequest: true, hiddenFromJson: true, projectedCode: 'BRIEF-1', scopedCount: 1, invalidRejected: true, countUnchanged: true });
	expect(JSON.stringify(output)).not.toContain('synthetic-server-secret');
});
