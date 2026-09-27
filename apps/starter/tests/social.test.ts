import 'dotenv/config';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { App } from '@db3.ai/app/server';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { createApplication } from '../server/app';
import { createServer } from '../server/http/createServer';
import type { StarterConfig } from '../server/config';
import { InAppRecord } from '@db3.ai/app/in-app';

delete process.env.DATABASE_URL;
process.env.DB_CONNECTION = 'mariadb';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '3306';
process.env.DB_USER = process.env.TEST_DB_USER || 'root';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || '';
process.env.DB_DATABASE = 'db3_app_test';
process.env.DB_TEST_DATABASE_PREFIX = 'db3_app_test';
const config: StarterConfig = { name: 'Social tests', origin: 'http://localhost:5173', port: 3001, host: '127.0.0.1', production: false, appsAdminEmail: 'admin@example.test', appsManageOnline: true, auth: { googleClientId: '' }, ai: { apiKey: '', model: 'unused' } };
let database: GeneratedTestDatabase;
let application: ReturnType<typeof createApplication>;
let server: Awaited<ReturnType<typeof createServer>>;

beforeEach(async () => {
	database = await createGeneratedTestDatabase('social');
	application = createApplication(config, { db: database.db });
	await application.db.migrations.migrate();
});
afterEach(async () => {
	try { await server?.close(); } finally { try { await application?.close(); } finally { await database?.destroy(); } }
});

/** Creates a real authenticated session for the app-owned HTTP routes. */
async function register(email: string) {
	const response = await server.inject({ method: 'POST', url: '/api/register', headers: { origin: config.origin }, payload: { name: 'Researcher', email, password: 'research-password-123' } });
	expect(response.statusCode).toBe(201);
	return { cookie: String(response.headers['set-cookie']).split(';')[0], origin: config.origin };
}

it('installs a local app, authorizes its data and preserves it through disable, removal and reinstall', async () => {
	expect(await database.db.schema.hasTable('social_opportunities')).toBe(false);
	await application.apps.install('social');
	expect((await application.apps.migrations('social')!.check()).matches).toBe(true);
	expect((await application.db.migrations.check()).matches).toBe(true);
	server = await createServer(application, config);
	const owner = await register('owner@example.test');
	const stranger = await register('other@example.test');
	expect((await server.inject('/api/apps')).statusCode).toBe(401);
	expect((await server.inject('/api/apps/social/opportunities')).statusCode).toBe(401);
	const saved = await server.inject({ method: 'POST', url: '/api/apps/social/opportunities', headers: owner, payload: { title: 'Which UI library?', url: 'https://example.test/discussion', notes: 'Explain the accessibility trade-offs.' } });
	expect(saved.statusCode).toBe(201);
	const id = saved.json().opportunity.id;
	expect((await server.inject('/api/app-navigation')).statusCode).toBe(401);
	const [ownerNavigation, strangerNavigation] = await Promise.all([
		server.inject({ url: '/api/app-navigation?actor=someone-else', headers: owner }),
		server.inject({ url: '/api/app-navigation?actor=owner', headers: stranger }),
	]);
	expect(ownerNavigation.headers['cache-control']).toBe('no-store');
	expect(ownerNavigation.json()).toMatchObject({ apps: [{ appId: 'social', badge: { count: 1, label: '1 saved opportunity' }, description: 'Ready to review', items: [{ id: 'opportunities', badge: { count: 1 } }, { id: 'about', path: 'about' }] }], unavailable: [] });
	expect(strangerNavigation.json()).toMatchObject({ apps: [{ badge: { count: 0 }, description: 'All caught up' }], unavailable: [] });
	expect((await server.inject({ url: '/api/apps/social/opportunities', headers: stranger })).json().opportunities).toEqual([]);
	expect((await server.inject({ method: 'PATCH', url: `/api/apps/social/opportunities/${id}`, headers: stranger, payload: { status: 'answered' } })).statusCode).toBe(404);
	expect((await server.inject({ method: 'PATCH', url: `/api/apps/social/opportunities/${id}`, headers: owner, payload: { status: 'answered' } })).json().opportunity.status).toBe('answered');
	expect((await server.inject({ url: '/api/app-navigation', headers: owner })).json().apps[0].badge.count).toBe(0);
	for (const payload of [{ title: 'x', url: 'javascript:alert(1)' }, { title: 'x', url: 'https://example.test', owner: 'someone' }]) {
		expect((await server.inject({ method: 'POST', url: '/api/apps/social/opportunities', headers: owner, payload })).statusCode).toBe(400);
	}
	expect((await server.inject({ method: 'POST', url: '/api/apps/social/opportunities', headers: { ...owner, origin: 'https://foreign.example' }, payload: {} })).statusCode).toBe(403);
	await server.close();
	await application.apps.close();
	await application.apps.disable('social');
	server = await createServer(application, config);
	expect((await server.inject({ url: '/api/apps/social/opportunities', headers: owner })).statusCode).toBe(404);
	expect((await server.inject({ url: '/api/app-navigation', headers: owner })).json()).toEqual({ apps: [], unavailable: [] });
	await server.close();
	await application.apps.close();
	await application.apps.uninstall('social');
	const removed = new App({ db: database.db, apps: {} });
	await removed.apps.boot();
	expect((await removed.apps.describe())[0]).toMatchObject({ registered: false, state: 'uninstalled' });
	expect(await database.db('social_opportunities').where({ id }).first()).toBeDefined();
	await removed.close();
	await application.close();
	application = createApplication(config, { db: database.db });
	await application.apps.install('social');
	server = await createServer(application, config);
	expect((await server.inject({ url: '/api/apps/social/opportunities', headers: owner })).json().opportunities[0]).toMatchObject({ id, status: 'answered' });
	expect((await application.db.migrations.check()).matches).toBe(true);
});

