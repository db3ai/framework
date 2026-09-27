import { isIP } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedUrlError, assertPublicUrl, guardedFetch } from '@db3.ai/app/network';
import { startHttpServer, startSelfSignedHttpsServer } from './support/localServer';

/**
 * Controlled DNS answers. `preflight` answers the validation lookup and
 * `connect` answers the socket lookup, so tests can model DNS rebinding.
 */
const dns = vi.hoisted(() => ({
	preflight: new Map<string, string>(),
	connect: new Map<string, string>(),
}));

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

afterEach(() => {
	dns.preflight.clear();
	dns.connect.clear();
	vi.unstubAllGlobals();
});

describe('assertPublicUrl', () => {
	it.each([
		['ftp://example.com/', /Only http and https/],
		['not a url', /not valid/],
		['http://localhost:8080/', /Private, local, or reserved/],
		['http://[::1]/', /Private, local, or reserved/],
		['http://169.254.169.254/latest/meta-data/', /Private, local, or reserved/],
		['http://2130706433/', /Private, local, or reserved/],
	])('refuses %s', async (url, message) => {
		await expect(assertPublicUrl(url)).rejects.toThrow(message);
	});

	it('refuses hostnames that resolve to private addresses', async () => {
		dns.preflight.set('internal.test', '10.0.0.5');

		await expect(assertPublicUrl('https://internal.test/')).rejects.toBeInstanceOf(BlockedUrlError);
	});

	it('allows private destinations only when requested', async () => {
		await expect(assertPublicUrl('http://127.0.0.1:3000/', { allowPrivate: true })).resolves.toBeUndefined();
		await expect(assertPublicUrl('file:///etc/passwd', { allowPrivate: true })).rejects.toThrow(/Only http and https/);
	});
});

describe('guardedFetch', () => {
	it('checks the connected address, so DNS rebinding cannot reach a private host', async () => {
		const server = await startHttpServer((_request, response) => response.end('internal'));
		dns.preflight.set('rebind.test', '93.184.216.34');
		dns.connect.set('rebind.test', '127.0.0.1');

		try {
			await expect(guardedFetch(`http://rebind.test:${server.port}/admin`)).rejects.toBeInstanceOf(BlockedUrlError);
			expect(server.requests).toEqual([]);
		} finally {
			await server.close();
		}
	});

	it('connects through the pinned lookup with the runtime fetch when private hosts are allowed', async () => {
		const server = await startHttpServer((request, response) => {
			if (request.url === '/start') {
				response.writeHead(302, { location: '/done' }).end();
				return;
			}
			response.end('reached');
		});

		try {
			const { response, finalUrl } = await guardedFetch(`http://127.0.0.1:${server.port}/start`, { allowPrivate: true });

			expect(await response.text()).toBe('reached');
			expect(finalUrl).toBe(`http://127.0.0.1:${server.port}/done`);
			expect(server.requests).toEqual(['/start', '/done']);
		} finally {
			await server.close();
		}
	});

	it('retains certificate verification even when private destinations are allowed', async () => {
		const server = await startSelfSignedHttpsServer((_request, response) => response.end('{"ok":true}'));
		const url = `https://127.0.0.1:${server.port}/webhook`;

		try {
			await expect(guardedFetch(url)).rejects.toThrow(/Private, local, or reserved/);

			await expect(guardedFetch(url, { allowPrivate: true, init: { method: 'POST', body: '{"ping":true}' } })).rejects.toMatchObject({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
			expect(server.requests).toEqual([]);
		} finally {
			await server.close();
		}
	});

	it('validates every redirect target, including IP literals', async () => {
		dns.preflight.set('public.test', '93.184.216.34');
		const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }));
		vi.stubGlobal('fetch', fetchMock);

		await expect(guardedFetch('https://public.test/')).rejects.toBeInstanceOf(BlockedUrlError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('drops credentials on cross-origin redirects and switches 303 responses to GET', async () => {
		dns.preflight.set('public.test', '93.184.216.34');
		dns.preflight.set('other.test', '93.184.216.35');
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: '/same-origin' } }))
			.mockResolvedValueOnce(new Response(null, { status: 303, headers: { location: 'https://other.test/done' } }))
			.mockResolvedValueOnce(new Response('ok'));
		vi.stubGlobal('fetch', fetchMock);

		const { finalUrl } = await guardedFetch('https://public.test/hook', {
			init: { method: 'POST', body: '{}', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' } },
		});
		const sameOrigin = fetchMock.mock.calls[1]![1] as RequestInit;
		const crossOrigin = fetchMock.mock.calls[2]![1] as RequestInit;

		expect(finalUrl).toBe('https://other.test/done');
		expect(sameOrigin.method).toBe('POST');
		expect(new Headers(sameOrigin.headers).get('authorization')).toBe('Bearer secret');
		expect(crossOrigin.method).toBe('GET');
		expect(crossOrigin.body).toBeUndefined();
		expect(new Headers(crossOrigin.headers).get('authorization')).toBeNull();
		expect(new Headers(crossOrigin.headers).get('content-type')).toBeNull();
	});

	it('limits redirects and can return them unfollowed', async () => {
		dns.preflight.set('public.test', '93.184.216.34');
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 301, headers: { location: '/again' } })));

		await expect(guardedFetch('https://public.test/', { maxRedirects: 2 })).rejects.toThrow(/Too many redirects/);

		const { response, finalUrl } = await guardedFetch('https://public.test/', { redirect: 'manual' });

		expect(response.status).toBe(301);
		expect(finalUrl).toBe('https://public.test/');
	});
});
