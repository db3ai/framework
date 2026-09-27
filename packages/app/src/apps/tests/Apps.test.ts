import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ActiveRecord, type FieldBuilder } from '@db3.ai/app/db';
import { App } from '@db3.ai/app/server';
import { defineApp, AppRouteError, type AppDefinition, type AppNavigation } from '@db3.ai/app/apps';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { QueueableJob, QueuedJob, FailedJob } from '@db3.ai/app/queue';
import { ScheduledOccurrence } from '@db3.ai/app/scheduler';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
const hosts: App[] = [];

/** Minimal owned schema used to test portable migration generation and corruption detection. */
class SocialEntry extends ActiveRecord {
	static override table = 'social_entries';
	/** Defines a real model without relying on any host tables. */
	static override fields(field: FieldBuilder) { return { id: field.ulid(), title: field.string({ required: true }) }; }
}

/** Overlapping feature-name prefixes must not transfer retained table ownership. */
class SocialSavedEntry extends SocialEntry {
	static override table = 'social_saved_entries';
}

/** Real serializable job with a controllable application operation for lifecycle assertions. */
class AppReviewJob extends QueueableJob {
	static jobName = 'social.review';
	static handled = 0;
	static operation: (() => Promise<void>) | undefined;
	/** Starts with no request-scoped state. */
	constructor() { super({}); }
	/** Executes the application operation before completing a real durable queue attempt. */
	async handle(): Promise<void> { await AppReviewJob.operation?.(); AppReviewJob.handled++; }
}

/** Defines a small real service with inspectable metadata and an authenticated route. */
function feature(id = 'social'): AppDefinition<{ label: string }> {
	return defineApp({
		manifest: { id, name: id, version: '1.0.0', icon: '◎', navigation: [{ id: 'home', label: 'Overview', path: '' }] },
		create: () => ({ label: id }),
		routes: [{ method: 'GET', path: '/', handle: ({ service, actor }) => ({ label: service.label, actor: actor.id }) }],
	});
}

/** Creates a host using the disposable database and tracks its resource ownership. */
function host<T extends Record<string, AppDefinition<any>>>(apps: T) {
	const application = new App({ db: database.db, apps });
	hosts.push(application);
	return application;
}

beforeEach(async () => { database = await createGeneratedTestDatabase('apps'); });
afterEach(async () => {
	try { for (const application of hosts.splice(0).reverse()) await application.close(); }
	finally { await database?.destroy(); }
});

