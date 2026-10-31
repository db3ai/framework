import type { DocArticle } from '../docs';

const addColumn = `// server/database/migrations/20261030090000_add_note_summary.mjs (generated)
/** Expand keeps the previous release runnable on this schema; contract removes what it may use. */
export const phase = "expand";

export async function up(knex) {
	await knex.schema.alterTable("notes", table => {
		{
			const column = table.specificType("summary", "varchar(255)");
			column.nullable();
		}
	});
}`;

const removeField = `# Release 1: delete the field from the model, then record it as retired.
npm run db3 -- db:make-migration remove_note_legacy --retire
#   (an app: npm run db3 -- apps:make-migration notes remove_legacy --retire)
# Deploy release 1. The column stays; a required one becomes optional.

# Release 2, any later deploy: drop everything earlier releases retired.
npm run db3 -- db:make-migration drop_note_legacy --drop-retired
# Deploy release 2. migrate refuses it if release 1's retire has not run first.`;

const retireFiles = `// Release 1: 20261030090500_remove_note_legacy.mjs
export const phase = "expand";
export const retired = [{"kind":"drop_column","tableName":"notes","columnName":"legacy"}];
export async function up(knex) {
	// A required retired column becomes optional so release 1's inserts still work.
	await knex.schema.alterTable("notes", table => {
		table.specificType("legacy", "varchar(255)").nullable().alter({ alterNullable: true, alterType: false });
	});
}

// Release 2: 20261102101500_drop_note_legacy.mjs
export const phase = "expand";
export const dropsRetired = ["20261030090500_remove_note_legacy.mjs"];
export async function up(knex) {
	await knex.schema.alterTable("notes", table => { table.dropColumn("legacy"); });
}`;

const handWritten = `// A hand-written data migration must say what it is, or it counts as contract.
export const phase = "expand";
export const config = { transaction: false };

/** Copies the old column into its replacement; the old column stays for the previous release. */
export async function up(knex) {
	await knex("notes").whereNull("title_text").update({ title_text: knex.ref("title") });
}

export async function down() {
	throw new Error('Forward-only.');
}`;

const deployChecks = `// scripts/database.ts: read-only checks a deploy script runs from a release's own image.
import { createApplication } from '../server/app';

const application = createApplication(readConfig());
try {
	if (process.argv[2] === 'plan') {
		// Before migrating: would the candidate stop the live release running?
		const managers = [application.db.migrations, ...(await application.apps.describe()).map(app => application.apps.migrations(app.manifest.id))];
		let contract = false;
		for (const manager of managers) {
			if (manager) contract ||= (await manager.check()).migrations.pendingContract.length > 0;
		}
		process.exitCode = contract ? 3 : 0;
	} else {
		// Before rolling back: can this release boot on the database as it is now?
		if (!(await application.db.migrations.check()).compatible) throw new Error('Host schema is incompatible.');
		await application.apps.verify();
	}
} finally {
	await application.close();
}`;

const deployFlow = `promote candidate:
  1. candidate: npm run db:plan        exit 3 = contract migrations -> refuse (unless explicitly allowed)
  2. back up the database
  3. candidate: npm run setup          db:migrate + apps:install
  4. previous:  npm run db:compatible  fails -> warn: rollback now needs the backup
  5. start candidate, check health, switch traffic

rollback to an earlier release:
  1. target:    npm run db:compatible  fails -> refuse, before anything is stopped
  2. stop the active release, start the target's frozen images, switch traffic`;

