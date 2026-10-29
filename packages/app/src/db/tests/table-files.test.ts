import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { App } from '@db3.ai/app/server';
import { Cli } from '@db3.ai/app/cli';
import { ActiveRecord, FileTableDefinitionStore, TableDefinitionConflictError, defineTableModels, parseTableDefinition, serializeTableDefinition } from '@db3.ai/app/db';
import { databaseCommands } from '@db3.ai/app/db/commands';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';

const customers = { version: 1, name: 'customers', help: 'People who buy from us.', display: ['name'], fields: [{ name: 'name', type: 'text', label: 'Name', required: true }, { name: 'email', type: 'email', help: 'Where receipts go.' }, { name: 'tier', type: 'choice', choices: ['free', 'pro'] }] };
const orders = { version: 1, name: 'orders', fields: [{ name: 'customer', type: 'link', link: { table: 'customers' } }, { name: 'total', type: 'number' }, { name: 'paid', type: 'boolean' }] };

/** Checks names, types, links and duplicates, and writes stable tab-indented JSON. */
it('validates table definitions and writes them deterministically', () => {
	expect(() => parseTableDefinition({ ...customers, name: 'Bad Name' })).toThrow(/lower-case/);
	expect(() => parseTableDefinition({ ...customers, name: 'db3_users' })).toThrow(/lower-case/);
	expect(() => parseTableDefinition({ ...customers, fields: [{ name: 'id', type: 'text' }] })).toThrow(/already has an id/);
	expect(() => parseTableDefinition({ ...customers, fields: [{ name: 'tier', type: 'choice' }] })).toThrow(/lists its choices/);
	expect(() => parseTableDefinition({ ...customers, fields: [{ name: 'a', type: 'text' }, { name: 'a', type: 'text' }] })).toThrow(/two fields named a/);
	expect(() => parseTableDefinition({ ...customers, display: ['nope'] })).toThrow(/no field nope/);
	expect(() => defineTableModels([parseTableDefinition(orders)])).toThrow(/which has no table file/);
	expect(serializeTableDefinition(parseTableDefinition(orders))).toBe('{\n\t"version": 1,\n\t"name": "orders",\n\t"fields": [\n\t\t{\n\t\t\t"name": "customer",\n\t\t\t"type": "link",\n\t\t\t"link": {\n\t\t\t\t"table": "customers"\n\t\t\t}\n\t\t},\n\t\t{\n\t\t\t"name": "total",\n\t\t\t"type": "number"\n\t\t},\n\t\t{\n\t\t\t"name": "paid",\n\t\t\t"type": "boolean"\n\t\t}\n\t]\n}\n');
});

/** Saves designs as files with revisions, refuses stale saves and links to missing tables. */
it('keeps table files with revisions', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-table-store-'));
	try {
		const store = new FileTableDefinitionStore(join(root, 'db3/tables'));
		expect(await store.list()).toEqual([]);
		await expect(store.write(orders, { expectedRevision: null })).rejects.toThrow(/which has no table file/);
		const first = await store.write(customers, { expectedRevision: null });
		expect(first.path).toBe('customers.json');
		await expect(store.write(customers, { expectedRevision: null })).rejects.toBeInstanceOf(TableDefinitionConflictError);
		const second = await store.write({ ...customers, label: 'Customers' }, { expectedRevision: first.revision });
		await expect(store.write(customers, { expectedRevision: first.revision })).rejects.toBeInstanceOf(TableDefinitionConflictError);
		await store.write(orders, { expectedRevision: null });
		await expect(store.remove('customers', second.revision)).rejects.toThrow(/orders links to customers/);
		await writeFile(join(root, 'db3/tables/wrong.json'), serializeTableDefinition(parseTableDefinition(customers)));
		await expect(store.list()).rejects.toThrow(/name it customers.json/);
	} finally { await rm(root, { recursive: true, force: true }); }
});

/** A designed table becomes a model, a migration and real SQL, and db3_tables describes it after db:migrate. */
it('saves tables as files with migrations that db:migrate applies', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-table-files-'));
	const database = await createGeneratedTestDatabase('table_files');
	const create = () => new App({ directory: root, db: database.db, dbOptions: { syncColumns: false, migrations: { models: [] } } });
	let app = create();
	try {
		const saved = await app.db.saveTable(customers, { expectedRevision: null });
		expect(saved.migration.generated).toBe(true);
		await app.db.saveTable(orders, { expectedRevision: null });
		expect((await readdir(join(root, 'db3/tables'))).sort()).toEqual(['customers.json', 'orders.json']);
		expect((await readdir(join(root, 'server/database/migrations'))).length).toBe(2);
		await app.close();

		// A fresh start reads the files, like a deploy of the commit that holds them.
		const messages: string[] = [];
		const runner = new Cli({ createApp: create, commands: databaseCommands }, { write: message => { messages.push(message); }, writeError: message => { messages.push(message); } });
		expect(await runner.run(['db:migrate'])).toBe(0);
		expect(await runner.run(['db:check'])).toBe(0);
		const columns = await database.db.raw('SHOW COLUMNS FROM orders');
		expect(columns[0].map((column: { Field: string }) => column.Field).sort()).toEqual(['customer', 'id', 'paid', 'total']);
		const keys = await database.db.raw("SELECT referenced_table_name AS target FROM information_schema.KEY_COLUMN_USAGE WHERE table_schema = DATABASE() AND table_name = 'orders' AND referenced_table_name IS NOT NULL");
		expect(keys[0].map((row: { target: string }) => row.target)).toEqual(['customers']);
		const settings = await database.db('db3_tables').select('name', 'owner', 'definition').orderBy('name');
		expect(settings.map(row => [row.name, row.owner])).toEqual([['customers', 'code'], ['orders', 'code']]);
		expect(JSON.parse(settings[0].definition)).toEqual({ display: ['name'], fields: { id: {}, name: { label: 'Name' }, email: { type: 'email' }, tier: { type: 'choice', choices: ['free', 'pro'] } } });
		expect(JSON.parse(settings[1].definition).fields.customer).toEqual({ type: 'link', link: { table: 'customers' } });

		// The compiled models work for rows too.
		app = create();
		const [Customer] = app.db.tableModels;
		await ActiveRecord.withDb(database.db, () => Customer!.create({ name: 'Ana', tier: 'pro' }).save());
		expect((await database.db('customers').first()).name).toBe('Ana');

		// A required field can't be added to a table with rows: the migration is blocked and the file stays as it was.
		const before = await readFile(join(root, 'db3/tables/customers.json'), 'utf8');
		const stored = await new FileTableDefinitionStore(join(root, 'db3/tables')).read('customers');
		const blocked = await app.db.saveTable({ ...customers, fields: [...customers.fields, { name: 'phone', type: 'text', required: true }] }, { expectedRevision: stored!.revision });
		expect(blocked.migration.blocked).toBe(true);
		expect(await readFile(join(root, 'db3/tables/customers.json'), 'utf8')).toBe(before);
		// An optional one is fine.
		const added = await app.db.saveTable({ ...customers, fields: [...customers.fields, { name: 'phone', type: 'text' }] }, { expectedRevision: stored!.revision });
		expect(added.migration.generated).toBe(true);
	} finally {
		await app.close().catch(() => {});
		await database.destroy();
		await rm(root, { recursive: true, force: true });
	}
}, 60_000);