describe('app composition through public exports', () => {
	it('restores owned jobs in a fresh worker, deduplicates hourly occurrences and removes only app registrations', async () => {
		AppReviewJob.handled = 0;
		const social = feature();
		social.jobs = [AppReviewJob];
		social.schedule = schedule => { schedule.job(AppReviewJob).hourly(); };
		const producer = host({ social });
		await producer.db.install(QueuedJob, FailedJob, ScheduledOccurrence);
		await producer.apps.install('social');
		await producer.apps.boot();
		expect((await producer.apps.describe())[0]).toMatchObject({ jobs: ['social.review'], schedules: [{ owner: 'social', name: 'social.review', frequency: { type: 'hourly' } }] });
		expect((await producer.scheduler.runDue(new Date('2026-01-01T10:59:00Z'))).due).toBe(0);
		expect((await producer.scheduler.runDue(new Date('2026-01-01T11:00:00Z'))).dispatched).toBe(1);
		expect((await producer.scheduler.runDue(new Date('2026-01-01T11:00:00Z'))).skipped).toBe(1);
		await expect(producer.apps.manage('uninstall', 'social')).rejects.toThrow('outstanding jobs');
		expect(producer.apps.social).toBeDefined();
		await producer.close();
		expect(producer.scheduler.definitions()).toHaveLength(0);
		const worker = host({ social });
		await worker.apps.boot();
		expect((await worker.queue.workNextJob())?.status).toBe('succeeded');
		expect(AppReviewJob.handled).toBe(1);
		worker.scheduler.call(() => {}).name('host.daily').daily();
		await worker.apps.manage('disable', 'social');
		expect(worker.scheduler.definitions().map(event => event.name)).toEqual(['host.daily']);
		await worker.apps.manage('enable', 'social');
		expect(worker.scheduler.definitions()).toHaveLength(2);
		await worker.apps.manage('uninstall', 'social');
		expect(worker.scheduler.definitions().map(event => event.name)).toEqual(['host.daily']);
		expect(await ScheduledOccurrence.where('name', 'social.review').count()).toBe(1);
	});

	it('drains an executing app job through its durable completion before disabling', async () => {
		const social = feature(); social.jobs = [AppReviewJob];
		const application = host({ social });
		await application.db.install(QueuedJob, FailedJob);
		await application.apps.install('social'); await application.apps.boot();
		let finish!: () => void; let entered!: () => void;
		const running = new Promise<void>(resolve => { entered = resolve; });
		AppReviewJob.operation = async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); };
		await application.queue.dispatch(new AppReviewJob());
		const work = application.queue.workNextJob(); await running;
		const disable = application.apps.manage('disable', 'social');
		try { expect(application.apps.social).toBeDefined(); }
		finally { finish(); await work; await disable; AppReviewJob.operation = undefined; }
		expect(application.apps.social).toBeUndefined();
		expect(await application.queue.hasPendingJobs('social.')).toBe(false);
	});

	it('preserves delayed and nested chained work and rejects undeclared scheduled classes', async () => {
		const social = feature(); social.jobs = [AppReviewJob];
		const application = host({ social });
		await application.db.install(QueuedJob, FailedJob);
		await application.apps.install('social'); await application.apps.boot();
		await application.queue.dispatch(new AppReviewJob(), { delaySeconds: 3600 });
		await expect(application.apps.manage('disable', 'social')).rejects.toThrow('outstanding jobs');
		await application.apps.close();
		await expect(application.apps.install('social')).rejects.toThrow('outstanding jobs');
		await expect(application.apps.uninstall('social')).rejects.toThrow('outstanding jobs');
		social.jobs = []; social.schedule = schedule => { schedule.job(AppReviewJob).hourly(); };
		await expect(application.apps.boot()).rejects.toThrow('must be declared');
		expect(application.scheduler.definitions()).toEqual([]);
	});

	it('collects fresh viewer contributions with static fallback, opt-out and no disabled providers', async () => {
		const social = feature();
		let calls = 0;
		social.navigation = async (context, service) => {
			calls++;
			expect(Object.isFrozen(context.actor)).toBe(true);
			await Promise.resolve();
			return { items: [{ id: 'home', label: service.label, path: '' }], badge: { count: context.actor.id === 'owner' ? 3 : 0, label: context.actor.id }, description: context.organisationId };
		};
		const hidden = feature('hidden');
		hidden.navigation = () => null;
		const dormant = feature('dormant');
		dormant.navigation = () => { throw new Error('Disabled providers must not run.'); };
		const application = host({ social, simple: feature('simple'), hidden, dormant });
		const viewer = { actor: { id: 'owner' }, organisationId: 'verified-organisation' };
		expect(await application.apps.navigation(viewer)).toEqual({ apps: [], unavailable: [] });
		for (const id of ['social', 'simple', 'hidden', 'dormant']) await application.apps.install(id);
		await application.apps.disable('dormant');
		await application.apps.boot();
		const [owner, stranger] = await Promise.all([application.apps.navigation(viewer), application.apps.navigation({ actor: { id: 'stranger' } })]);
		expect(owner.unavailable).toEqual([]);
		expect(owner.apps.map(app => app.appId)).toEqual(['social', 'simple']);
		expect(owner.apps[0]).toMatchObject({ badge: { count: 3, label: 'owner' }, description: 'verified-organisation' });
		expect(stranger.apps[0]).toMatchObject({ badge: { count: 0, label: 'stranger' } });
		expect(stranger.apps[0].description).toBeUndefined();
		expect(owner.apps[1].items).toEqual([{ id: 'home', label: 'Overview', path: '' }]);
		expect(calls).toBe(2);
		expect((await application.apps.describe())[0].manifest.navigation).toEqual(social.manifest.navigation);
		await expect(application.apps.navigation({ actor: { id: '' } })).rejects.toMatchObject({ statusCode: 401 });
		await expect(application.apps.navigation({ actor: { id: 'owner' }, organisationId: '' })).rejects.toMatchObject({ statusCode: 400 });
		await application.apps.manage('disable', 'social');
		expect((await application.apps.navigation(viewer)).apps.map(app => app.appId)).toEqual(['simple']);
		expect(calls).toBe(2);
	});

	it('isolates failed or invalid navigation and only serializes declared display fields', async () => {
		const social = feature();
		social.navigation = () => { throw new Error('Private provider details'); };
		const application = host({ social, simple: feature('simple') });
		await application.apps.install('social');
		await application.apps.install('simple');
		await application.apps.boot();
		const viewer = { actor: { id: 'owner' } };
		expect(await application.apps.navigation(viewer)).toEqual({ apps: [{ appId: 'simple', name: 'simple', icon: '◎', items: [{ id: 'home', label: 'Overview', path: '' }] }], unavailable: ['social'] });
		for (const invalid of [
			{ items: [{ id: 'home', label: 'Unsafe', path: '../other' }] },
			{ items: [{ id: 'home', label: 'Unsafe', path: 'https://outside.test' }] },
			{ items: [{ id: 'same', label: 'One', path: '' }, { id: 'same', label: 'Two', path: 'two' }] },
			{ items: [], badge: { count: -1, label: 'Invalid count' } },
			{ items: [], badge: { count: 1, label: '' } },
		]) {
			social.navigation = () => invalid;
			expect((await application.apps.navigation(viewer)).unavailable).toEqual(['social']);
		}
		const contribution = { items: [{ id: 'safe', label: 'Safe', path: '', secret: 'private' }], appId: 'spoofed', secret: 'private' };
		social.navigation = () => contribution;
		const result = await application.apps.navigation(viewer);
		expect(result.apps[0]).toEqual({ appId: 'social', name: 'social', icon: '◎', items: [{ id: 'safe', label: 'Safe', path: '' }] });
		expect(result.unavailable).toEqual([]);
	});

	it('drains navigation providers before removing their service and rejects requests during management', async () => {
		const social = feature();
		let finish!: (value: AppNavigation) => void;
		let entered!: () => void;
		let stopped = false;
		const running = new Promise<void>(resolve => { entered = resolve; });
		social.navigation = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
		social.start = ({ defer }) => { defer(() => { stopped = true; }); };
		const application = host({ social });
		await application.apps.install('social');
		await application.apps.boot();
		const viewer = { actor: { id: 'owner' } };
		const pending = application.apps.navigation(viewer);
		await running;
		const action = application.apps.manage('disable', 'social');
		try {
			await expect(application.apps.navigation(viewer)).rejects.toMatchObject({ statusCode: 503 });
			expect(stopped).toBe(false);
		} finally { finish({ items: [] }); await pending; await action; }
		expect(stopped).toBe(true);
		expect((await application.apps.navigation(viewer)).apps).toEqual([]);
	});

	it('retains exclusive table ownership even after the original app source is removed', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-app-ownership-'));
		try {
			const social = feature();
			social.database = { models: [SocialSavedEntry], directory: pathToFileURL(`${directory}/`) };
			const original = host({ social });
			await original.apps.migrations('social')!.makeMigration();
			await original.apps.install('social');
			await original.apps.uninstall('social');
			const claimant = feature('social_saved');
			claimant.database = social.database;
			await expect(host({ social_saved: claimant }).apps.install('social_saved')).rejects.toThrow('retained by app "social"');
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	it('generates executable package migrations, retries schema failures and rejects modified history', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'db3-app-migrations-'));
		try {
			const social = feature();
			social.database = { models: [SocialEntry], directory: pathToFileURL(`${directory}/`) };
			const application = host({ social });
			const migration = await application.apps.migrations('social')!.makeMigration();
			expect(migration.file).toMatch(/\.mjs$/);
			await application.apps.install('social');
			await SocialEntry.create({ title: 'Keep this record' }).save();
			await database.db.schema.alterTable('social_entries', table => { table.dropColumn('title'); });
			await expect(application.apps.install('social')).rejects.toThrow('Schema check failed');
			expect((await application.apps.describe())[0].state).toBe('failed');
			await application.apps.boot();
			expect(application.apps.social).toBeUndefined();
			await application.apps.close();
			await database.db.schema.alterTable('social_entries', table => { table.string('title', 255).notNullable(); });
			await application.apps.install('social');
			expect((await application.apps.migrations('social')!.check()).matches).toBe(true);
			await writeFile(migration.file!, `${await readFile(migration.file!, 'utf8')}\n// changed\n`);
			await expect(application.apps.install('social')).rejects.toThrow('removed or changed');
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	it('separates registered definitions, durable installation and ready typed services', async () => {
		const application = host({ social: feature() });
		expect(application.apps.social).toBeUndefined();
		expect((await application.apps.describe())[0]).toMatchObject({ state: 'available', ready: false, registered: true });
		expect(await database.db.schema.hasTable('db3_apps')).toBe(false);
		await application.apps.install('social');
		expect(application.apps.social).toBeUndefined();
		await Promise.all([application.apps.boot(), application.apps.boot()]);
		expect(application.apps.social?.label).toBe('social');
		expect(application.apps.require('social')).toBe(application.apps.social);
		expect((await application.apps.describe())[0]).toMatchObject({ state: 'enabled', ready: true, installedVersion: '1.0.0' });
		await expect(application.apps.disable('social')).rejects.toThrow('maintenance process');
	});

	it('retains installation history through disable, enable, uninstall and removal of all source registrations', async () => {
		const application = host({ social: feature() });
		await application.apps.install('social');
		await application.apps.disable('social');
		await application.apps.boot();
		expect(application.apps.social).toBeUndefined();
		await application.apps.close();
		await application.apps.enable('social');
		await application.apps.boot();
		expect(application.apps.social?.label).toBe('social');
		await application.apps.close();
		await application.apps.uninstall('social');
		await application.apps.uninstall('social');
		const removed = host({});
		await removed.apps.boot();
		expect((await removed.apps.describe())[0]).toMatchObject({ registered: false, state: 'uninstalled', ready: false, manifest: { id: 'social' } });
		expect(removed.apps.routes()).toEqual([]);
	});

	it('requires explicit upgrade and refuses downgrades or removal of enabled source', async () => {
		const application = host({ social: feature() });
		await application.apps.install('social');
		await expect(host({}).apps.boot()).rejects.toThrow('not registered');
		const definition = feature();
		definition.manifest.version = '1.1.0';
		const upgraded = host({ social: definition });
		await expect(upgraded.apps.boot()).rejects.toThrow('package version changed');
		await upgraded.apps.install('social');
		await upgraded.apps.boot();
		expect(upgraded.apps.social?.label).toBe('social');
		await expect(application.apps.install('social')).rejects.toThrow('downgrade');
	});

	it('orders required services, permits missing optional apps and blocks unsafe dependency removal', async () => {
		const order: string[] = [];
		const base = feature('base');
		base.start = () => { order.push('base'); };
		const social = feature();
		social.manifest.requires = { base: 1 };
		social.manifest.optional = { crm: 1 };
		social.start = ({ host }) => { expect(host.apps.get('base')).toBeDefined(); order.push('social'); };
		const application = host({ social, base });
		await expect(application.apps.install('social')).rejects.toThrow('requires enabled app');
		await application.apps.install('base');
		await application.apps.install('social');
		await expect(application.apps.disable('base')).rejects.toThrow('depends on');
		await expect(application.apps.uninstall('base')).rejects.toThrow('depends on');
		await application.apps.boot();
		expect(order).toEqual(['base', 'social']);
		await application.apps.close();
		await application.apps.disable('social');
		await application.apps.disable('base');
		await expect(application.apps.uninstall('base')).rejects.toThrow('depends on');
		await application.apps.uninstall('social');
		await application.apps.uninstall('base');
	});

	it('rejects incompatible optional contracts and validates the consumer when a provider upgrades', async () => {
		const social = feature();
		social.manifest.optional = { crm: 1 };
		const crm = feature('crm');
		crm.manifest.apiVersion = 2;
		const application = host({ social, crm });
		await application.apps.install('social');
		await expect(application.apps.install('crm')).rejects.toThrow('API generation 1');
	});

	it('rolls back partial startup and releases every resource even when one disposer fails', async () => {
		const calls: string[] = [];
		const base = feature('base');
		base.start = ({ defer }) => { defer(() => { calls.push('base'); }); };
		const social = feature();
		social.manifest.requires = { base: 1 };
		social.start = ({ defer }) => {
			defer(() => { calls.push('social'); throw new Error('cleanup failure'); });
			throw new Error('startup failure');
		};
		const application = host({ social, base });
		await application.apps.install('base');
		await application.apps.install('social');
		await expect(application.apps.boot()).rejects.toThrow('startup and cleanup failed');
		expect(calls).toEqual(['social', 'base']);
		expect(application.apps.social).toBeUndefined();
		expect(application.apps.base).toBeUndefined();
		await application.close();
	});

	it('leaves installation enabled when its app-specific uninstall preflight finds outstanding work', async () => {
		const social = feature();
		social.beforeUninstall = () => { throw new Error('Outstanding social jobs'); };
		const application = host({ social });
		await application.apps.install('social');
		await expect(application.apps.uninstall('social')).rejects.toThrow('Outstanding');
		expect((await application.apps.describe())[0].state).toBe('enabled');
	});

	it('guards routes with host authorization and exposes expected route failures safely', async () => {
		const social = feature();
		const application = host({ social });
		await application.apps.install('social');
		await application.apps.boot();
		const server = Fastify();
		registerAppRoutes(server, application.apps, async request => {
			if (request.headers.authorization !== 'test-user') throw new AppRouteError(401, 'Please sign in.');
			return { id: 'verified-person' };
		});
		try {
			expect((await server.inject('/api/apps/social')).statusCode).toBe(401);
			expect((await server.inject({ url: '/api/apps/social', headers: { authorization: 'test-user' } })).json()).toEqual({ label: 'social', actor: 'verified-person' });
			await application.apps.close();
			expect((await server.inject('/api/apps/social')).statusCode).toBe(404);
		} finally { await server.close(); }
	});

	it('rejects reserved names, route traversal and dependency cycles before touching storage', () => {
		expect(() => host({ get: feature('get') })).toThrow('reserved');
		expect(() => host({ db3: feature('db3') })).toThrow('reserved');
		expect(() => host({ db3_app: feature('db3_app') })).toThrow('reserved');
		expect(() => host({ wrong: feature('social') })).toThrow('identifier');
		const wrongOwner = feature('crm');
		wrongOwner.database = { models: [SocialEntry], directory: new URL('./', import.meta.url) };
		expect(() => host({ crm: wrongOwner })).toThrow('cannot own table');
		const social = feature();
		social.routes = [{ method: 'GET', path: '/../other', handle: () => null }];
		expect(() => host({ social })).toThrow('route');
		const base = feature('base');
		base.manifest.requires = { social: 1 };
		const cyclic = feature();
		cyclic.manifest.requires = { base: 1 };
		expect(() => host({ base, social: cyclic })).toThrow('cycle');
	});
});


