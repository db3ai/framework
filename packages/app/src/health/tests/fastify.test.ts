import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { Health } from '@db3.ai/app/health';
import { registerHealthRoute } from '@db3.ai/app/health/fastify';

describe('registerHealthRoute', () => {
	it('serves the canonical endpoint and compatibility aliases', async () => {
		const server = Fastify();
		registerHealthRoute(server, {
			app: { health: new Health({ service: 'example-api' }) },
			aliases: ['/healthz'],
		});

		try {
			for (const path of ['/health', '/healthz']) {
				const response = await server.inject(path);
				expect(response.statusCode).toBe(200);
				expect(response.headers['cache-control']).toBe('no-store');
				expect(response.json()).toMatchObject({ status: 'ok', service: 'example-api' });
			}
		} finally {
			await server.close();
		}
	});

	it('returns service unavailable for an unhealthy component', async () => {
		const server = Fastify();
		const health = new Health();
		health.register('database', () => ({ status: 'unhealthy' }));
		registerHealthRoute(server, { app: { health } });

		try {
			const response = await server.inject('/health');
			expect(response.statusCode).toBe(503);
			expect(response.json()).toMatchObject({ status: 'unhealthy' });
		} finally {
			await server.close();
		}
	});
});
