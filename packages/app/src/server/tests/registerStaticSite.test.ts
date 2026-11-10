import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { registerStaticSite } from '@db3.ai/app/server';

describe('registerStaticSite', () => {
	const directory = mkdtempSync(join(tmpdir(), 'db3-static-'));
	afterAll(() => rmSync(directory, { recursive: true, force: true }));
	for (const [file, body] of Object.entries({ 'index.html': 'home', 'docs/apps.html': 'apps', 'learn/index.html': 'learn', 'assets/app.js': 'code', 'llms.txt': 'feed', '404.html': 'missing', '.env': 'secret' })) {
		mkdirSync(join(directory, file, '..'), { recursive: true });
		writeFileSync(join(directory, file), body);
	}
	writeFileSync(join(directory, '..', 'outside.txt'), 'outside');

	it('serves clean URLs, assets and the not-found page under its prefix', async () => {
		const server = Fastify();
		registerStaticSite(server, { prefix: '/framework', directory, headers: file => ({ 'cache-control': file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-frame-options': 'DENY' }) });
		const get = (url: string) => server.inject(url);
		for (const [url, body] of [['/framework', 'home'], ['/framework/', 'home'], ['/framework/docs/apps', 'apps'], ['/framework/docs/apps/', 'apps'], ['/framework/learn', 'learn'], ['/framework/llms.txt', 'feed']]) {
			const response = await get(url!);
			expect([response.statusCode, response.body]).toEqual([200, body]);
		}
		expect((await get('/framework/docs/apps')).headers).toMatchObject({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'x-frame-options': 'DENY' });
		expect((await get('/framework/assets/app.js')).headers).toMatchObject({ 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=31536000, immutable' });
		for (const url of ['/framework/nope', '/framework/.env', '/framework/docs/%25E0']) {
			const response = await get(url);
			expect([response.statusCode, response.body]).toEqual([404, 'missing']);
		}
		// Fastify resolves a literal `..` before routing, so it never reaches the site.
		for (const url of ['/framework/../outside.txt', '/framework/%2e%2e/outside.txt', '/framework/docs/..%2f..%2foutside.txt']) expect((await get(url)).body).not.toBe('outside');
		expect((await get('/other')).statusCode).toBe(404);
		await server.close();
	});

	it('can serve a whole origin', async () => {
		const server = Fastify();
		registerStaticSite(server, { prefix: '/', directory });
		expect((await server.inject('/')).body).toBe('home');
		expect((await server.inject('/docs/apps')).body).toBe('apps');
		await server.close();
	});
});