it('drains active requests, blocks new ones and restores resources after a rejected online action', async () => {
	const social = feature();
	let stopped = 0;
	social.start = ({ defer }) => { defer(() => { stopped++; }); };
	social.beforeUninstall = () => { throw new Error('Still in use'); };
	const application = host({ social });
	await application.apps.install('social');
	await application.apps.boot();
	let finish!: () => void;
	let entered!: () => void;
	const running = new Promise<void>(resolve => { entered = resolve; });
	const request = application.apps.run(async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return application.apps.social?.label; });
	await running;
	const action = application.apps.manage('uninstall', 'social');
	const rejected = expect(action).rejects.toThrow('Still in use');
	await expect(application.apps.run(async () => 'new')).rejects.toMatchObject({ statusCode: 503 });
	await expect(application.apps.manage('disable', 'social')).rejects.toMatchObject({ statusCode: 409 });
	expect(stopped).toBe(0);
	finish();
	expect(await request).toBe('social');
	await rejected;
	expect(stopped).toBe(1);
	expect(application.apps.social?.label).toBe('social');
});

it('runs app-owned down migrations only after disable and can reapply the same immutable migration', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'db3-app-down-'));
	try {
		const social = feature();
		social.database = { models: [SocialEntry], directory: pathToFileURL(`${directory}/`) };
		const application = host({ social });
		const migration = await application.apps.migrations('social')!.makeMigration();
		// Author the reversal before this migration has ever been installed or fingerprinted.
		await writeFile(migration.file!, (await readFile(migration.file!, 'utf8')).replace("throw new Error('Generated database migrations are forward-only.');", "await _knex.schema.dropTable('social_entries');"));
		await application.apps.install('social');
		await expect(application.apps.rollback('social')).rejects.toThrow('Disable');
		await application.apps.disable('social');
		expect((await application.apps.rollback('social')).reverted).toHaveLength(1);
		expect(await database.db.schema.hasTable('social_entries')).toBe(false);
		expect((await application.apps.describe())[0].state).toBe('failed');
		await application.apps.install('social');
		expect((await application.apps.migrations('social')!.check()).matches).toBe(true);
	} finally { await rm(directory, { recursive: true, force: true }); }
});


it('keeps a failed install hook unavailable and reruns the app-owned setup on retry', async () => {
	const social = feature();
	let attempts = 0;
	social.afterInstall = async () => { if (++attempts === 1) throw new Error('Setup incomplete'); };
	const application = host({ social });
	await expect(application.apps.install('social')).rejects.toThrow('Setup incomplete');
	expect((await application.apps.describe())[0]).toMatchObject({ state: 'failed', ready: false });
	await application.apps.install('social');
	await application.apps.boot();
	expect(attempts).toBe(2);
	expect(application.apps.social?.label).toBe('social');
});
