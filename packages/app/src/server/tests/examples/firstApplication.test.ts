import { expect, it } from 'vitest';
import { createFirstServer } from '../../examples/createFirstServer';

it('serves a useful route and rejects an invalid name without a database or socket', async () => {
	const server = createFirstServer('Welcome');
	try {
		const health = await server.inject('/health');
		expect(health.statusCode).toBe(200);
		expect(health.json()).toMatchObject({
			status: 'ok',
			service: 'first-application',
			checks: { application: { status: 'ok' } },
		});
		const greeting = await server.inject('/hello/Ada');
		expect(greeting.statusCode).toBe(200);
		expect(greeting.json()).toEqual({ message: 'Welcome, Ada!' });
		expect((await server.inject(`/hello/${'x'.repeat(81)}`)).statusCode).toBe(400);
		expect((await server.inject('/missing')).statusCode).toBe(404);
	} finally {
		await server.close();
	}
});