/** Guide to expand/contract migrations: schema changes that keep the previous release runnable. */
export const safeMigrationsArticle: DocArticle = {
	id: 'guide-safe-migrations', area: 'guides', group: 'Application guides', label: 'Safe migrations', title: 'Change the schema and keep rollback working', summary: 'Ship schema changes in expand and contract steps so the previous release can always run on the new database.', packageName: '@db3.ai/app/db/migrations', sourcePath: 'packages/app/src/db/README.md', testPath: 'packages/app/src/apps/tests/AppsRollback.test.ts', includeSourceDocument: false,
	sections: [
		{ id: 'why', title: 'Why the previous release must still run', paragraphs: ['A deploy migrates the database, then starts the new code. If the new code fails its health checks, the quickest recovery is switching back to the release before it. That only works if the old code can run on the database the new release just migrated. Migrations are forward-only, so there is no undo; restoring a backup loses every write since it was taken.', 'So every release follows one rule: its migrations leave the database usable by the previous release’s code. Changes that remove or tighten something wait for a later release, after the code that stopped needing them is already live. This is the established expand and contract (parallel change) pattern.'] },
		{ id: 'rule', title: 'The rule in short', paragraphs: ['A release may add things, or stop using things. A later release may remove what an earlier release stopped using. Removing a field takes two releases; the second can be any later deploy, as long as it is a different deploy from the one that stopped using it.', 'A rename or type change takes three: add the new column and write both, then switch reads to it and retire the old one, then drop the old one.', 'Four protections enforce this. Every generated migration is marked expand or contract, and anything unmarked counts as contract. An older release boots only if every newer migration that ran was expand. Migrate refuses to drop retired schema in the same run that retired it. A deploy script holds contract migrations and refuses a rollback the target cannot survive.'] },
		{ id: 'phases', title: 'Expand and contract migrations', paragraphs: ['An expand migration only adds: new tables, nullable columns, required columns with a static default, indexes, foreign keys, comments, or making a column optional. The previous release ignores these, because the schema check only looks at the tables, columns and indexes its own models declare.', 'A contract migration removes or tightens: dropped tables, columns or indexes, type changes, default changes, and making a column required. After one, the previous release may fail to start or may write data the new schema rejects.', '`db:make-migration` writes `export const phase = "expand"` or `"contract"` into every generated file. A file without a literal declaration, such as an older or hand-written migration, counts as contract, because nothing proves it is safe.'], codeSampleId: 'add-column' },
		{ id: 'check', title: 'How the framework lets the previous release boot', paragraphs: ['`db:migrate` records the phase of each applied file in a `<ledger>_phases` table beside the Knex ledger. An older release has no files for newer migrations, so this table is how it learns they were expand migrations.', '`check()` returns two answers. `matches` means the code and database agree exactly; install requires it. `compatible` means this code can run here: nothing of its own is pending, every applied migration it lacks a file for is a recorded expand migration, and the live schema still satisfies its models apart from extra schema, comments and columns made optional. App boot and enable use `compatible`.', 'Apps also record `compatible_from` in `db3_apps`, the oldest app version allowed to run on the installed schema. An install that applies only expand migrations keeps it where it was. One that applies a contract migration raises it to its own version, so older code refuses to boot instead of running against a schema it does not understand. Code newer than the installation still needs `apps:install`.'] },
		{ id: 'add', title: 'Add things in one release', paragraphs: ['Adding a nullable column, a column with a default, a table or an index is a single expand migration. Generate it, review it, commit it with the code and deploy. The previous release keeps working because it never reads the new column.', 'A new required column without a default is blocked by the generator. Add it as nullable, deploy code that writes it, backfill existing rows, then make it required in a later release. That last step is a contract migration.'] },
		{ id: 'remove', title: 'Remove a field in two releases', paragraphs: ['Delete the field from the model, then generate with `--retire`. Instead of a drop, this writes an expand migration that records the column, table, index or foreign key as retired, and makes a required retired column optional so the new code can insert rows without it. The snapshot moves on, and the column stays in the database.', 'In any later release, generate with `--drop-retired`. It drops everything recorded as retired that no later migration has dropped yet, and names the retire migrations in `dropsRetired`. On a database already in use, `migrate` and `apps:install` refuse to run that drop in the same run as its retire migration. The release that stopped using the column therefore deploys first, and rolling back to it after the drop is safe.', 'A plain `db:make-migration` still blocks removals. `allowDestructive` drops at once and marks the migration contract; keep it for data you are sure no running code reads.'], codeSampleId: 'remove-field' },
		{ id: 'retire-files', title: 'What the two generated files contain', paragraphs: ['The retire file has no drop, and its `retired` export is what `--drop-retired` reads later. The drop file is also marked expand: the release before it no longer uses the column, and any older release that still needs it fails its schema check, so it cannot boot by mistake.'], codeSampleId: 'retire-files' },
		{ id: 'rename', title: 'Rename a column or change its type', paragraphs: ['Never rename in place. In the first release, add the new column (expand), write both columns and copy existing values across, while reads stay on the old column. In the next release, read the new column and retire the old one. In a later release, drop it with `--drop-retired`.', 'A type change follows the same steps: add a column of the new type, copy into it, switch reads, then retire and drop the old column.'] },
		{ id: 'hand-written', title: 'Hand-written and data migrations', paragraphs: ['Declare the phase yourself. Copying data into a new column, or a backfill the previous release can live with, is expand. Anything that deletes, rewrites values the previous release reads, or adds a constraint existing writes may break is contract.', 'Keep large backfills idempotent and in bounded batches. A migration that fails part way through can leave partial changes on MariaDB, because DDL is not transactional there.'], codeSampleId: 'hand-written' },
		{ id: 'deploy', title: 'Hold back contract migrations when deploying', paragraphs: ['A deploy script can enforce the rule using two read-only checks run from a release’s own code against the live database. Before migrating, the candidate reports whether any pending migration is contract (`check().migrations.pendingContract`). If one is, refuse the deploy unless someone explicitly accepts that rollback will need the backup.', 'Before a rollback, run the target release’s `apps.verify()` and the host `check().compatible`. If either fails, refuse before stopping anything, and point the operator at the latest backup. db3.ai’s own deploy runs these as `npm run db:plan` and `npm run db:compatible`, and allows contract migrations only with `DB3_ALLOW_CONTRACT=1`.'], codeSampleId: 'deploy-checks' },
		{ id: 'flow', title: 'The deploy order', paragraphs: ['Keep a database backup per promotion even when every check passes: checks prove the code can start, not that every data change was right.'], codeSampleId: 'deploy-flow' },
		{ id: 'limits', title: 'Coverage and limits', paragraphs: ['Tested: an older app version boots after an expand-only upgrade and refuses after a contract one; retire then drop across releases; the drop refused in the same run as its retire; pending contract migrations reported before install.', 'Limits: generated migrations support MariaDB only. Releases built before phases existed cannot read the phase table, so rolling back to them keeps the old strict check. After a retire makes a column optional, rolling back lets the previous release read NULL in rows the newer release wrote; keep that in mind before retiring a column the previous release displays.'], links: [{ label: 'Generate and apply migrations', articleId: 'migrations' }, { label: 'Migration API', articleId: 'migrations-api' }] },
	],
	codeSamples: [
		{ id: 'add-column', title: 'An expand migration', language: 'javascript', code: addColumn },
		{ id: 'remove-field', title: 'Remove a field across two releases', language: 'bash', code: removeField },
		{ id: 'retire-files', title: 'Retire, then drop', language: 'javascript', code: retireFiles },
		{ id: 'hand-written', title: 'Declare the phase of a hand-written migration', language: 'javascript', code: handWritten },
		{ id: 'deploy-checks', title: 'Deploy checks', language: 'typescript', code: deployChecks },
		{ id: 'deploy-flow', title: 'Promote and rollback', language: 'text', code: deployFlow },
	],
	relatedIds: ['migrations', 'migrations-api', 'apps', 'guide-model-data'],
	keywords: ['expand contract parallel change rollback safe migration retire drop retired deploy zero downtime backward compatible schema'],
};
