import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { App } from '@db3.ai/app/server';
import { AppRouteError } from '@db3.ai/app/apps';
import { registerAppRoutes } from '@db3.ai/app/apps/fastify';
import { createGeneratedTestDatabase } from '@db3.ai/app/db/test/db';
import { helloDefinition } from '../../examples/helloDefinition';

/** Exercises the published definition, HTTP authorization and cleanup against real SQL. */
it('installs Hello, rejects anonymous access, disables it and starts it again', async () => {
	const database = await createGeneratedTestDatabase('hello_guide');
	const host = new App({ db: database.db, apps: { hello: helloDefinition } });
	const server = Fastify();
	registerAppRoutes(server, host.apps, async request => {
		if (request.headers.authorization !== 'test-user') throw new AppRouteError(401, 'Please sign in.');
		return { id: 'reader' };
	});
	try {
		expect(host.apps.hello).toBeUndefined();
		await host.apps.install('hello');
		expect(host.apps.hello).toBeUndefined();
		await host.apps.boot();
		expect((await server.inject('/api/apps/hello')).statusCode).toBe(401);
		const response = await server.inject({ url: '/api/apps/hello', headers: { authorization: 'test-user' } });
		expect(response.json()).toEqual({ message: 'Hello, reader!' });
		const service = host.apps.hello!;
		await host.apps.manage('disable', 'hello');
		expect((await server.inject('/api/apps/hello')).statusCode).toBe(404);
		expect(() => service.greet('reader')).toThrow('Hello is not running.');
		await host.apps.manage('enable', 'hello');
		expect(host.apps.hello!.greet('reader')).toEqual({ message: 'Hello, reader!' });
		await host.apps.manage('uninstall', 'hello');
		expect(host.apps.hello).toBeUndefined();
	} finally {
		try { await server.close(); } finally {
			try { await host.close(); } finally { await database.destroy(); }
		}
	}
});