it('keeps registered but uninstalled apps visible in the explorer and unavailable through routes', async () => {
	server = await createServer(application, config);
	const headers = await register('explorer@example.test');
	const catalog = (await server.inject({ url: '/api/apps', headers })).json().apps;
	expect(catalog[0]).toMatchObject({ state: 'available', ready: false, models: [] });
	expect((await server.inject({ url: '/api/app-navigation', headers })).json()).toEqual({ apps: [], unavailable: [] });
	expect((await server.inject({ url: '/api/apps/social/opportunities', headers })).statusCode).toBe(404);
});

it('loads schedule.ts, queues an hourly review and deduplicates app-owned inbox notifications', async () => {
	await application.apps.install('social');
	server = await createServer(application, config);
	const headers = await register('review@example.test');
	const id = (await server.inject({ url: '/api/me', headers })).json().user.id;
	await application.social!.save(id, { title: 'A discussion to review', url: 'https://example.test/question', notes: 'Prepare a useful answer.' });
	expect((await application.apps.describe())[0].schedules[0]).toMatchObject({ name: 'social.review-saved-opportunities', frequency: { type: 'hourly' } });
	for (const hour of ['10', '11']) {
		expect((await application.scheduler.runDue(new Date(`2026-01-01T${hour}:00:00Z`))).dispatched).toBe(1);
		expect((await application.queue.workNextJob())?.status).toBe('succeeded');
	}
	const reminders = await InAppRecord.where({ userId: id, type: 'social.saved-opportunity' }).all();
	expect(reminders).toHaveLength(1);
	expect(reminders[0].message).toMatchObject({ title: 'A discussion to review', presentation: 'inbox', action: { href: '/#apps/social' } });
	await application.apps.manage('uninstall', 'social');
	expect(application.scheduler.definitions()).toEqual([]);
	expect(await InAppRecord.where('userId', id).count()).toBe(1);
});


it('installs from the Apps screen policy without restarting and prevents ordinary accounts from managing apps', { timeout: 30_000 }, async () => {
	server = await createServer(application, config);
	const admin = await register('admin@example.test');
	const ordinary = await register('ordinary@example.test');
	expect((await server.inject({ url: '/api/apps', headers: admin })).json().canManage).toBe(true);
	expect((await server.inject({ url: '/api/apps', headers: ordinary })).json().canManage).toBe(false);
	expect((await server.inject({ method: 'POST', url: '/api/app-management/social/install', headers: ordinary })).statusCode).toBe(403);
	expect(await database.db.schema.hasTable('social_opportunities')).toBe(false);
	for (const action of ['install', 'disable', 'enable', 'uninstall', 'install']) {
		const result = await server.inject({ method: 'POST', url: `/api/app-management/social/${action}`, headers: admin });
		expect(result.statusCode).toBe(200);
		const available = ['install', 'enable'].includes(action);
		expect(result.json().apps[0].ready).toBe(available);
		expect((await server.inject({ url: '/api/apps/social/opportunities', headers: admin })).statusCode).toBe(available ? 200 : 404);
		expect(Boolean(application.social)).toBe(available);
	}
	expect((await server.inject({ method: 'POST', url: '/api/app-management/social/rollback', headers: admin })).statusCode).toBe(400);
	expect((await server.inject({ method: 'POST', url: '/api/app-management/social/uninstall', headers: { ...admin, origin: 'https://other.test' } })).statusCode).toBe(403);
});
