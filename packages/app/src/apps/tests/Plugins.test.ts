import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { App } from '@db3.ai/app/server';
import { defineApp, AppRouteError, PluginChanged, type AppDefinition, type PluginScope } from '@db3.ai/app/apps';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { createGeneratedTestDatabase, type GeneratedTestDatabase } from '@db3.ai/app/db/test/db';

let database: GeneratedTestDatabase;
const hosts: App[] = [];
const calls: string[] = [];

const org: PluginScope = { type: 'organization', id: 'o1' };
const app1: PluginScope = { type: 'app', id: 'a1' };
const actor = { id: 'person' };

/** Security: one switch per organization, on unless someone turns it off. */
function security(): AppDefinition<{ id: string }> {
	return defineApp({
		manifest: { id: 'scanner', name: 'Security', version: '1.0.0', plugin: { scope: 'organization', default: 'on' } },
		create: () => ({ id: 'scanner' }),
		routes: [{ method: 'GET', path: '/organizations/:organization/findings', handle: ({ params }) => ({ organization: params.organization }) }],
		turnedOn: scope => { calls.push(`security on ${scope.id}`); },
		turnedOff: scope => { calls.push(`security off ${scope.id}`); },
	});
}

/** AI security: one switch per hosted app, off by default, needs Security. */
function securityAi(refuse = false): AppDefinition<{ id: string }> {
	return defineApp({
		manifest: { id: 'security_ai', name: 'AI security', version: '1.0.0', requires: { scanner: 1 }, plugin: { scope: 'app' } },
		create: () => ({ id: 'security_ai' }),
		routes: [{ method: 'GET', path: '/apps/:app/review', handle: ({ params }) => ({ app: params.app }) }],
		turningOn: () => { if (refuse) throw new AppRouteError(402, 'Add a card first.'); },
		turnedOn: scope => { calls.push(`ai on ${scope.id}`); },
		turnedOff: scope => { calls.push(`ai off ${scope.id}`); },
	});
}

/** Boots a host with the apps installed; hosted app a1 belongs to organization o1. */
async function host(apps: Record<string, AppDefinition<any>>) {
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

describe('plugins: apps each scope turns on and off', () => {
	it('refuses a plugin block with a bad scope or a route that does not name its scope', () => {
		const bad = (plugin: object, path = '/organizations/:organization') => () => new App({ db: database.db, apps: { tool: defineApp({ manifest: { id: 'tool', name: 'Tool', version: '1.0.0', plugin } as never, create: () => ({}), routes: [{ method: 'GET', path, handle: () => ({}) }] }) } });
		expect(bad({ scope: 'Organization' })).toThrow('Invalid plugin');
		expect(bad({ scope: 'organization', default: 'maybe' })).toThrow('Invalid plugin');
		expect(bad({ scope: 'organization' }, '/runs')).toThrow(':organization');
	});

	it('starts from the manifest default, saves each change once, runs hooks and announces it', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		const events: PluginChanged[] = [];
		application.events.listen(PluginChanged, event => { events.push(event); });

		expect(await application.apps.plugins.isOn('scanner', org)).toBe(true);
		expect(await application.apps.plugins.isOn('security_ai', app1)).toBe(false);
		expect(await application.apps.plugins.turnOn('security_ai', app1, actor)).toEqual({ appId: 'security_ai', scope: app1, on: true });
		expect(await application.apps.plugins.turnOn('security_ai', app1, actor)).toEqual({ appId: 'security_ai', scope: app1, on: true });
		expect(await application.apps.plugins.isOn('security_ai', app1)).toBe(true);
		expect(await application.apps.plugins.isOn('security_ai', { type: 'app', id: 'a2' })).toBe(false);
		expect(calls).toEqual(['ai on a1']);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ appId: 'security_ai', scope: app1, on: true, actorId: 'person' });

		expect(await application.apps.plugins.list(app1)).toEqual([
			{ appId: 'scanner', scope: org, on: true },
			{ appId: 'security_ai', scope: app1, on: true },
		]);

		await application.apps.plugins.turnOff('security_ai', app1, actor);
		expect(calls).toEqual(['ai on a1', 'ai off a1']);
		expect(events.map(event => event.on)).toEqual([true, false]);
	});

	it('keeps the state in the database for every process', async () => {
		const first = await host({ scanner: security() });
		await first.apps.plugins.turnOff('scanner', org, actor);
		await first.close();
		const second = await host({ scanner: security() });
		expect(await second.apps.plugins.isOn('scanner', org)).toBe(false);
	});

	it('switches a plugin only at its own scope', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		await expect(application.apps.plugins.turnOn('security_ai', org, actor)).rejects.toMatchObject({ statusCode: 400 });
		await expect(application.apps.plugins.turnOn('nothing', org, actor)).rejects.toMatchObject({ statusCode: 404 });
	});

	it('keeps required plugins on while a dependant uses them, across scopes', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		await application.apps.plugins.turnOn('security_ai', app1, actor);
		await expect(application.apps.plugins.turnOff('scanner', org, actor)).rejects.toThrow('Turn off AI security first.');
		await application.apps.plugins.turnOff('security_ai', app1, actor);
		await application.apps.plugins.turnOff('scanner', org, actor);
		await expect(application.apps.plugins.turnOn('security_ai', app1, actor)).rejects.toThrow('Turn on Security first.');
	});

	it('lets the host or the plugin refuse a turn-on before anything is saved', async () => {
		const refusing = await host({ scanner: security(), security_ai: securityAi(true) });
		await expect(refusing.apps.plugins.turnOn('security_ai', app1, actor)).rejects.toThrow('Add a card first.');
		expect(await refusing.apps.plugins.isOn('security_ai', app1)).toBe(false);
		await refusing.close();

		const application = await host({ scanner: security(), security_ai: securityAi() });
		const stop = application.apps.plugins.check(change => { if (change.appId === 'security_ai') throw new AppRouteError(402, 'No card on file.'); });
		await expect(application.apps.plugins.turnOn('security_ai', app1, actor)).rejects.toThrow('No card on file.');
		expect(await application.apps.plugins.isOn('security_ai', app1)).toBe(false);
		expect(calls).toEqual([]);
		stop();
		await application.apps.plugins.turnOn('security_ai', app1, actor);
		expect(await application.apps.plugins.isOn('security_ai', app1)).toBe(true);
	});

	it('answers a plugin route only where the plugin is on', async () => {
		const application = await host({ scanner: security(), security_ai: securityAi() });
		const server = Fastify();
		registerAppRoutes(server, application.apps, async () => actor);
		try {
			expect((await server.inject('/api/apps/security_ai/apps/a1/review')).statusCode).toBe(404);
			await application.apps.plugins.turnOn('security_ai', app1, actor);
			expect((await server.inject('/api/apps/security_ai/apps/a1/review')).json()).toEqual({ app: 'a1' });
			expect((await server.inject('/api/apps/security_ai/apps/a2/review')).statusCode).toBe(404);
			expect((await server.inject('/api/apps/scanner/organizations/o1/findings')).statusCode).toBe(200);
			await application.apps.plugins.turnOff('security_ai', app1, actor);
			await application.apps.plugins.turnOff('scanner', org, actor);
			expect((await server.inject('/api/apps/scanner/organizations/o1/findings')).statusCode).toBe(404);
		} finally { await server.close(); }
	});
});
