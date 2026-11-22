import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { App } from '@db3.ai/app/server';
import { defineSubApp, AppRouteError, PluginChanged, type SubAppDefinition, type PluginScope } from '@db3.ai/app/apps';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
const hosts: App[] = [];
const calls: string[] = [];

const org: PluginScope = { type: 'organization', id: 'o1' };
const app1: PluginScope = { type: 'app', id: 'a1' };
const actor = { id: 'person' };

/** Security: one activation per organization, active unless someone deactivates it. */
function security(): SubAppDefinition<{ id: string }> {
	return defineSubApp({
		manifest: { id: 'scanner', name: 'Security', version: '1.0.0', plugin: { scope: 'organization', default: 'on' } },
		create: () => ({ id: 'scanner' }),
		routes: [{ method: 'GET', path: '/organizations/:organization/findings', handle: ({ params }) => ({ organization: params.organization }) }],
		activated: scope => { calls.push(`security on ${scope.id}`); },
		deactivated: scope => { calls.push(`security off ${scope.id}`); },
	});
}

/** AI security: one activation per hosted app, inactive by default, needs Security. */
function securityAi(refuse = false): SubAppDefinition<{ id: string }> {
	return defineSubApp({
		manifest: { id: 'security_ai', name: 'AI security', version: '1.0.0', requires: { scanner: 1 }, plugin: { scope: 'app' } },
		create: () => ({ id: 'security_ai' }),
		routes: [{ method: 'GET', path: '/apps/:app/review', handle: ({ params }) => ({ app: params.app }) }],
		activating: () => { if (refuse) throw new AppRouteError(402, 'Add a card first.'); },
		activated: scope => { calls.push(`ai on ${scope.id}`); },
		deactivated: scope => { calls.push(`ai off ${scope.id}`); },
	});
}

/** Boots a host with the apps installed; hosted app a1 belongs to organization o1. */
async function host(apps: Record<string, SubAppDefinition<any>>) {
	const application = new App({ db: database.db, apps });
	hosts.push(application);
	for (const id of Object.keys(apps)) await application.apps.install(id);
	await application.apps.boot();
	application.apps.plugins.parent('app', id => (id === 'a1' || id === 'a2' ? org : undefined));
	return application;
}

beforeEach(async () => { calls.length = 0; database = await createGeneratedTestDatabase('plugins'); });
afterEach(async () => {
	try { for (const application of hosts.splice(0).reverse()) await application.close(); }
	finally { await database?.destroy(); }
});

