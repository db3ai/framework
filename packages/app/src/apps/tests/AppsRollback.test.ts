import { afterEach, beforeEach, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';
import { defineApp, type AppDefinition } from '@db3.ai/app/apps';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
const hosts: App[] = [];

/** First release of the owned table. */
class SocialEntry extends ActiveRecord {
	static override table = 'social_entries';
	/** Defines one required field. */
	static override fields(field: FieldBuilder) { return { id: field.ulid(), title: field.string({ required: true }) }; }
}

/** Defines a small real service. */
function feature(): AppDefinition<{ label: string }> {
	return defineApp({ manifest: { id: 'social', name: 'social', version: '1.0.0', icon: '◎' }, create: () => ({ label: 'social' }) });
}

/** Creates a host on the disposable database and tracks it for cleanup. */
function host<T extends Record<string, AppDefinition<any>>>(apps: T) {
	const application = new App({ db: database.db, apps });
	hosts.push(application);
	return application;
}

beforeEach(async () => { database = await createGeneratedTestDatabase('apps_rollback'); });
afterEach(async () => {
	try { for (const application of hosts.splice(0).reverse()) await application.close(); }
	finally { await database?.destroy(); }
});

/** Second release of the owned table: adds a nullable column the first release never reads. */
class SocialEntryWithSummary extends ActiveRecord {
	static override table = 'social_entries';
	/** Keeps the first release's fields and adds one optional field. */
	static override fields(field: FieldBuilder) { return { id: field.ulid(), title: field.string({ required: true }), summary: field.string() }; }
}

it('boots the previous release after an expand-only upgrade and refuses it after a contract', async () => {
	const root = await mkdtemp(join(tmpdir(), 'db3-app-expand-'));
	/** Defines one release of the app with its own migration folder, as separate deployments have. */
	const release = (version: string, models: typeof SocialEntry[], directory: string) => {
		const definition = feature();
		definition.manifest.version = version;
		definition.database = { models, directory: pathToFileURL(`${directory}/`) };
		return definition;
	};
	try {
		const first = release('1.0.0', [SocialEntry], join(root, 'a'));
		await host({ social: first }).apps.migrations('social')!.makeMigration();
		await host({ social: first }).apps.install('social');
		await cp(join(root, 'a'), join(root, 'b'), { recursive: true });
		const second = release('1.1.0', [SocialEntryWithSummary], join(root, 'b'));
		const expand = await host({ social: second }).apps.migrations('social')!.makeMigration();
		expect(await readFile(expand.file!, 'utf8')).toContain('export const phase = "expand";');
		await host({ social: second }).apps.install('social');
		await SocialEntryWithSummary.create({ title: 'Written by 1.1.0', summary: 'kept' }).save();

		const rolledBack = host({ social: first });
		const check = await rolledBack.apps.migrations('social')!.check();
		expect(check).toMatchObject({ matches: false, compatible: true, migrations: { newerExpand: [expand.file!.split('/').pop()] } });
		await rolledBack.apps.verify();
		await rolledBack.apps.boot();
		expect(rolledBack.apps.social?.label).toBe('social');
		await SocialEntry.create({ title: 'Written by 1.0.0 after rollback' }).save();
		await rolledBack.close();

		await cp(join(root, 'b'), join(root, 'c'), { recursive: true });
		const third = release('1.2.0', [SocialEntry], join(root, 'c'));
		const contract = await host({ social: third }).apps.migrations('social')!.makeMigration({ allowDestructive: true });
		expect(await readFile(contract.file!, 'utf8')).toContain('export const phase = "contract";');
		expect((await host({ social: third }).apps.migrations('social')!.check()).migrations.pendingContract).toEqual([contract.file!.split('/').pop()]);
		await host({ social: third }).apps.install('social');
		await expect(host({ social: second }).apps.verify()).rejects.toThrow('package version changed');
		await expect(host({ social: second }).apps.boot()).rejects.toThrow('package version changed');
		expect((await host({ social: second }).apps.migrations('social')!.check()).compatible).toBe(false);
		await host({ social: third }).apps.boot();
	} finally { await rm(root, { recursive: true, force: true }); }
});
