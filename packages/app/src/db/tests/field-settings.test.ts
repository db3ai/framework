import { expect, it } from 'vitest';
import { ActiveRecord } from '@db3.ai/app/db';
import { collectFieldSettings, FIELD_SETTINGS_TABLE, writeFieldSettings } from '@db3.ai/app/db/migrations';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';

/** Link target whose name labels its rows. */
class SettingsOwner extends ActiveRecord.define({
	table: 'settings_owners',
	labelFields: ['name', 'email'],
	fields: field => ({ id: field.ulid({ primary: true }), name: field.string({ label: 'Full name' }), email: field.email(), password: field.password({}) }),
}) {}

/** One field of each kind the Database view understands. */
class SettingsTask extends ActiveRecord.define({
	table: 'settings_tasks',
	fields: field => ({
		id: field.ulid({ primary: true }), title: field.string({ label: ' Title ' }), notes: field.text(), site: field.url(),
		done: field.boolean(), count: field.integer(), price: field.decimal(), dueAt: field.timestamp({ column: 'due_at' }),
		stage: field.choice({ choices: ['idea', 'done'] }), extra: field.json(), owner: field.link(() => SettingsOwner, { column: 'owner_id' }),
	}),
}) {}

/** Describes fields by physical column, leaves secrets out and turns label fields into row label columns. */
it('collects field settings for the Database view from models', () => {
	expect(collectFieldSettings(SettingsTask)).toEqual({
		fields: {
			id: {}, title: { label: 'Title' }, notes: { type: 'longText' }, site: { type: 'url' }, done: { type: 'boolean' },
			count: { type: 'number' }, price: { type: 'number' }, due_at: { type: 'datetime' }, stage: { type: 'choice', choices: ['idea', 'done'] },
			extra: { type: 'json' }, owner_id: { type: 'link', link: { table: 'settings_owners' } },
		},
	});
	expect(collectFieldSettings(SettingsOwner)).toEqual({ display: ['name', 'email'], fields: { id: {}, name: { label: 'Full name' }, email: { type: 'email' } } });
});

/** Writes code-owned rows, takes over a model table set in Cloud, and keeps Cloud's rows for other tables. */
it('writes field settings into db3_tables in the app database', async () => {
	const database = await createGeneratedTestDatabase('field_settings');
	try {
		expect(await writeFieldSettings(database.db, [])).toBe(0);
		expect(await database.db.schema.hasTable(FIELD_SETTINGS_TABLE)).toBe(false);
		expect(await writeFieldSettings(database.db, [SettingsOwner])).toBe(1);
		await database.db(FIELD_SETTINGS_TABLE).insert([
			{ name: 'settings_tasks', owner: 'ui', definition: JSON.stringify({ fields: { title: { label: 'Mine' } } }) },
			{ name: 'reports', owner: 'ui', definition: JSON.stringify({ fields: {} }) },
		]);
		expect(await writeFieldSettings(database.db, [SettingsOwner, SettingsTask])).toBe(2);
		const rows = await database.db(FIELD_SETTINGS_TABLE).select('name', 'owner', 'definition').orderBy('name');
		expect(rows.map(row => [row.name, row.owner])).toEqual([['reports', 'ui'], ['settings_owners', 'code'], ['settings_tasks', 'code']]);
		expect(JSON.parse(rows[2].definition).fields.title).toEqual({ label: 'Title' });
	} finally { await database.destroy(); }
}, 30_000);
