import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { _electron, type ElectronApplication } from 'playwright-core';

const require = createRequire(import.meta.url);
const executablePath = require('electron') as string;
const applicationDirectory = fileURLToPath(new URL('../../', import.meta.url));

/** Starts only this experiment's Electron process with a disposable, independently owned profile. */
async function launch(url: string, profile: string): Promise<ElectronApplication> {
	const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')), DB3_ELECTRON_URL: url, DB3_ELECTRON_PROFILE: profile };
	return _electron.launch({ executablePath, args: [applicationDirectory], env, timeout: 20_000 });
}

/** Exercises actual Electron navigation, isolation, persisted cookies and server-outage recovery. */
test('desktop isolates web content, persists sessions and recovers after a server outage', { timeout: 90_000 }, async () => {
	const profile = await mkdtemp(join(tmpdir(), 'db3-electron-test-'));
	const server = createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, { location: 'https://example.com/' });
			response.end();
			return;
		}
		if (request.url === '/api/login') {
			response.setHeader('Set-Cookie', 'session=desktop-test; HttpOnly; SameSite=Lax; Max-Age=3600; Path=/');
			response.end('ok');
			return;
		}
		if (request.url === '/api/me') {
			response.end(request.headers.cookie || 'anonymous');
			return;
		}
		response.setHeader('Content-Type', 'text/html');
		response.end(`<!doctype html><html><head><title>Codex Electron testing</title></head><body>
			<h1>${request.url === '/next' ? 'Next page' : 'Shared frontend'}</h1>
			<a href="/next" target="_blank">Internal link</a>
			<a href="https://example.com/" target="_blank">External link</a>
			<a href="/redirect">Redirect</a>
		</body></html>`);
	});
	let desktop: ElectronApplication | undefined;
	try {
		server.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		assert.ok(address && typeof address !== 'string');
		const url = `http://127.0.0.1:${address.port}`;
		desktop = await launch(url, profile);
		let page = await desktop.firstWindow();
		await page.getByRole('heading', { name: 'Shared frontend' }).waitFor();
		assert.deepEqual(await page.evaluate(() => ({ require: 'require' in globalThis, process: 'process' in globalThis })), { require: false, process: false });
		assert.equal(await page.evaluate(() => Notification.requestPermission()), 'denied');
		await page.evaluate(async () => { await fetch('/api/login', { method: 'POST' }); localStorage.setItem('shared-client', 'persisted'); });
		assert.equal(await page.evaluate(() => document.cookie), '');
		assert.equal(await page.evaluate(async () => (await fetch('/api/me')).text()), 'session=desktop-test');
		await page.getByRole('link', { name: 'Internal link' }).click();
		await page.getByRole('heading', { name: 'Next page' }).waitFor();
		assert.equal(desktop.windows().length, 1);

		// The OS browser is an external side effect; observe its requested URL without launching it.
		const opened = desktop.evaluate(({ shell }) => new Promise<string>(resolve => {
			shell.openExternal = async url => { resolve(url); };
		}));
		await page.getByRole('link', { name: 'External link' }).click();
		assert.equal(await opened, 'https://example.com/');
		assert.equal(desktop.windows().length, 1);
		await page.evaluate(() => { window.open('file:///etc/passwd'); });
		assert.equal(desktop.windows().length, 1);
		assert.equal(new URL(page.url()).pathname, '/next');
		await page.getByRole('link', { name: 'Redirect', exact: true }).click();
		await page.getByRole('heading', { name: 'Unable to connect' }).waitFor();
		await page.getByRole('link', { name: 'Try again' }).click();
		await page.getByRole('heading', { name: 'Shared frontend' }).waitFor();
		await desktop.close();
		desktop = undefined;
		desktop = await launch(url, profile);
		page = await desktop.firstWindow();
		await page.getByRole('heading', { name: 'Shared frontend' }).waitFor();
		assert.equal(await page.evaluate(() => localStorage.getItem('shared-client')), 'persisted');
		assert.equal(await page.evaluate(async () => (await fetch('/api/me')).text()), 'session=desktop-test');
		await desktop.close();
		desktop = undefined;
		await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
		desktop = await launch(url, profile);
		page = await desktop.firstWindow();
		await page.getByRole('heading', { name: 'Unable to connect' }).waitFor();
		server.listen(address.port, '127.0.0.1');
		await once(server, 'listening');
		await page.getByRole('link', { name: 'Try again' }).click();
		await page.getByRole('heading', { name: 'Shared frontend' }).waitFor();
	} finally {
		try { await desktop?.close(); } finally {
			await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
			await rm(profile, { recursive: true, force: true });
		}
	}
});
