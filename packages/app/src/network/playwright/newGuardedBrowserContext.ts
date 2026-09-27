import type { Browser, BrowserContext, BrowserContextOptions, Request } from 'playwright';
import { BlockedUrlError } from '../BlockedUrlError';
import { assertPublicUrl } from '../assertPublicUrl';
import { GuardedBrowserProxy } from './GuardedBrowserProxy';
import type * as playwrightNetwork from './contracts';

/**
 * Creates a Chromium context with connection-level private-network protection.
 *
 * All HTTP requests and HTTPS tunnels use a context-owned authenticated proxy.
 * Its socket lookup validates DNS at connect time, including redirect hops that
 * Playwright does not route again. Chromium retains native redirects, cookies,
 * response streaming and TLS verification. Closing the context closes its proxy.
 * Service workers and WebSockets are disabled; callers must also disable WebRTC
 * non-proxied UDP when launching Chromium for untrusted pages.
 *
 * @param browser - Launched Chromium browser.
 * @param contextOptions - Browser settings; upstream proxy overrides are refused.
 * @param options - Destination policy, resource filters and refusal observer.
 * @returns Isolated browser context, owned and closed by the caller.
 * @example
 * const context = await newGuardedBrowserContext(browser);
 * try { await (await context.newPage()).goto(url); } finally { await context.close(); }
 */
export async function newGuardedBrowserContext(browser: Browser, contextOptions: BrowserContextOptions = {}, options: playwrightNetwork.GuardedBrowserContextOptions = {}): Promise<BrowserContext> {
	if (browser.browserType().name() !== 'chromium') throw new Error('Guarded browser contexts require Chromium.');
	if (contextOptions.proxy) throw new Error('Guarded browser contexts own their proxy configuration.');
	const requests = new Set<Request>();
	const reported = new WeakSet<Request>();
	const blockedOrigins = new Map<string, BlockedUrlError>();
	const blockedTypes = new Set(options.blockedResourceTypes ?? []);
	/** Attributes a connection rejection without exposing observer errors to I/O. */
	function report(request: Request, error: BlockedUrlError): void {
		if (reported.has(request)) return;
		reported.add(request);
		try { options.onBlocked?.({ url: request.url(), request, error }); } catch { /* Observers cannot change network enforcement. */ }
	}
	const proxy = new GuardedBrowserProxy({
		...options,
		onBlocked: (url, error) => {
			const origin = new URL(url).origin;
			blockedOrigins.set(origin, error);
			for (const request of requests) if (new URL(request.url()).origin === origin) report(request, error);
		},
	});
	let context: BrowserContext | undefined;
	try {
		context = await browser.newContext({ ...contextOptions, proxy: await proxy.start(), serviceWorkers: 'block' });
		context.once('close', () => { proxy.close(); requests.clear(); blockedOrigins.clear(); });
		context.on('request', request => {
			requests.add(request);
			const error = blockedOrigins.get(new URL(request.url()).origin);
			if (error) report(request, error);
		});
		context.on('requestfinished', request => requests.delete(request));
		context.on('requestfailed', request => requests.delete(request));
		await context.route('**/*', async route => {
			try {
				if (blockedTypes.has(route.request().resourceType())) { await route.abort('blockedbyclient'); return; }
				await assertPublicUrl(route.request().url(), options);
				await route.continue();
			} catch (error) {
				if (error instanceof BlockedUrlError) report(route.request(), error);
				await route.abort(error instanceof BlockedUrlError ? 'blockedbyclient' : 'failed').catch(() => undefined);
			}
		});
		await context.routeWebSocket('**/*', socket => socket.close());
		return context;
	} catch (error) {
		proxy.close();
		await context?.close();
		throw error;
	}
}
