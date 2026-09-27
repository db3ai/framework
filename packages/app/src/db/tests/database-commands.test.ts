import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { App, app } from '@db3.ai/app/server';
import { Cli } from '@db3.ai/app/cli';
import { ActiveRecord } from '@db3.ai/app/db';
import { databaseCommands, check } from '@db3.ai/app/db/commands';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';

/** Minimal real model used to exercise the command lifecycle against MariaDB. */
class CommandNote extends ActiveRecord.define({ table: 'command_notes', fields: field => ({ id: field.ulid({ primary: true }), title: field.string({ required: false }) }) }) {}

/** Deliberately unsafe replacement whose dropped title field requires review. */
class RemovedTitle extends ActiveRecord.define({ table: 'command_notes', fields: field => ({ id: field.ulid({ primary: true }) }) }) {}

/** Generates, applies and checks actual migrations, preserving source on blocked changes. */
it('database service commands own migration execution and failure exit statuses', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-db-commands-'));
	const database = await createGeneratedTestDatabase('commands');
	let model: typeof ActiveRecord = CommandNote;
	const messages: string[] = [];
	const errors: string[] = [];
	try {
		const runner = new Cli({
			createApp: () => new App({ directory: root, db: database.db, dbOptions: { syncColumns: false, migrations: { models: [model] } } }),
			commands: databaseCommands,
		}, { write: message => { messages.push(message); }, writeError: message => { errors.push(message); } });
		expect(await runner.run(['db:make-migration', 'initial'])).toBe(0);
		expect(await runner.run(['db:check'])).toBe(1);
		expect(await runner.run(['db:migrate'])).toBe(0);
		expect(await runner.run(['db:check'])).toBe(0);
		expect(await runner.run(['db:migrate'])).toBe(0);
		expect(JSON.parse(messages.at(-1)!).applied).toEqual([]);
		expect(() => app()).toThrow();
		const directApp = new App({ directory: root, db: database.db, dbOptions: { migrations: { models: [model] } } });
		try {
			expect(directApp.db.migrations).toBe(directApp.db.migrations);
			expect((await check()).matches).toBe(true);
			await directApp.db.transaction(async transaction => {
				expect((await transaction.migrations.check()).matches).toBe(true);
			});
			expect(app()).toBe(directApp);
		} finally { await directApp.close(); }
		const before = await readFile(join(root, 'server/database/schema.snapshot.json'), 'utf8');
		const files = await readdir(join(root, 'server/database/migrations'));
		expect(await readdir(root)).toEqual(['server']);
		model = RemovedTitle;
		expect(await runner.run(['db:make-migration', 'drop_title'])).toBe(1);
		expect(JSON.parse(messages.at(-1)!).blocked).toBe(true);
		expect(await readFile(join(root, 'server/database/schema.snapshot.json'), 'utf8')).toBe(before);
		expect(await readdir(join(root, 'server/database/migrations'))).toEqual(files);
		expect(await runner.run(['db:migrate', '--force'])).toBe(1);
		expect(errors).toHaveLength(1);
	} finally { await database.destroy(); await rm(root, { recursive: true, force: true }); }
}, 30_000);

/** Unconfigured applications receive an actionable service error without connecting to SQL. */
it('requires an explicit model registry without requiring path configuration', async () => {
	const application = new App();
	try { expect(() => application.db.migrations).toThrow('Configure dbOptions.migrations with { models }'); }
	finally { await application.close(); }
});
