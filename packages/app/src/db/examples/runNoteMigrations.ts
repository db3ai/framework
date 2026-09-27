import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ActiveRecord, DatabaseMigrationManager, mariaDbDialect } from '@db3.ai/app/db';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';

/** Initial version of a disposable note table, before a schema change. */
class InitialNote extends ActiveRecord.define({
	table: 'migration_guide_notes',
	/** Defines the initial committed schema. */
	fields(field) { return { id: field.ulid(), title: field.string({ required: true }) }; },
}) {}

/** Unsafe proposal: existing rows have no value for this required column. */
class RequiredCategoryNote extends InitialNote.define({
	/** Adds a required field without pretending existing data has a value. */
	fields(field) { return { category: field.string({ required: true }) }; },
}) {}

/** Repaired additive change that can be deployed before backfilling existing rows. */
class OptionalCategoryNote extends InitialNote.define({
	/** Adds a nullable field safe for the existing note. */
	fields(field) { return { category: field.string() }; },
}) {}

/**
 * Generates, applies and checks migrations against an owned disposable database.
 *
 * The three model classes represent successive source revisions, not models an
 * application should register together. Production apps commit reviewed files;
 * this lab discards only its temporary migration directory and test database.
 *
 * @returns Generation, blocked-change, recovery and persisted-data outcomes.
 */
export async function runNoteMigrations() {
	const database = await createGeneratedTestDatabase('migrations_guide');
	const directory = await mkdtemp(join(tmpdir(), 'db3-migrations-guide-'));
	const snapshotFile = join(directory, 'schema.snapshot.json');
	const migrationsDirectory = join(directory, 'migrations');
	/** Creates the manager for one simulated model-source revision. */
	const managerFor = (Model: typeof InitialNote, second: number) => new DatabaseMigrationManager({ db: database.db, models: [Model], dialect: mariaDbDialect, migrationsDirectory, snapshotFile, environment: 'test', now: () => new Date(Date.UTC(2026, 8, 5, 12, 0, second)) });
	try {
		const initial = managerFor(InitialNote, 0);
		const first = await initial.makeMigration({ name: 'initial_notes' });
		await initial.migrate();
		await ActiveRecord.withDb(database.db, () => InitialNote.create({ title: 'Keep this note' }).save());
		const snapshotBefore = await readFile(snapshotFile, 'utf8');
		const filesBefore = await readdir(migrationsDirectory);
		const unsafe = await managerFor(RequiredCategoryNote, 1).makeMigration({ name: 'required_category' });
		const blockedPreservedSource = snapshotBefore === await readFile(snapshotFile, 'utf8') && filesBefore.length === (await readdir(migrationsDirectory)).length;
		const repaired = managerFor(OptionalCategoryNote, 2);
		const second = await repaired.makeMigration({ name: 'optional_category' });
		const pendingBefore = (await repaired.status()).migrations.pending.length;
		const applied = await repaired.migrate();
		const checked = await repaired.check();
		const row = await ActiveRecord.withDb(database.db, () => OptionalCategoryNote.query().firstOrFail());
		return { initialGenerated: first.generated, unsafeBlocked: unsafe.blocked, blockedPreservedSource, repairedGenerated: second.generated, pendingBefore, applied: applied.applied.length, matches: checked.matches, titlePreserved: row.get('title') === 'Keep this note', categoryNullable: row.get('category') === null };
	} finally {
		try { await database.destroy(); } finally { await rm(directory, { recursive: true, force: true }); }
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runNoteMigrations(), null, 2));
