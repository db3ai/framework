import { isIP } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { newGuardedBrowserContext, type BlockedBrowserRequest } from '@db3.ai/app/network/playwright';
import { startHttpServer, startSelfSignedHttpsServer, type LocalServer } from '../support/localServer';

/** Controlled DNS answers for the validation and connection lookups. */
const dns = vi.hoisted(() => ({ preflight: new Map<string, string>(), connect: new Map<string, string>() }));

vi.mock('node:dns/promises', async importOriginal => {
	const actual = await importOriginal<typeof import('node:dns/promises')>();
	const lookup = async (hostname: string, options: object) => {
		const address = dns.preflight.get(hostname);
		return address ? [{ address, family: isIP(address) }] : actual.lookup(hostname, options as never);
	};
	return { ...actual, lookup, default: { ...actual, lookup } };
});

vi.mock('node:dns', async importOriginal => {
	const actual = await importOriginal<typeof import('node:dns')>();
	const lookup = (hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
		const address = dns.connect.get(hostname);
		if (!address) return actual.lookup(hostname, options as never, callback as never);
		const entry = { address, family: isIP(address) };
		return options.all ? callback(null, [entry]) : callback(null, entry.address, entry.family);
	};
	return { ...actual, lookup, default: { ...actual, lookup } };
});

let browser: Browser;
let server: LocalServer;

beforeAll(async () => {
	browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
	server = await startHttpServer((request, response) => {
		if (request.url === '/start') {
			response.writeHead(302, { location: '/page' }).end();
			return;
		}
		if (request.url === '/page') {
			response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/'] });
			response.end('<!doctype html><title>Guarded</title><p id="message">hello</p><img src="/pixel.png">');
			return;
		}
		if (request.url === '/broken') {
			response.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' });
			response.write('<title>Partial response</title>');
			setTimeout(() => response.destroy(), 20);
			return;
		}
		if (request.url === '/slow') {
			response.writeHead(200, { 'content-type': 'text/html' });
			response.write('<title>Still streaming</title>');
			return;
		}
		response.writeHead(404).end();
	});
}, 60_000);

afterEach(() => { dns.preflight.clear(); dns.connect.clear(); });

afterAll(async () => {
	await browser?.close();
	await server?.close();
});

describe('newGuardedBrowserContext', () => {
	it('loads pages, redirects and cookies through the guard when private hosts are allowed', async () => {
		const context = await newGuardedBrowserContext(browser, {}, { allowPrivate: true, blockedResourceTypes: ['image'] });

		try {
			const page = await context.newPage();
			await page.goto(`http://127.0.0.1:${server.port}/start`);

			expect(page.url()).toBe(`http://127.0.0.1:${server.port}/page`);
			expect(await page.textContent('#message')).toBe('hello');
			expect((await context.cookies()).map(cookie => cookie.name).sort()).toEqual(['a', 'b']);
			expect(server.requests).not.toContain('/pixel.png');
		} finally {
			await context.close();
		}
	});

	it('blocks private navigations and reports them', async () => {
		const blocked: BlockedBrowserRequest[] = [];
		const context = await newGuardedBrowserContext(browser, {}, { onBlocked: entry => blocked.push(entry) });
		const before = server.requests.length;

		try {
			const page = await context.newPage();

			await expect(page.goto(`http://127.0.0.1:${server.port}/page`)).rejects.toThrow();
			expect(blocked).toHaveLength(1);
			expect(blocked[0]!.request.isNavigationRequest()).toBe(true);
			expect(server.requests.length).toBe(before);
		} finally {
			await context.close();
		}
	});

	it('blocks a public hostname that rebinds to a private address when the browser connects', async () => {
		dns.preflight.set('rebind.test', '93.184.216.34');
		dns.connect.set('rebind.test', '127.0.0.1');
		const blocked: BlockedBrowserRequest[] = [];
		const context = await newGuardedBrowserContext(browser, {}, { onBlocked: entry => blocked.push(entry) });
		const before = server.requests.length;

		try {
			const page = await context.newPage();

			await expect(page.goto(`http://rebind.test:${server.port}/page`)).rejects.toThrow();
			expect(blocked.map(entry => entry.url)).toEqual([`http://rebind.test:${server.port}/page`]);
			expect(server.requests.length).toBe(before);
		} finally {
			await context.close();
		}
	});
});


