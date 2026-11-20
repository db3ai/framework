import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { registerStaticSite } from '@db3.ai/app/server';

describe('registerStaticSite', () => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'db3-static-'));
	const directory = join(temporaryRoot, 'site');
	afterAll(() => rmSync(temporaryRoot, { recursive: true, force: true }));
	// Backslash filenames are literal on POSIX and resolve through directories on Windows.
	// Real files make these regressions fail before the fix on either platform.
	for (const [file, body] of Object.entries({ 'index.html': 'home', 'docs/apps.html': 'apps', 'learn/index.html': 'learn', 'assets/app.js': 'code', 'llms.txt': 'feed', '404.html': 'missing', '.env': 'secret', 'assets\\.env': 'secret', 'assets\\..\\.env': 'secret', 'assets\\.private\\token.txt': 'secret' })) {
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

	it.each([
		'/framework/assets%5c.env',
		'/framework/assets%5c..%5c.env',
		'/framework/assets%5C.%2e%5C.env',
		'/framework/assets%5c%2eenv',
		'/framework/assets%5c.private%5ctoken.txt',
	])('rejects encoded dot components before serving existing files: %s', async url => {
		const server = Fastify();
		try {
			registerStaticSite(server, { prefix: '/framework', directory });
			const response = await server.inject(url);
			expect([response.statusCode, response.body]).toEqual([404, 'missing']);
		} finally {
			await server.close();
		}
	});

	it('can serve a whole origin', async () => {
		const server = Fastify();
		registerStaticSite(server, { prefix: '/', directory });
		expect((await server.inject('/')).body).toBe('home');
		expect((await server.inject('/docs/apps')).body).toBe('apps');
		await server.close();
	});
});