describe('plugins: sub apps each scope activates', () => {
	it('refuses a plugin block with a bad scope or a route that does not name its scope', () => {
		const bad = (plugin: object, path = '/organizations/:organization') => () => new App({ db: database.db, apps: { tool: defineSubApp({ manifest: { id: 'tool', name: 'Tool', version: '1.0.0', plugin } as never, create: () => ({}), routes: [{ method: 'GET', path, handle: () => ({}) }] }) } });
		expect(bad({ scope: 'Organization' })).toThrow('Invalid plugin');
		expect(bad({ scope: 'organization', default: 'maybe' })).toThrow('Invalid plugin');
		expect(bad({ scope: 'organization' }, '/runs')).toThrow(':organization');
	});

	it('starts from the manifest default, saves each change once, runs hooks and announces it', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		const events: PluginChanged[] = [];
		application.events.listen(PluginChanged, event => { events.push(event); });

		expect(await application.apps.plugins.isActive('scanner', org)).toBe(true);
		expect(await application.apps.plugins.isActive('security_ai', app1)).toBe(false);
		expect(await application.apps.plugins.activate('security_ai', app1, actor)).toEqual({ appId: 'security_ai', scope: app1, active: true });
		expect(await application.apps.plugins.activate('security_ai', app1, actor)).toEqual({ appId: 'security_ai', scope: app1, active: true });
		expect(await application.apps.plugins.isActive('security_ai', app1)).toBe(true);
		expect(await application.apps.plugins.isActive('security_ai', { type: 'app', id: 'a2' })).toBe(false);
		expect(calls).toEqual(['ai on a1']);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ appId: 'security_ai', scope: app1, active: true, actorId: 'person' });

		expect(await application.apps.plugins.list(app1)).toEqual([
			{ appId: 'scanner', scope: org, active: true },
			{ appId: 'security_ai', scope: app1, active: true },
		]);

		await application.apps.plugins.deactivate('security_ai', app1, actor);
		expect(calls).toEqual(['ai on a1', 'ai off a1']);
		expect(events.map(event => event.active)).toEqual([true, false]);
	});

	it('keeps the state in the database for every process', async () => {
		const first = await host({ scanner: security() });
		await first.apps.plugins.deactivate('scanner', org, actor);
		await first.close();
		const second = await host({ scanner: security() });
		expect(await second.apps.plugins.isActive('scanner', org)).toBe(false);
	});

	it('switches a plugin only at its own scope', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		await expect(application.apps.plugins.activate('security_ai', org, actor)).rejects.toMatchObject({ statusCode: 400 });
		await expect(application.apps.plugins.activate('nothing', org, actor)).rejects.toMatchObject({ statusCode: 404 });
	});

	it('keeps required plugins on while a dependant uses them, across scopes', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		await application.apps.plugins.activate('security_ai', app1, actor);
		await expect(application.apps.plugins.deactivate('scanner', org, actor)).rejects.toThrow('Deactivate AI security first.');
		await application.apps.plugins.deactivate('security_ai', app1, actor);
		await application.apps.plugins.deactivate('scanner', org, actor);
		await expect(application.apps.plugins.activate('security_ai', app1, actor)).rejects.toThrow('Activate Security first.');
	});

	it('lets the host or the plugin refuse an activation before anything is saved', async () => {
		const refusing = await host({ scanner: security(), security_ai: securityAi(true) });
		await expect(refusing.apps.plugins.activate('security_ai', app1, actor)).rejects.toThrow('Add a card first.');
		expect(await refusing.apps.plugins.isActive('security_ai', app1)).toBe(false);
		await refusing.close();

		const application = await host({ scanner: security(), security_ai: securityAi() });
		const stop = application.apps.plugins.check(change => { if (change.appId === 'security_ai') throw new AppRouteError(402, 'No card on file.'); });
		await expect(application.apps.plugins.activate('security_ai', app1, actor)).rejects.toThrow('No card on file.');
		expect(await application.apps.plugins.isActive('security_ai', app1)).toBe(false);
		expect(calls).toEqual([]);
		stop();
		await application.apps.plugins.activate('security_ai', app1, actor);
		expect(await application.apps.plugins.isActive('security_ai', app1)).toBe(true);
	});

	it('answers a plugin route only where the plugin is on', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		const server = Fastify();
		registerAppRoutes(server, application.apps, async () => actor);
		try {
			expect((await server.inject('/api/apps/security_ai/apps/a1/review')).statusCode).toBe(404);
			await application.apps.plugins.activate('security_ai', app1, actor);
			expect((await server.inject('/api/apps/security_ai/apps/a1/review')).json()).toEqual({ app: 'a1' });
			expect((await server.inject('/api/apps/security_ai/apps/a2/review')).statusCode).toBe(404);
			expect((await server.inject('/api/apps/scanner/organizations/o1/findings')).statusCode).toBe(200);
			await application.apps.plugins.deactivate('security_ai', app1, actor);
			await application.apps.plugins.deactivate('scanner', org, actor);
			expect((await server.inject('/api/apps/scanner/organizations/o1/findings')).statusCode).toBe(404);
		} finally { await server.close(); }
	});
	it('runs effects once when calls overlap, and undoes the switch when an effect fails', async () => {
		let fail = true;
		const flaky = defineSubApp({
			manifest: { id: 'flaky', name: 'Flaky', version: '1.0.0', plugin: { scope: 'organization' } },
			create: () => ({}),
			activated: () => { calls.push('flaky on'); if (fail) throw new Error('Billing is down.'); },
		});
		const application = await host({ scanner: security(), security_ai: securityAi(), flaky });
		await Promise.all([1, 2, 3].map(() => application.apps.plugins.activate('security_ai', app1, actor)));
		expect(calls).toEqual(['ai on a1']);

		await expect(application.apps.plugins.activate('flaky', org, actor)).rejects.toThrow('Billing is down.');
		expect(await application.apps.plugins.isActive('flaky', org)).toBe(false);
		fail = false;
		await application.apps.plugins.activate('flaky', org, actor);
		expect(await application.apps.plugins.isActive('flaky', org)).toBe(true);
		expect(calls).toEqual(['ai on a1', 'flaky on', 'flaky on']);
	});

	it('refuses a default-on plugin that requires a plugin of another scope', () => {
		const child = defineSubApp({ manifest: { id: 'child', name: 'Child', version: '1.0.0', requires: { scanner: 1 }, plugin: { scope: 'app', default: 'on' } }, create: () => ({}) });
		expect(() => new App({ db: database.db, apps: { scanner: security(), child } })).toThrow('may only require plugins switched per app');
	});
});