describe('browser connection protection', () => {
	it('preserves Chromium TLS verification and HTTPS cookie/redirect behavior through CONNECT', async () => {
		const secure = await startSelfSignedHttpsServer((request, response) => {
			if (request.url === '/start') { response.writeHead(302, { location: '/page' }).end(); return; }
			response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'secure_test=yes; Secure; Path=/' });
			response.end('<title>Secure page</title>');
		});
		const strict = await newGuardedBrowserContext(browser, {}, { allowPrivate: true });
		let permissive;
		try {
			await expect((await strict.newPage()).goto(`https://127.0.0.1:${secure.port}/start`)).rejects.toThrow(/CERT/);
			expect(secure.requests).toEqual([]);
			permissive = await newGuardedBrowserContext(browser, { ignoreHTTPSErrors: true }, { allowPrivate: true });
			const page = await permissive.newPage();
			await page.goto(`https://127.0.0.1:${secure.port}/start`);
			expect(await page.title()).toBe('Secure page');
			expect(page.url()).toBe(`https://127.0.0.1:${secure.port}/page`);
			expect((await permissive.cookies()).some(cookie => cookie.name === 'secure_test' && cookie.secure)).toBe(true);
		} finally { await strict.close(); await permissive?.close(); await secure.close(); }
	});

	it.each(['http', 'https'])('blocks public redirects to private %s destinations at the proxy', async protocol => {
		const blocked: BlockedBrowserRequest[] = [];
		const context = await newGuardedBrowserContext(browser, {}, { onBlocked: value => blocked.push(value) });
		const before = server.requests.length;
		try {
			const page = await context.newPage();
			// Supply a controlled public response; the redirect uses real Chromium networking.
			await page.route('http://public.test/start', route => route.fulfill({ status: 302, headers: { location: `${protocol}://127.0.0.1:${server.port}/private` } }));
			await expect(page.goto('http://public.test/start', { timeout: 5000 })).rejects.toThrow();
			expect(server.requests.length).toBe(before);
			expect(blocked.some(value => value.url.includes('/private'))).toBe(true);
		} finally { await context.close(); }
	});

	it('validates connect-time DNS for a redirect hop that Playwright does not re-route', async () => {
		dns.preflight.set('redirect-rebind.test', '93.184.216.34');
		dns.connect.set('redirect-rebind.test', '127.0.0.1');
		const context = await newGuardedBrowserContext(browser);
		const before = server.requests.length;
		try {
			const page = await context.newPage();
			await page.route('http://public.test/start', route => route.fulfill({ status: 302, headers: { location: `http://redirect-rebind.test:${server.port}/private` } }));
			await expect(page.goto('http://public.test/start', { timeout: 5000 })).rejects.toThrow();
			expect(server.requests.length).toBe(before);
		} finally { await context.close(); }
	});

	it('also blocks redirects from embedded frames and fetch requests', async () => {
		const context = await newGuardedBrowserContext(browser);
		const before = server.requests.length;
		try {
			const page = await context.newPage();
			await page.route('http://public.test/page', route => route.fulfill({ contentType: 'text/html', body: '<title>Public page</title><iframe src="/redirect"></iframe><script>fetch("/redirect").catch(() => {})</script>' }));
			await page.route('http://public.test/redirect', route => route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:${server.port}/private` } }));
			const failed = page.waitForEvent('requestfailed', request => request.url().includes('/private'));
			await page.goto('http://public.test/page');
			await failed;
			expect(server.requests.length).toBe(before);
		} finally { await context.close(); }
	});

	it('handles interrupted bodies without unhandled rejections and remains usable', async () => {
		const context = await newGuardedBrowserContext(browser, {}, { allowPrivate: true });
		try {
			const page = await context.newPage();
			await page.goto(`http://127.0.0.1:${server.port}/broken`, { timeout: 2000 }).catch(() => undefined);
			expect(server.requests).toContain('/broken');
			await page.goto(`http://127.0.0.1:${server.port}/page`);
			expect(await page.title()).toBe('Guarded');
			// Vitest fails the suite if the Node proxy leaks an unhandled rejection.
		} finally { await context.close(); }
	});

	it('closes in-flight streamed requests when their context closes', async () => {
		let connectionClosed!: () => void;
		const closed = new Promise<void>(resolve => { connectionClosed = resolve; });
		const streaming = await startHttpServer((request, response) => {
			request.socket.once('close', connectionClosed);
			response.writeHead(200, { 'content-type': 'text/html' });
			response.write('<title>Still streaming</title>');
		});
		const context = await newGuardedBrowserContext(browser, {}, { allowPrivate: true });
		try {
			const page = await context.newPage();
			await page.goto(`http://127.0.0.1:${streaming.port}/slow`, { waitUntil: 'commit' });
			await context.close();
			await closed;
			expect(page.isClosed()).toBe(true);
		} finally { await context.close(); await streaming.close(); }
	});
});
