import { pathToFileURL } from 'node:url';
import { RecordValidationError } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { Security } from '@db3.ai/app/security';
import { App } from '@db3.ai/app/server';
import { FieldNote } from './FieldNote';

/**
 * Verifies field conversion and encrypted storage in an isolated SQL database.
 *
 * Raw SQL below is deliberately limited to checking physical storage; normal
 * application reads use logical model fields. Only outcome booleans are printed
 * for secret values. The generated database and ephemeral key are disposable.
 *
 * @returns The observed conversion, output, query and validation outcomes.
 */
export async function runFieldNotes() {
	const database = await createGeneratedTestDatabase('field_notes');
	const application = new App({ db: database.db, config: { security: { key: Security.generateKey() } } });
	try {
		await application.db.install(FieldNote);
		const note = new FieldNote();
		note.setFromRequest({ code: '  brief-1  ', tags: [' SEO ', 'seo', 'Agency'], metadata: '{"client":{"name":"Ada"},"draft":true}', owner: 'wrong-owner', integration: { token: 'untrusted' } });
		note.assign({ owner: 'ada', integration: { token: 'synthetic-server-secret' } });
		await note.save();
		await FieldNote.create({ owner: 'grace', code: 'other' }).save();
		const found = await FieldNote.where({ owner: 'ada', id: note.id }).firstOrFail();
		const selected = await FieldNote.query().withField('integration').where({ owner: 'ada', id: note.id }).firstOrFail();
		const physical = await application.db.knex(FieldNote.table).where({ id: note.id }).first();
		const projected = await FieldNote.where('owner', 'ada').select('code').limit(1).all();
		const countBefore = await FieldNote.where('owner', 'ada').count();
		let invalidRejected = false;
		try { await FieldNote.create({ owner: 'ada', code: ' ', tags: ['one', 'two', 'three', 'four'] }).save(); } catch (error) { if (!(error instanceof RecordValidationError)) throw error; invalidRejected = true; }
		return {
			code: found.code, tags: found.tags, metadata: found.metadata,
			ownerProtected: found.owner === 'ada',
			ciphertextStored: String(physical.integration_secret).startsWith('security:1:aes-256-gcm:') && !String(physical.integration_secret).includes('synthetic-server-secret'),
			omittedByDefault: found.integration === null,
			decryptedOnRequest: selected.integration?.token === 'synthetic-server-secret',
			hiddenFromJson: !Object.hasOwn(selected.toJSON(), 'integration'),
			projectedCode: projected[0]?.code,
			scopedCount: countBefore,
			invalidRejected,
			countUnchanged: await FieldNote.where('owner', 'ada').count() === countBefore,
		};
	} finally {
		try { await application.close(); } finally { await database.destroy(); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runFieldNotes(), null, 2));
